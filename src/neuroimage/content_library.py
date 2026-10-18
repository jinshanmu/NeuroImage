"""Discover and preserve small teaching files independently of acquired atlas data."""
from pathlib import Path
import hashlib
import json

from .acquire import capacity, destination
from .build import atomic_json, build_lock, sha256
from .library import BINDING_BYTES_LIMIT, binding_from_content, library_records, locate_binding

CONTENT_PATTERNS = ("*/notebooks/*/prepared-notebook.json", "*/teaching/*/content.json")


def read_content(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > BINDING_BYTES_LIMIT:
        raise ValueError("Select a regular teaching JSON file of up to 10 MiB")
    with path.open("rb") as stream:
        serialized = stream.read(BINDING_BYTES_LIMIT + 1)
    if len(serialized) > BINDING_BYTES_LIMIT:
        raise ValueError("Teaching content exceeds the 10 MiB limit")
    content = json.loads(serialized)
    binding = binding_from_content(content)
    return content, binding, hashlib.sha256(serialized).hexdigest()


def _paths(root):
    exports = root / "exports"
    if exports.is_symlink():
        raise ValueError("Teaching exports must remain inside the configured data root")
    for pattern in CONTENT_PATTERNS:
        for path in exports.glob(pattern):
            if (path.is_file() and not any(parent.is_symlink() for parent in [path, *path.parents] if parent != root and parent.is_relative_to(root))
                    and path.resolve().is_relative_to(exports)):
                yield path


def teaching_records(data_root, *, query="", dataset=""):
    root = Path(data_root).resolve()
    if not isinstance(query, str) or len(query) > 200 or not isinstance(dataset, str) or len(dataset) > 100:
        raise ValueError("Use a teaching query of up to 200 characters and an optional source ID")
    packages = library_records(root)
    records, skipped, seen = [], 0, set()
    for path in sorted(_paths(root)):
        try:
            content, binding, digest = read_content(path)
            if digest in seen:
                continue
            seen.add(digest)
            entry = {"key": digest, "kind": binding["kind"], "title": str(content.get("title", "Saved teaching"))[:200],
                "author": str(content.get("author", ""))[:200], "objective": str(content.get("objective", ""))[:2000],
                "views": len(content["scenes"]) if binding["kind"] == "neuroimage-teaching-notebook" else 1,
                "binding": binding, "relative_path": path.relative_to(root).as_posix(),
                "bytes": path.stat().st_size, "status": "ready", "dataset_id": binding["package_id"]}
            try:
                match = locate_binding(binding, packages)
                record = next(item for item in packages if item.get("manifest") == match["manifest"])
                entry.update(dataset_id=record["dataset_id"], source_title=record["title"],
                             representation=record["representation"], space_name=record["space_name"])
            except ValueError as error:
                entry.update(status="source_required", detail=str(error))
            searchable = " ".join([entry["title"], entry["author"], entry["objective"], entry["dataset_id"]]).lower()
            if (not dataset or entry["dataset_id"] == dataset) and query.lower() in searchable:
                records.append(entry)
        except (OSError, ValueError, TypeError, KeyError):
            skipped += 1
    records.sort(key=lambda item: (item["title"].casefold(), item["binding"]["package_version"], item["key"]))
    return {"schema_version": "1.0", "records": records, "skipped_files": skipped,
            "scope": "Prepared and explicitly imported teaching files; exact source package versions are retained"}


def open_teaching(data_root, key, register_package):
    if not isinstance(key, str) or len(key) != 64 or any(char not in "0123456789abcdef" for char in key):
        raise ValueError("Choose a teaching file from the local library")
    root = Path(data_root).resolve()
    for path in _paths(root):
        try:
            content, binding, digest = read_content(path)
        except (OSError, ValueError):
            continue
        if digest != key:
            continue
        match = locate_binding(binding, library_records(root))
        atlas_key = register_package(match["manifest"])
        return {"atlas_key": atlas_key, "content": content, "content_key": digest}
    raise ValueError("Refresh the teaching library to locate this saved file")


def import_teaching(content, data_root, *, minimum_free_gib=400):
    """Store an explicit user import once; historical source packages stay separate."""
    root = Path(data_root).resolve()
    binding = binding_from_content(content)
    locate_binding(binding, library_records(root))
    serialized = (json.dumps(content, indent=2, allow_nan=False) + "\n").encode()
    if len(serialized) > BINDING_BYTES_LIMIT:
        raise ValueError("Teaching content exceeds the 10 MiB limit")
    digest = hashlib.sha256(serialized).hexdigest()
    relative = f"exports/{binding['package_id']}/teaching/{digest}/content.json"
    target = destination(root, relative)
    capacity(root, len(serialized) * 2, minimum_free_gib)
    target.parent.mkdir(parents=True, exist_ok=True)
    with build_lock(target.parent / ".import.lock"):
        if target.exists():
            if sha256(target) != digest:
                raise ValueError("An existing teaching file has changed; preserve it before importing this copy")
            status = "reused"
        else:
            atomic_json(target, content)
            status = "imported"
    return {"status": status, "key": digest, "relative_path": relative, "binding": binding}
