"""Portable mixed-source teaching courses; every scene retains its native binding."""
from pathlib import Path
from typing import Any, Literal
import hashlib
import json
import uuid

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .acquire import capacity, destination
from .build import atomic_json, build_lock, sha256, utc_now
from .library import BINDING_BYTES_LIMIT, binding_from_content, library_records, locate_binding


class CourseRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class CourseEntry(CourseRecord):
    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
    title: str = Field(min_length=1, max_length=200)
    prompt: str = Field(default="", max_length=4000)
    scene: dict[str, Any]

    @field_validator("scene")
    @classmethod
    def native_scene(cls, value):
        if binding_from_content(value)["kind"] != "neuroimage-scene":
            raise ValueError("A course entry contains one original source scene")
        provenance = value.get("provenance")
        if not isinstance(provenance, dict) or not provenance.get("sources") or not provenance.get("processing"):
            raise ValueError("Course scenes retain source attribution and processing records")
        if not isinstance(value.get("state"), dict):
            raise ValueError("Course scenes retain their original view state")
        return value


class TeachingCourse(CourseRecord):
    schema_version: Literal["1.0"]
    kind: Literal["neuroimage-teaching-course"]
    id: str
    title: str = Field(min_length=1, max_length=200)
    author: str = Field(default="", max_length=200)
    objective: str = Field(default="", max_length=4000)
    created_utc: str = Field(min_length=1, max_length=64)
    updated_utc: str = Field(min_length=1, max_length=64)
    entries: list[CourseEntry] = Field(max_length=100)

    @field_validator("id")
    @classmethod
    def valid_identity(cls, value):
        return course_id(value)

    @model_validator(mode="after")
    def unique_entries(self):
        if len({entry.id for entry in self.entries}) != len(self.entries):
            raise ValueError("Course view identifiers must be unique")
        if not self.title.strip():
            raise ValueError("Give the course a title")
        return self


def course_id(value):
    if not isinstance(value, str):
        raise ValueError("Choose a saved course identifier")
    try:
        canonical = str(uuid.UUID(value))
    except ValueError as error:
        raise ValueError("Choose a saved course identifier") from error
    if canonical != value:
        raise ValueError("Use the canonical saved course identifier")
    return value


def _path(root, identity):
    root = Path(root).resolve()
    path = destination(root, f"exports/courses/{course_id(identity)}/course.json")
    if any(parent.is_symlink() for parent in [path, *path.parents] if parent != root and parent.is_relative_to(root)):
        raise ValueError("Saved courses use regular files and directories inside the data root")
    for name in ["course.json", "previous-course.json", "position.json"]:
        if path.with_name(name).is_symlink() or path.with_name("." + name + ".partial").is_symlink():
            raise ValueError("Course recovery files must remain regular files")
    if path.with_name(".course.lock").is_symlink():
        raise ValueError("Course lock must remain a regular file")
    return path


def _read(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > BINDING_BYTES_LIMIT:
        raise ValueError("Choose a saved course file of up to 10 MiB")
    with path.open("rb") as stream:
        serialized = stream.read(BINDING_BYTES_LIMIT + 1)
    if len(serialized) > BINDING_BYTES_LIMIT:
        raise ValueError("Course file exceeds the 10 MiB limit")
    return TeachingCourse.model_validate_json(serialized).model_dump(), hashlib.sha256(serialized).hexdigest()


def save_course(value, data_root, *, expected_revision=None, minimum_free_gib=400):
    """Save explicitly with optimistic concurrency; preserve a prior version for recovery."""
    course = TeachingCourse.model_validate(value).model_dump()
    serialized = (json.dumps(course, indent=2, allow_nan=False) + "\n").encode()
    if len(serialized) > BINDING_BYTES_LIMIT:
        raise ValueError("Split this course into files of up to 10 MiB")
    path = _path(data_root, course["id"])
    capacity(Path(data_root).resolve(), len(serialized) * 3, minimum_free_gib)
    path.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(serialized).hexdigest()
    with build_lock(path.parent / ".course.lock"):
        if path.exists():
            previous, revision = _read(path)
            if revision == digest:
                return {"course": previous, "revision": revision, "status": "reused"}
            if expected_revision != revision:
                raise ValueError("This course has another saved revision. Reopen it or import your draft as a new course")
            atomic_json(path.with_name("previous-course.json"), previous)
        elif expected_revision is not None:
            raise ValueError("The previous saved course is unavailable. Save a new course copy")
        atomic_json(path, course)
    return {"course": course, "revision": digest, "status": "saved"}


def course_records(data_root):
    root = Path(data_root).resolve()
    folder = destination(root, "exports/courses")
    result, skipped = [], 0
    for path in sorted(folder.glob("*/course.json")):
        try:
            if path != _path(root, path.parent.name):
                raise ValueError("Course path differs from its saved identity")
            course, revision = _read(path)
            if course["id"] != path.parent.name:
                raise ValueError("Course file identity differs from its directory")
            sources = {entry["scene"]["package_id"] for entry in course["entries"]}
            result.append({key: course[key] for key in ["id", "title", "author", "objective", "updated_utc"]} |
                          {"revision": revision, "views": len(course["entries"]), "source_count": len(sources)})
        except (OSError, ValueError):
            skipped += 1
    return {"courses": sorted(result, key=lambda item: (item["title"].casefold(), item["id"])), "skipped_files": skipped}


def get_course(data_root, identity, *, inspect_sources=True):
    path = _path(data_root, identity)
    course, revision = _read(path)
    if course["id"] != identity:
        raise ValueError("Course file identity differs from its directory")
    result = {"course": course, "revision": revision, "position": 0}
    progress = path.with_name("position.json")
    if progress.is_file() and not progress.is_symlink() and progress.stat().st_size < 4096:
        try:
            entry_id = json.loads(progress.read_text())["entry_id"]
            result["position"] = next((i for i, entry in enumerate(course["entries"]) if entry["id"] == entry_id), 0)
        except (ValueError, KeyError, TypeError):
            pass
    if inspect_sources:
        packages = library_records(data_root)
        locations = []
        for entry in course["entries"]:
            binding = binding_from_content(entry["scene"])
            try:
                match = locate_binding(binding, packages)
                record = next(item for item in packages if item.get("manifest") == match["manifest"])
                locations.append({"id": entry["id"], "status": "ready", "title": record["title"],
                                  "representation": record["representation"], "space_name": record["space_name"]})
            except ValueError as error:
                locations.append({"id": entry["id"], "status": "source_required", "detail": str(error)})
        result["locations"] = locations
    return result


def open_course_entry(data_root, identity, entry_id, revision, register_package, *, persist_position=True):
    saved = get_course(data_root, identity, inspect_sources=False)
    if saved["revision"] != revision:
        raise ValueError("The saved course has changed. Reopen it to present the current revision")
    entries = saved["course"]["entries"]
    entry = next((entry for entry in entries if entry["id"] == entry_id), None)
    if entry is None:
        raise ValueError("Choose an existing view in this course")
    match = locate_binding(binding_from_content(entry["scene"]), library_records(data_root))
    key = register_package(match["manifest"])
    path = _path(data_root, identity)
    with build_lock(path.parent / ".course.lock"):
        if sha256(path) != revision:
            raise ValueError("The saved course changed while opening. Reopen the current revision")
        if persist_position:
            atomic_json(path.with_name("position.json"), {"entry_id": entry_id, "revision": revision, "opened_utc": utc_now()})
    return {"atlas_key": key, "content": entry["scene"], "content_key": f"course-{identity}-{entry_id}-{revision}",
            "course_id": identity, "entry_id": entry_id, "position": entries.index(entry)}
