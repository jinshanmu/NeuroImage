"""Checkpointed byte-preserving packaging of native images or scalar fields."""
from pathlib import Path
import json
import os
import shutil
import time

import numpy as np
import nibabel as nib

from . import __version__
from .build import asset_record, atomic_json, intact, sha256, volume_record
from .contracts import Manifest, Source, Space
from .geometry import read_volume, save_nifti


def construct(imported, root, signature, inputs, software, libraries, workers, available, peak, started):
    recipe = imported.recipe
    state_path, manifest_path = root / ".build-state.json", root / "manifest.json"
    from .build import utc_now
    state = json.loads(state_path.read_text()) if state_path.exists() else {"signature": signature, "completed": {}, "created_utc": utc_now()}
    if state["signature"] != signature:
        raise ValueError("Checkpoint signature mismatch")
    completed = state["completed"]
    if (state.get("status") == "complete" and manifest_path.is_file()
            and state.get("manifest_sha256") == sha256(manifest_path)
            and all(intact(root, record["asset"]) for record in completed.values())):
        Manifest.model_validate_json(manifest_path.read_text())
        print(json.dumps({"event": "build-complete", "dataset": recipe["id"], "manifest": str(manifest_path),
                          "reused": len(completed), "built": 0, "geometry_recomputed": False,
                          "seconds": round(time.monotonic() - started, 2)}), flush=True)
        return manifest_path
    for folder in ("volumes", "licenses", "source-volumes"):
        (root / folder).mkdir(exist_ok=True)
    counts = {"reused": 0, "built": 0}

    def asset(key, relative, role, metadata, writer):
        record = completed.get(key)
        if record and intact(root, record["asset"]):
            counts["reused"] += 1
            return record
        target = root / relative
        temporary = target.with_name(".partial-" + target.name)
        writer(temporary)
        os.replace(temporary, target)
        record = {"asset": asset_record(target, root, role), "metadata": metadata}
        completed[key] = record
        counts["built"] += 1
        atomic_json(state_path, state)
        return record

    print(json.dumps({"event": "build-start", "dataset": recipe["id"], "package_version": signature[:16],
                      "workers": 1, "free_gib": round(available, 2), "estimated_peak_gib": peak}), flush=True)
    scalar = recipe.get("representation") == "scalar-fields"
    source_frame = recipe.get("adapter") == "native-nifti-frame"
    images, field_reports = [], []
    for spec in recipe["images"]:
        input_id = spec["source_input"] if source_frame else spec["id"]
        original = imported.input_paths[input_id]
        if not original.name.endswith((".nii", ".nii.gz")):
            raise ValueError("Native volume packaging requires a source NIfTI file")
        native = read_volume(original, frame=spec["source_frame"] if source_frame else None)
        if native.source_geometry["header_units"] != "mm":
            raise ValueError("Byte-preserving volumes must declare millimeter units in their original header")
        suffix = ".nii.gz" if original.name.endswith(".nii.gz") else ".nii"
        relative = f"volumes/{spec['id']}{suffix}"
        kind = "scalar" if scalar else "image"
        metadata = volume_record(spec["id"], spec["name"], kind, relative, native, scalar=spec.get("scalar"))
        if scalar:
            metadata["scalar"] = spec["scalar"]
            if spec.get("display_range"):
                metadata["cal_min"], metadata["cal_max"] = spec["display_range"]
        if source_frame:
            source_relative = f"source-volumes/{input_id}{suffix}"
            asset("original:"+input_id, source_relative, "source-volume", {}, lambda target: shutil.copyfile(original,target))
            metadata["native_frame"] = {"source_input":input_id,"source_file":source_relative,"source_shape":list(nib.load(original).shape),
                "frame":spec["source_frame"],"extraction":"exact-native-frame-no-interpolation"}
        image = asset("volume:" + spec["id"], relative, kind, metadata,
                      (lambda target: save_nifti(native,target)) if source_frame else (lambda target: shutil.copyfile(original, target)))
        original_record = next(item for item in inputs if item["id"] == input_id)
        if not source_frame and image["asset"]["sha256"] != original_record["sha256"]:
            raise ValueError("Native volume packaging changed original source bytes")
        images.append(image["metadata"])
        field_reports.append({"id": spec["id"], "source_geometry": native.source_geometry,
            "native_voxel_count": int(native.data.size), "source_intensity_range": [float(native.data.min()), float(native.data.max())],
            "source_image_sha256": original_record["sha256"]})
    sources = []
    for source in recipe["sources"]:
        record = dict(source)
        license_path = imported.input_paths[record.pop("license_input")]
        relative = f"licenses/{record['id']}{license_path.suffix}"
        asset("license:" + record["id"], relative, "license", {}, lambda target: shutil.copyfile(license_path, target))
        sources.append(Source(**record, license_file=relative).model_dump())
    asset("lessons", "lessons.json", "lessons", {}, lambda target: atomic_json(target, {"schema_version": "1.0", "lessons": []}))
    corners = np.array([[x, y, z] for x in (-.5, native.data.shape[0] - .5)
                        for y in (-.5, native.data.shape[1] - .5) for z in (-.5, native.data.shape[2] - .5)])
    world = corners @ native.affine[:3, :3].T + native.affine[:3, 3]
    report = {"engineering_status": "passed", "anatomical_review": "not_performed",
              "scope": "Exact source bytes, finite native image samples, declared units, coded forms and field of view; no anatomical segmentation or expert review",
              "source_geometry": native.source_geometry, "native_voxel_count": int(native.data.size),
              "source_intensity_range": [float(native.data.min()), float(native.data.max())],
              "fov_corners_ras_mm": world.tolist(), "source_image_sha256": original_record["sha256"],
              "warnings": recipe["scope_notes"]}
    if scalar:
        report["scope"] = "Exact source field bytes, finite samples, metric units, native grid and declared ranges; no synthesized MRI or anatomical segmentation"
        report["fields"] = field_reports
    if source_frame:
        report["scope"] = "Exact original 4D source bytes and unchanged selected native 3D frame samples, grid and physical units; no interpolation, averaging, registration or invented anatomy"
    asset("validation", "validation.json", "validation", {}, lambda target: atomic_json(target, report))
    manifest = Manifest(schema_version="1.9" if source_frame else "1.8" if scalar else "1.6", representation="scalar-fields" if scalar else "mri-volume", package_id=recipe["id"], dataset_id=recipe["id"],
        title=recipe["title"], package_version=signature[:16], space=Space(**recipe["space"]), sources=sources,
        volumes=images, structures=[], assets=[value["asset"] for _, value in sorted(completed.items())], lessons_file="lessons.json",
        build={"software_version": __version__, "signature": signature, "created_utc": state["created_utc"], "recipe_id": recipe["id"],
               "recipe_version": recipe["version"], "recipe": recipe, "implementation": software, "libraries": libraries, "inputs": inputs,
               "parameters": {"source_image": "Original 4D NIfTI bytes plus exactly selected native 3D frame" if source_frame else "byte-identical NIfTI", "registration": "none", "resampling": "none", "segmentation": "none", "surface_extraction": "none"}},
        validation={"engineering_status": "passed", "anatomical_review": "not_performed", "report": "validation.json", "warnings": report["warnings"]})
    from .validation import validate_geometry, validate_lessons
    validate_geometry(manifest, root)
    validate_lessons(manifest, root)
    atomic_json(manifest_path, manifest.model_dump())
    state.update(status="complete", manifest_sha256=sha256(manifest_path))
    atomic_json(state_path, state)
    print(json.dumps({"event": "build-complete", "dataset": recipe["id"], "manifest": str(manifest_path),
                      "seconds": round(time.monotonic() - started, 2), **counts}), flush=True)
    return manifest_path
