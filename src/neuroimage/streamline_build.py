"""Checkpointed construction for overlapping source streamline bundles."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import os
import shutil
import threading
import time

import nibabel as nib
import numpy as np

from . import __version__
from .build import asset_record, atomic_json, intact, sha256, utc_now, volume_record
from .contracts import Manifest, Source, Space, StreamlineStructure
from .geometry import read_volume, save_nifti
from .streamlines import LEVEL_LIMITS, coordinate_digest, read_trackvis, subset_indices, tract_statistics, write_tck


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
    for directory in ("volumes", "streamlines", "licenses"):
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

    print(json.dumps({"event": "build-start", "dataset": recipe["id"], "package_version": signature[:16],
                      "workers": max(1, min(workers, 2)), "free_gib": round(available, 2), "estimated_peak_gib": peak}), flush=True)
    volumes = []
    reference = None
    for spec in recipe["images"]:
        ident, key = spec["id"], "volume:" + spec["id"]
        native = read_volume(imported.input_paths[ident], declared_nifti_units=recipe.get("nifti_units"))
        if reference is None:
            reference = native
        elif native.data.shape != reference.data.shape or not np.allclose(native.affine, reference.affine, rtol=0, atol=1e-5):
            raise ValueError("Streamline reference contrasts must share the source-declared grid")
        record = reuse(key)
        if not record:
            relative = f"volumes/{ident}.nii.gz"
            def writer(path):
                save_nifti(native, path)
                restored = nib.load(path)
                if not np.array_equal(np.asanyarray(restored.dataobj), native.data) or not np.allclose(restored.affine, native.affine, rtol=0, atol=1e-4):
                    raise ValueError("Reference image round-trip changed its values or geometry")
            record = finish(key, relative, "image", volume_record(ident, spec["name"], "image", relative, native), writer)
        volumes.append(record["metadata"])
    sources = []
    for source in recipe["sources"]:
        spec = dict(source)
        original = imported.input_paths[spec.pop("license_input")]
        key, relative = "license:" + spec["id"], f"licenses/{spec['id']}{original.suffix}"
        if not reuse(key):
            finish(key, relative, "license", {}, lambda path: shutil.copyfile(original, path))
        sources.append(Source(**spec, license_file=relative).model_dump())
    for ident in recipe.get("additional_license_inputs", []):
        original = imported.input_paths[ident]
        if not reuse("license:" + ident):
            finish("license:" + ident, f"licenses/{ident}{original.suffix}", "license", {}, lambda path: shutil.copyfile(original, path))

    def bundle(spec):
        ident = spec["source_name"]
        prefix = "bundle:" + ident + ":"
        existing = {level: reuse(prefix + level) for level in (*LEVEL_LIMITS, "full")}
        indices = {level: reuse(prefix + level + ":indices") for level in LEVEL_LIMITS}
        tracts = None
        if not all([*existing.values(), *indices.values()]):
            tracts, header = read_trackvis(imported.input_paths[spec["source_input"]])
            statistics = tract_statistics(tracts, reference, spec["laterality"])
            metadata = {"header": header, "statistics": statistics}
            if existing["full"] is None:
                relative = f"streamlines/{ident}-full.tck"
                def writer(path):
                    write_tck(path, tracts)
                    restored = nib.streamlines.TckFile.load(path, lazy_load=True).streamlines
                    if coordinate_digest(restored) != header["decoded_ras_sha256"]:
                        raise ValueError("Independent TCK read changed source points, order or streamline boundaries")
                existing["full"] = finish(prefix + "full", relative, "streamlines", metadata, writer)
            for level, limit in LEVEL_LIMITS.items():
                selected = subset_indices(len(tracts), limit)
                relative = f"streamlines/{ident}-{level}.tck"
                subset = tracts[selected]
                if existing[level] is None:
                    existing[level] = finish(prefix + level, relative, "streamlines",
                        {"count": len(selected), "points": sum(len(points) for points in subset)}, lambda path: write_tck(path, subset))
                if indices[level] is None:
                    indices[level] = finish(prefix + level + ":indices", f"streamlines/{ident}-{level}-indices.json", "streamline-index", {},
                        lambda path: atomic_json(path, {"source_streamline_count": len(tracts), "indices": selected.tolist(), "method": "uniform-source-index-whole-streamlines"}))
        metadata = existing["full"]["metadata"]
        statistics, header = metadata["statistics"], metadata["header"]
        levels = [{"id": level, "file": existing[level]["asset"]["path"], "indices_file": indices[level]["asset"]["path"],
                   "streamline_count": existing[level]["metadata"]["count"], "point_count": existing[level]["metadata"]["points"]} for level in LEVEL_LIMITS]
        levels.append({"id": "full", "file": existing["full"]["asset"]["path"], "streamline_count": header["count"], "point_count": statistics["point_count"]})
        structure = StreamlineStructure(**{k: v for k, v in spec.items() if k != "source_input"},
            **{key: statistics[key] for key in ("center_ras_mm", "target_ras_mm", "bounds_ras_mm")},
            streamlines={"source_input": spec["source_input"], "source_streamline_count": header["count"], "source_point_count": statistics["point_count"],
                         "decoded_ras_sha256": header["decoded_ras_sha256"], "target_streamline_index": statistics["target_streamline_index"],
                         "target_point_index": statistics["target_point_index"], "sampling": "uniform-source-index-whole-streamlines", "levels": levels})
        print(json.dumps({"event": "bundle-ready", "dataset": recipe["id"], "bundle": ident,
                          "source_streamlines": header["count"], "source_points": statistics["point_count"]}), flush=True)
        return structure.model_dump(), metadata

    with ThreadPoolExecutor(max_workers=max(1, min(workers, 2))) as executor:
        results = list(executor.map(bundle, imported.structures))
    structures = [item[0] for item in results]
    from .lessons import make_lessons
    if not reuse("lessons"):
        finish("lessons", "lessons.json", "lessons", {}, lambda path: atomic_json(path, make_lessons(recipe, structures)))
    report = {"engineering_status": "passed", "anatomical_review": "not_performed",
              "scope": "Source-byte preservation, independent format decoding, reference field of view and exact display subsets; not anatomical connectivity validation",
              "bundles": {structure["id"]: result[1] for structure, result in zip(structures, results)},
              "source_reference_geometry": reference.source_geometry,
              "source_relationship": recipe["space"]["correspondence"],
              "warnings": [recipe["space"]["correspondence"], "Tractography trajectories are computational estimates, not observed axons, axon counts or validated functional connectivity.",
                           "Display levels retain selected complete source trajectories. Their density does not represent confidence or population probability.",
                           "Separately delivered occupancy and population-probability maps are not included; no correspondence to them is claimed."]}
    if not reuse("validation"):
        finish("validation", "validation.json", "validation", {}, lambda path: atomic_json(path, report))
    manifest = Manifest(schema_version="1.3", representation="mri-streamlines", package_id=recipe["id"], dataset_id=recipe["id"],
        title=recipe["title"], package_version=signature[:16], space=Space(**recipe["space"]), sources=sources, volumes=volumes, structures=structures,
        assets=[record["asset"] for _, record in sorted(completed.items())], lessons_file="lessons.json",
        build={"software_version": __version__, "signature": signature, "created_utc": state["created_utc"], "recipe_id": recipe["id"],
               "recipe_version": recipe["version"], "recipe": recipe, "implementation": software, "libraries": libraries, "inputs": inputs,
               "parameters": {"registration": "none", "resampling": "none", "smoothing": False, "point_simplification": False,
                              "source_point_retention": "all", "display_sampling": "uniform-source-index-whole-streamlines", "display_limits": LEVEL_LIMITS}},
        validation={"engineering_status": "passed", "anatomical_review": "not_performed", "report": "validation.json", "warnings": report["warnings"]})
    # Check geometry before advertising a complete, reusable package.
    from .validation import validate_geometry, validate_lessons
    validate_geometry(manifest, root)
    validate_lessons(manifest, root)
    atomic_json(manifest_path, manifest.model_dump())
    state.update(status="complete", manifest_sha256=sha256(manifest_path))
    atomic_json(state_path, state)
    print(json.dumps({"event": "build-complete", "dataset": recipe["id"], "manifest": str(manifest_path),
                      "seconds": round(time.monotonic() - started, 2), **counts}), flush=True)
    return manifest_path
