"""Resumable native construction of independent overlapping source regions."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
import shutil
import threading
import time

import nibabel as nib
import numpy as np

from . import __version__
from .build import asset_record, atomic_json, intact, sha256, utc_now, volume_record
from .contracts import IndependentRegion, Manifest, Source, Space
from .geometry import NativeVolume, crop_native_volume, read_volume, save_nifti, save_surface, surface_from_mask


def construct(imported, root, signature, inputs, software, libraries, workers, available, peak, started):
    recipe = imported.recipe
    state_path, manifest_path = root / ".build-state.json", root / "manifest.json"
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
    for directory in ("volumes", "meshes", "licenses"):
        (root / directory).mkdir(exist_ok=True)
    counts, lock = {"reused": 0, "built": 0}, threading.Lock()

    def reuse(key):
        record = completed.get(key)
        if record and intact(root, record["asset"]):
            with lock:
                counts["reused"] += 1
            return record
        return None

    def finish(key, relative, role, metadata, writer):
        path = root / relative
        temporary = path.with_name(".partial-" + path.name)
        writer(temporary)
        os.replace(temporary, path)
        record = {"asset": asset_record(path, root, role), "metadata": metadata}
        with lock:
            completed[key] = record
            counts["built"] += 1
            atomic_json(state_path, state)
        return record

    def volume(ident, name, kind, native, maximum=1):
        record = reuse("volume:" + ident)
        if record is None:
            relative = f"volumes/{ident}.nii.gz"
            def writer(path):
                save_nifti(native, path)
                restored = nib.load(path)
                if not np.array_equal(np.asanyarray(restored.dataobj), native.data) or not np.allclose(restored.affine, native.affine, rtol=0, atol=1e-4):
                    raise ValueError(f"Native volume round-trip changed values or geometry: {ident}")
            record = finish("volume:" + ident, relative, kind,
                            volume_record(ident, name, kind, relative, native, probability_maximum=maximum), writer)
        return record["metadata"]

    print(json.dumps({"event": "build-start", "dataset": recipe["id"], "package_version": signature[:16],
                      "workers": max(1, min(workers, 2)), "free_gib": round(available, 2), "estimated_peak_gib": peak}), flush=True)
    reference = None
    volumes = []
    for spec in recipe["images"]:
        native = read_volume(imported.input_paths[spec["id"]], declared_nifti_units=recipe.get("nifti_units"))
        if "native_crop" in spec:
            native = crop_native_volume(native, spec["native_crop"])
        if reference is None:
            reference = native
        elif native.data.shape != reference.data.shape or not np.allclose(native.affine, reference.affine, rtol=0, atol=1e-5):
            raise ValueError("Source reference contrasts must share the declared native grid")
        volumes.append(volume(spec["id"], spec["name"], "image", native))
    sources = []
    for source in recipe["sources"]:
        spec = dict(source)
        original = imported.input_paths[spec.pop("license_input")]
        relative = f"licenses/{spec['id']}{original.suffix}"
        if not reuse("license:" + spec["id"]):
            finish("license:" + spec["id"], relative, "license", {}, lambda path: shutil.copyfile(original, path))
        sources.append(Source(**spec, license_file=relative).model_dump())
    membership_counts = np.zeros(reference.data.shape, dtype=np.uint16)

    def region(spec):
        source = {}
        region_volumes = []
        derived = spec["mask"].get("origin", "source") == "derived-from-probability"
        maximum = 100 if spec["probability"].get("units", "fraction") == "percent" else 1
        for role in (("probability",) if derived else ("mask", "probability")):
            item = spec[role]
            native = read_volume(imported.input_paths[item["source_input"]], declared_nifti_units=recipe.get("nifti_units"))
            if native.data.shape != reference.data.shape or not np.allclose(native.affine, reference.affine, rtol=0, atol=1e-5):
                raise ValueError(f"Independent source field differs from the declared reference grid: {spec['id']}")
            source[role] = native
        if derived:
            probability = source["probability"]
            source["mask"] = NativeVolume((probability.data >= spec["mask"]["threshold"]).astype(np.uint8), probability.affine.copy(),
                {**probability.source_geometry, "derived_from": spec["probability"]["source_input"],
                 "operation": "inclusive probability threshold", "threshold": spec["mask"]["threshold"],
                 "probability_units": spec["probability"].get("units", "fraction"), "registration": "none", "resampling": "none"})
        mask, probability = source["mask"], source["probability"]
        if not np.isin(mask.data, [0, 1]).all() or not np.any(mask.data) or probability.data.min() < 0 or probability.data.max() > maximum:
            raise ValueError(f"Invalid source mask or probability values: {spec['id']}")
        membership = mask.data == 1
        if not np.array_equal(membership, probability.data >= spec["mask"]["threshold"]):
            raise ValueError(f"Source mask does not match its documented inclusive threshold: {spec['id']}")
        for role, native in source.items():
            qualifier = "derived display " if role == "mask" and derived else "source "
            region_volumes.append(volume(spec[role]["volume_id"], spec["name"] + " " + qualifier + role, role, native, maximum))
        with lock:
            membership_counts[:] += membership
        record = reuse("mesh:" + spec["id"])
        if record is None:
            points, faces, statistics, qc = surface_from_mask(membership, mask.affine)
            relative = f"meshes/{spec['source_name']}.gii"
            record = finish("mesh:" + spec["id"], relative, "mesh", {"statistics": statistics, "qc": qc},
                            lambda path: save_surface(points, faces, path))
        structure = IndependentRegion(**spec, mesh_file=record["asset"]["path"], **record["metadata"]["statistics"])
        report = {"mask_geometry": mask.source_geometry, "probability_geometry": probability.source_geometry,
                  "mask_origin": spec["mask"].get("origin", "source"), "probability_units": spec["probability"].get("units", "fraction"),
                  "inclusive_threshold_equality_voxels": int(np.count_nonzero(probability.data == spec["mask"]["threshold"])),
                  "positive_probability_voxels_below_mask_threshold": int(np.count_nonzero((probability.data > 0) & ~membership)),
                  "probability_range": [float(probability.data.min()), float(probability.data.max())], **record["metadata"]["qc"]}
        print(json.dumps({"event": "region-ready", "dataset": recipe["id"], "region": spec["source_name"],
                          "mask_voxels": structure.voxel_count}), flush=True)
        return structure.model_dump(), region_volumes, report

    with ThreadPoolExecutor(max_workers=max(1, min(workers, 2))) as executor:
        results = list(executor.map(region, imported.structures))
    structures = [result[0] for result in results]
    volumes += [volume for result in results for volume in result[1]]
    membership_statistics = {"voxels_with_multiple_memberships": int(np.count_nonzero(membership_counts > 1)),
                             "maximum_memberships": int(membership_counts.max()),
                             "sum_memberships": int(membership_counts.sum()), "union_voxels": int(np.count_nonzero(membership_counts))}
    from .lessons import make_lessons
    if not reuse("lessons"):
        finish("lessons", "lessons.json", "lessons", {}, lambda path: atomic_json(path, make_lessons(recipe, structures)))
    report = {"engineering_status": "passed", "anatomical_review": "not_performed",
              "scope": "Native scalar values, independent memberships, inclusive probability threshold and unsmoothed mask boundaries",
              "regions": {result[0]["id"]: result[2] for result in results}, "membership_statistics": membership_statistics,
              "reference_geometry": reference.source_geometry,
              "warnings": [recipe["space"]["correspondence"], *recipe["region_notes"]]}
    if not reuse("validation"):
        finish("validation", "validation.json", "validation", {}, lambda path: atomic_json(path, report))
    explicit_units = recipe.get("probability_units", "fraction") != "fraction" or recipe["mask_rule"].get("origin", "source") != "source"
    manifest = Manifest(schema_version="1.5" if explicit_units else "1.4", representation="mri-regions", package_id=recipe["id"], dataset_id=recipe["id"],
        title=recipe["title"], package_version=signature[:16], space=Space(**recipe["space"]), sources=sources,
        volumes=volumes, structures=structures, assets=[record["asset"] for _, record in sorted(completed.items())], lessons_file="lessons.json",
        build={"software_version": __version__, "signature": signature, "created_utc": state["created_utc"], "recipe_id": recipe["id"],
               "recipe_version": recipe["version"], "recipe": recipe, "implementation": software, "libraries": libraries, "inputs": inputs,
               "parameters": {"registration": "none", "resampling": "none", "smoothing": False, "decimation": False,
                              "probability_value_retention": "all; original units unchanged", "probability_units": recipe.get("probability_units", "fraction"),
                              "membership_policy": "independent-masks-preserve-overlap", "mask_origin": recipe["mask_rule"].get("origin", "source"),
                              "surface_isovalue": .5, "mask_rule": recipe["mask_rule"]}},
        validation={"engineering_status": "passed", "anatomical_review": "not_performed", "report": "validation.json",
                    "membership_statistics": membership_statistics, "warnings": report["warnings"]})
    from .validation import validate_geometry, validate_lessons
    validate_geometry(manifest, root)
    validate_lessons(manifest, root)
    atomic_json(manifest_path, manifest.model_dump())
    state.update(status="complete", manifest_sha256=sha256(manifest_path))
    atomic_json(state_path, state)
    print(json.dumps({"event": "build-complete", "dataset": recipe["id"], "manifest": str(manifest_path),
                      "seconds": round(time.monotonic() - started, 2), **counts}), flush=True)
    return manifest_path
