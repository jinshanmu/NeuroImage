"""Discover local construction results and resolve exact saved-content bindings."""
from pathlib import Path
import json
from .validation import validate_package

BOUND_FIELDS = ("package_id", "package_version", "build_signature", "space_id")
BINDING_BYTES_LIMIT = 10 * 1024 * 1024


def library_records(data_root, *, dataset=None):
    """Inspect metadata and file sizes without decompressing images or computing hashes."""
    root = Path(data_root).resolve()
    if not root.is_dir():
        raise ValueError("The data root must be an existing directory")
    derivative_root = root / "derivatives"
    if derivative_root.is_symlink():
        raise ValueError("The derivatives directory must stay inside the configured data root")
    if not derivative_root.is_dir():
        return []
    folders = sorted({p.parent for pattern in ("*/*/manifest.json", "*/*/.build-state.json")
                      for p in derivative_root.glob(pattern)})
    records = []
    for folder in folders:
        if dataset is not None and folder.parent.name != dataset:
            continue
        record = {"dataset_id": folder.parent.name, "folder_version": folder.name,
                  "directory": str(folder), "status": "incomplete", "asset_hashes": "not_checked",
                  "geometry": "not_checked", "independent_anatomical_review": "not_performed"}
        manifest_path = folder / "manifest.json"
        try:
            if folder.is_symlink() or folder.parent.is_symlink() or not folder.resolve().is_relative_to(derivative_root.resolve()):
                raise ValueError("A library package directory must stay inside the configured derivatives root")
            if manifest_path.exists():
                if manifest_path.is_symlink():
                    raise ValueError("Library manifests must not be symbolic links")
                manifest = validate_package(manifest_path, verify_hashes=False, verify_geometry=False)
                record.update({
                    "status": "available", "manifest": str(manifest_path), "title": manifest.title,
                    "dataset_id": manifest.dataset_id, "package_id": manifest.package_id,
                    "package_version": manifest.package_version, "build_signature": manifest.build["signature"],
                    "space_id": manifest.space.id, "space_name": manifest.space.name,
                    "representation": manifest.representation, "structures": len(manifest.structures),
                    "created_utc": manifest.build.get("created_utc", ""),
                    "probability_channels": sum(v.kind == "probability" for v in manifest.volumes),
                    "declared_asset_bytes": sum(asset.bytes for asset in manifest.assets),
                    "asset_paths_and_sizes": "passed", "construction_software": manifest.build["software_version"],
                    "sources": [{"id": source.id, "version": source.version, "license_name": source.license_name}
                                for source in manifest.sources],
                })
            else:
                state_path = folder / ".build-state.json"
                if state_path.is_symlink():
                    raise ValueError("Library checkpoints must not be symbolic links")
                state = json.loads(state_path.read_text())
                completed = state.get("completed", {})
                if not isinstance(completed, dict):
                    raise ValueError("The construction checkpoint has invalid asset records")
                record.update({"completed_assets": len(completed), "checkpoint": str(state_path),
                               "detail": "No completed manifest. Resume the original build recipe; do not select this directory for viewing."})
        except (ValueError, OSError, KeyError, TypeError, AttributeError) as error:
            record.update({"status": "unavailable", "detail": str(error)})
        records.append(record)
    return records


def content_binding(path):
    """Read identity only; detailed view-state validation remains the viewer's responsibility."""
    path = Path(path)
    if path.stat().st_size > BINDING_BYTES_LIMIT:
        raise ValueError("Saved content exceeds the 10 MiB notebook limit")
    with path.open("rb") as stream:
        serialized = stream.read(BINDING_BYTES_LIMIT + 1)
    if len(serialized) > BINDING_BYTES_LIMIT:
        raise ValueError("Saved content exceeds the 10 MiB notebook limit")
    return binding_from_content(json.loads(serialized))


def binding_from_content(content):
    """Validate shared scene identity independently of the view representation."""
    if not isinstance(content, dict) or content.get("schema_version") != "1.0" or content.get("kind") not in {
        "neuroimage-scene", "neuroimage-teaching-notebook"
    }:
        raise ValueError("Expected a NeuroImage scene or teaching notebook with schema version 1.0")
    binding = {key: content.get(key) for key in BOUND_FIELDS}
    if any(not isinstance(value, str) or not value or len(value) > 256 for value in binding.values()):
        raise ValueError("Saved content has an incomplete atlas binding")
    if content["kind"] == "neuroimage-teaching-notebook":
        scenes = content.get("scenes")
        if not isinstance(scenes, list) or len(scenes) > 50:
            raise ValueError("A teaching notebook requires an array of no more than 50 scenes")
        for entry in scenes:
            scene = entry.get("scene") if isinstance(entry, dict) else None
            if not isinstance(scene, dict) or any(scene.get(key) != value for key, value in binding.items()):
                raise ValueError("An embedded scene does not match the notebook's atlas version or native space")
    return {"kind": content["kind"], **binding}


def locate_content(path, data_root):
    """Resolve a preserved package by exact identity, never by date or similar anatomy names."""
    binding = content_binding(path)
    return locate_binding(binding, library_records(data_root))


def locate_binding(binding, records):
    """Resolve one immutable binding against an already inspected local library."""
    matches = [record for record in records if record["status"] == "available"
               and all(record.get(key) == binding[key] for key in BOUND_FIELDS)]
    if not matches:
        alternatives = sorted({record.get("package_version") for record in records
                               if record.get("package_id") == binding["package_id"] and record.get("package_version")})
        suffix = f" Available versions of this package: {', '.join(alternatives)}." if alternatives else ""
        raise ValueError(f"Matching package {binding['package_id']} / {binding['package_version']} was not found or is unavailable. "
                         "Retain or recover the exact original atlas package; a newer version is not substituted." + suffix)
    if len(matches) != 1:
        raise ValueError("More than one local directory declares this exact atlas identity. Select an explicit manifest after validating the copies.")
    return {"status": "matched", "binding": binding, "manifest": matches[0]["manifest"],
            "validation": "Metadata and declared asset paths/sizes checked; hashes and geometry are validated when serving. The viewer validates the imported scene state."}
