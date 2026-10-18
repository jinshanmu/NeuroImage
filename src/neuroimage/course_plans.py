"""Reproducible teaching courses assembled from explicitly selected native packages."""
from pathlib import Path
from typing import Literal
from importlib.metadata import version
import hashlib
import json
import uuid

from pydantic import Field, model_validator

from . import __version__
from .acquire import capacity, destination
from .build import atomic_json, build_lock, sha256, utc_now
from .courses import CourseRecord, get_course, save_course
from .library import BINDING_BYTES_LIMIT, library_records
from .teaching import curriculum_matches, curriculum_names, curriculum_path, parse_teaching_recipe, prepare


class PlannedView(CourseRecord):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,60}$")
    curriculum: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,100}$")
    view: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,60}$")
    title: str | None = Field(default=None, min_length=1, max_length=200)
    prompt: str | None = Field(default=None, max_length=4000)


class CoursePlan(CourseRecord):
    schema_version: Literal["1.0"]
    kind: Literal["neuroimage-course-plan"]
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,60}$")
    title: str = Field(min_length=1, max_length=200)
    author: str = Field(max_length=200)
    objective: str = Field(max_length=4000)
    views: list[PlannedView] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_views(self):
        if len({view.id for view in self.views}) != len(self.views):
            raise ValueError("Course plan view identifiers must be unique")
        return self


def plan_names():
    return sorted(path.stem for path in Path(__file__).with_name("course_plans").glob("*.json"))


def plan_path(name):
    if name in plan_names():
        return Path(__file__).with_name("course_plans") / (name + ".json")
    candidate = Path(name)
    if candidate.is_file() and not candidate.is_symlink():
        return candidate
    raise ValueError("Choose an installed course plan or a local JSON plan file")


def read_plan(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 ** 2:
        raise ValueError("Choose a regular course plan file of up to 1 MiB")
    return CoursePlan.model_validate_json(path.read_bytes()).model_dump(exclude_none=True)


def plan_curricula(plan):
    recipes = {}
    for view in plan["views"]:
        name = view["curriculum"]
        if name not in curriculum_names():
            raise ValueError(f"Course plan requires the installed curriculum {name}")
        if name not in recipes:
            recipes[name] = parse_teaching_recipe(curriculum_path(name).read_text()).model_dump()
        if not any(step["id"] == view["view"] for step in recipes[name]["scenes"]):
            raise ValueError(f"Course plan view {view['view']} is unavailable in {name}")
    return recipes


def plan_catalog():
    records = []
    for name in plan_names():
        plan = read_plan(plan_path(name))
        recipes = plan_curricula(plan)
        datasets = sorted({recipe["dataset_id"] for recipe in recipes.values()})
        records.append({"id": name, "title": plan["title"], "objective": plan["objective"], "views": len(plan["views"]),
                        "requirements": [{"dataset_id": dataset, "curricula": [key for key, value in recipes.items() if value["dataset_id"] == dataset]} for dataset in datasets]})
    return records


def resolve_packages(plan, package_keys, data_root):
    recipes = plan_curricula(plan)
    expected = {recipe["dataset_id"] for recipe in recipes.values()}
    if not isinstance(package_keys, dict) or set(package_keys) != expected:
        raise ValueError("Select one exact local package for each course source: " + ", ".join(sorted(expected)))
    records = library_records(data_root)
    chosen = {}
    for dataset, key in package_keys.items():
        matches = [record for record in records if record["status"] == "available" and record["dataset_id"] == dataset
                   and record["package_id"] + "-" + record["package_version"] == key]
        if len(matches) != 1:
            raise ValueError("Select exactly one available source package for " + dataset)
        path = Path(matches[0]["manifest"])
        if path.stat().st_size > BINDING_BYTES_LIMIT:
            raise ValueError("Source manifest exceeds the course metadata limit")
        manifest = json.loads(path.read_text())
        for name, recipe in recipes.items():
            if recipe["dataset_id"] == dataset and not curriculum_matches(recipe, manifest):
                raise ValueError(f"The selected {dataset} package requires source definitions compatible with {name}")
        chosen[dataset] = path
    return recipes, chosen


def prepare_course(path, package_keys, data_root, *, minimum_free_gib=400, progress=None):
    root = Path(data_root).resolve()
    plan = read_plan(path)
    recipes, manifests = resolve_packages(plan, package_keys, root)
    inputs = {"plan": plan, "packages": {dataset: {"key": package_keys[dataset], "manifest_sha256": sha256(path)} for dataset, path in sorted(manifests.items())},
              "curricula": recipes, "software_version": __version__, "pydantic": version("pydantic"),
              "implementation": {name: sha256(Path(__file__).with_name(name)) for name in ["course_plans.py", "courses.py", "teaching.py", "model_teaching.py", "review.py", "provenance.py"]}}
    if any(step.get("source_annotation") for recipe in recipes.values() for step in recipe["scenes"]):
        for name in ("source_annotations.py", "blender_annotations.py"):
            inputs["implementation"][name] = sha256(Path(__file__).with_name(name))
    signature = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
    identity = str(uuid.uuid5(uuid.NAMESPACE_URL, "neuroimage-course-plan:" + signature))
    folder = destination(root, f"exports/course-preparations/{plan['id']}/{signature[:16]}")
    if any(parent.is_symlink() for parent in [folder, *folder.parents] if parent != root and parent.is_relative_to(root)):
        raise ValueError("Course preparation directories must remain inside the regular data layout")
    for name in ["progress.json", "preparation.json", ".progress.json.partial", ".preparation.json.partial", ".preparation.lock"]:
        if (folder / name).is_symlink():
            raise ValueError("Course preparation and recovery files must be regular metadata")
    capacity(root, 128 * 1024 ** 2, minimum_free_gib)
    folder.mkdir(parents=True, exist_ok=True)
    state_path, receipt_path = folder / "progress.json", folder / "preparation.json"
    with build_lock(folder / ".preparation.lock"):
        if receipt_path.is_file():
            if receipt_path.stat().st_size > BINDING_BYTES_LIMIT:
                raise ValueError("Course preparation receipts must be bounded metadata")
            receipt = json.loads(receipt_path.read_text())
            saved = get_course(root, identity, inspect_sources=False)
            if receipt.get("signature") != signature or saved["revision"] != receipt.get("course_sha256"):
                raise ValueError("This prepared course has been edited. Preserve your course and prepare a new plan revision")
            return {"status": "reused", "course_id": identity, "course": str(root / "exports/courses" / identity / "course.json"),
                    "receipt": str(receipt_path), "views": len(plan["views"]), "source_count": len(manifests)}
        if state_path.exists():
            if state_path.is_symlink() or state_path.stat().st_size > BINDING_BYTES_LIMIT:
                raise ValueError("Course preparation progress must be bounded regular metadata")
            state = json.loads(state_path.read_text())
            if state.get("signature") != signature:
                raise ValueError("Retain the existing course progress and use its original preparation inputs")
        else:
            state = {"signature": signature, "created_utc": utc_now(), "completed": {}}
            atomic_json(state_path, state)
        notebooks = {}
        for index, (name, recipe) in enumerate(recipes.items(), 1):
            result = prepare(manifests[recipe["dataset_id"]], curriculum_path(name), root, minimum_free_gib=minimum_free_gib)
            notebook_path = Path(result["notebook"])
            notebooks[name] = json.loads(notebook_path.read_text())
            state["completed"][name] = {"path": notebook_path.relative_to(root).as_posix(), "sha256": sha256(notebook_path)}
            atomic_json(state_path, state)
            if progress:
                progress({"event": "course-notebook-ready", "curriculum": name, "completed": index, "total": len(recipes), "status": result["status"]})
        entries = []
        for view in plan["views"]:
            name = view["curriculum"]
            index = next(i for i, step in enumerate(recipes[name]["scenes"]) if step["id"] == view["view"])
            entry = notebooks[name]["scenes"][index]
            entries.append({"id": view["id"], "title": view.get("title", entry["title"]), "prompt": view.get("prompt", entry["prompt"]), "scene": entry["scene"]})
        course = {"schema_version": "1.0", "kind": "neuroimage-teaching-course", "id": identity,
                  "title": plan["title"], "author": plan["author"], "objective": plan["objective"],
                  "created_utc": state["created_utc"], "updated_utc": state["created_utc"], "entries": entries}
        saved = save_course(course, root, minimum_free_gib=minimum_free_gib)
        atomic_json(receipt_path, {"schema_version": "1.0", "signature": signature, "inputs": inputs,
                    "course_id": identity, "course_sha256": saved["revision"], "notebooks": state["completed"],
                    "method": "Original prepared source scenes selected by stable curriculum view IDs; native coordinates and processing records retained"})
    return {"status": "prepared", "course_id": identity, "course": str(root / "exports/courses" / identity / "course.json"),
            "receipt": str(receipt_path), "views": len(entries), "source_count": len(manifests)}
