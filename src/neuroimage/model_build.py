"""Build an independent native surface model without a fabricated reference image."""
import hashlib
import errno
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

import numpy as np

from . import __version__
from .build import asset_record, atomic_json, intact, sha256, utc_now
from .contracts import Manifest, ModelSpace, ModelSurface, Source
from .lessons import make_lessons
from .model_geometry import read_source_geometry, save_model, validate_models


def blender_runtime(recipe):
    executable = shutil.which("blender")
    if executable is None:
        raise ValueError("This source recipe requires the recorded Blender application runtime; install its declared version separately from the NeuroImage Conda environment")
    result = subprocess.run([executable, "--version"], capture_output=True, text=True, timeout=30, check=True)
    first = result.stdout.splitlines()[0]
    if first != "Blender " + recipe["blender_version"]:
        raise ValueError(f"This source recipe requires Blender {recipe['blender_version']}; found {first}. Preserve this version or declare a new source recipe before changing geometric conversion.")
    return executable, first


def model_catalog(recipe):
    if recipe.get("representation") != "surface-model" or recipe["space"]["coordinate_system"] != "SOURCE_XYZ":
        raise ValueError("Source models require an independent native coordinate representation")
    structures = []
    if recipe.get("mesh_geometry_stage", "base") not in {"base", "author-viewport"}:
        raise ValueError("Unknown source mesh geometry stage")
    if recipe["adapter"] in {"stl-source-surfaces", "gifti-source-surfaces"}:
        scale = recipe.get("source_to_mm")
        if (not isinstance(scale, (int, float)) or isinstance(scale, bool) or not np.isfinite(scale) or scale <= 0
                or not recipe["space"].get("unit_basis") or recipe.get("mesh_geometry_stage", "base") != "base"
                or any(item["source_type"] != "MESH" for item in recipe["objects"])):
            raise ValueError("Surface-file recipes require explicit source units and unchanged source facets")
    for item in recipe["objects"]:
        if item["input"] not in recipe["inputs"]:
            raise ValueError("Model object references an unavailable source input")
        structures.append({"kind": "model-surface", **{key: item[key] for key in ("id", "name", "source_name", "category", "laterality", "color")},
                           "evidence": recipe["model_evidence"], "source_notes": [*recipe["model_notes"], *item.get("notes", [])],
                           "source_input": item["input"], "source_type": item["source_type"]})
    if not structures or len({item["id"] for item in structures}) != len(structures) or len({item["source_name"] for item in structures}) != len(structures):
        raise ValueError("Selected model object IDs and original names must be unique")
    make_lessons(recipe, structures)
    return structures


def construct(imported, root, signature, inputs, software, libraries, workers, available, peak, started):
    recipe = imported.recipe
    checkpoint = root / ".build-state.json"
    manifest_path = root / "manifest.json"
    state = json.loads(checkpoint.read_text()) if checkpoint.exists() else {"signature": signature, "created_utc": utc_now(), "completed": {}}
    if state["signature"] != signature:
        raise ValueError("Model construction checkpoint identity changed")
    completed = state["completed"]
    if (state.get("status") == "complete" and manifest_path.is_file() and state.get("manifest_sha256") == sha256(manifest_path)
            and all(intact(root, item["asset"]) for item in completed.values())):
        Manifest.model_validate_json(manifest_path.read_text())
        print(json.dumps({"event": "build-complete", "dataset": recipe["id"], "manifest": str(manifest_path),
                          "seconds": round(time.monotonic() - started, 2), "reused": len(completed), "built": 0, "geometry_recomputed": False}), flush=True)
        return manifest_path
    for name in ("source-geometry", "meshes", "licenses"):
        (root / name).mkdir(exist_ok=True)
    counts = {"reused": 0, "built": 0}

    def reuse(key):
        item = completed.get(key)
        if item and intact(root, item["asset"]):
            counts["reused"] += 1
            return item
        return None

    def finish(key, path, role, metadata):
        item = {"asset": asset_record(path, root, role), "metadata": metadata}
        completed[key] = item
        counts["built"] += 1
        atomic_json(checkpoint, state)
        return item

    def write_asset(key, relative, role, writer):
        item = reuse(key)
        if item:
            return item
        path = root / relative
        temporary = path.with_name(".partial-" + path.name)
        writer(temporary)
        os.replace(temporary, path)
        return finish(key, path, role, {})

    keyed = [(hashlib.sha256(item["id"].encode()).hexdigest()[:20], item) for item in imported.structures]
    cache_parameters = {
        "source_inputs": [{key: record[key] for key in ("id", "sha256")} for record in inputs
                          if record["id"] in {item["source_input"] for item in imported.structures}]}
    if recipe["adapter"] in {"stl-source-surfaces", "gifti-source-surfaces"}:
        extractor = "stl_extract.py" if recipe["adapter"] == "stl-source-surfaces" else "gifti_extract.py"
        cache_parameters.update(extractor=software[extractor], source_to_mm=recipe["source_to_mm"])
    else:
        cache_parameters.update(extractor=software["blender_extract.py"], blender=libraries["blender_embedded_runtime"],
                                source_scale_length=recipe["source_scale_length"], mesh_geometry_stage=recipe.get("mesh_geometry_stage", "base"))
    cache_signature = hashlib.sha256(json.dumps(cache_parameters, sort_keys=True).encode()).hexdigest()[:20]
    source_cache = root.parents[2] / "cache" / recipe["id"] / "source-models" / cache_signature
    source_cache.mkdir(parents=True, exist_ok=True)
    missing = []
    for key, item in keyed:
        raw = source_cache / (key + ".npz")
        meta = raw.with_suffix(".json")
        original = next(record for record in inputs if record["id"] == item["source_input"])
        if raw.exists() and meta.exists():
            record = json.loads(meta.read_text())
            if (record.get("source_sha256") == original["sha256"] and record.get("source_object") == item["source_name"]
                    and record.get("source_geometry_sha256") == sha256(raw)):
                continue
        missing.append({"key": key, "source_name": item["source_name"], "source_type": item["source_type"], "source_input": item["source_input"]})
    print(json.dumps({"event": "build-start", "dataset": recipe["id"], "package_version": signature[:16],
                      "source_objects": len(keyed), "pending_extraction": len(missing), "estimated_peak_gib": peak, "free_gib": round(available, 2)}), flush=True)
    if missing and recipe["adapter"] in {"stl-source-surfaces", "gifti-source-surfaces"}:
        if recipe["adapter"] == "stl-source-surfaces":
            from .stl_extract import extract_source
        else:
            from .gifti_extract import extract_source
        for item in missing:
            source_hash = next(record["sha256"] for record in inputs if record["id"] == item["source_input"])
            extract_source(imported.input_paths[item["source_input"]], source_cache, item, source_hash, recipe["source_to_mm"])
        missing = []
    if missing:
        source_ids = {item["source_input"] for item in missing}
        if len(source_ids) != 1:
            raise ValueError("A Blender model recipe must identify one original source file")
        source_id = next(iter(source_ids))
        request = {"source_sha256": next(item["sha256"] for item in inputs if item["id"] == source_id),
                   "source_scale_length": recipe["source_scale_length"], "objects": missing,
                   "mesh_geometry_stage": recipe.get("mesh_geometry_stage", "base"),
                   "output": str(source_cache)}
        executable, _ = blender_runtime(recipe)
        with tempfile.TemporaryDirectory(prefix="neuroimage-model-") as temporary:
            request_path = Path(temporary) / "request.json"
            atomic_json(request_path, request)
            command = [executable, "--background", "--factory-startup", "--disable-autoexec", "--threads", str(max(1, min(workers, 4))),
                       str(imported.input_paths[source_id]), "--python-exit-code", "2", "--python", str(Path(__file__).with_name("blender_extract.py")),
                       "--", "--request", str(request_path)]
            process = subprocess.Popen(command)
            try:
                if process.wait() != 0:
                    raise ValueError("Source model extraction failed; completed objects are retained for resume")
            except BaseException:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.wait()
                raise
    structures, rounding_max = [], 0.0
    for key, item in keyed:
        relative = "source-geometry/" + key
        raw, provenance = root / (relative + ".npz"), root / (relative + ".json")
        for suffix, path in (("raw", raw), ("provenance", provenance)):
            if not reuse(key + ":" + suffix):
                cached = source_cache / path.name
                temporary = path.with_name(".link-" + path.name)
                if temporary.exists():
                    temporary.unlink()
                # Source caches and local derivatives share the data drive.
                # Immutable hard links retain exact bytes without duplicate
                # copies when a lesson or package contract changes.
                try:
                    os.link(cached, temporary)
                except OSError as error:
                    if error.errno not in {errno.EPERM, errno.EXDEV, errno.EOPNOTSUPP}:
                        raise
                    # Portable packages must be self-contained even on data
                    # filesystems that do not implement hard links.
                    shutil.copyfile(cached, temporary)
                os.replace(temporary, path)
                finish(key + ":" + suffix, path, "source-geometry", {})
        original, faces, transform, points, rounding = read_source_geometry(raw)
        rounding_max = max(rounding_max, rounding)
        source_record = json.loads(provenance.read_text())
        center = points.mean(axis=0, dtype=np.float64)
        target = int(np.argmin(np.sum((points.astype(np.float64) - center) ** 2, axis=1)))
        mesh_relative = "meshes/" + key + ".gii"
        write_asset(key + ":mesh", mesh_relative, "mesh", lambda path: save_model(path, points, faces))
        metadata = {k: value for k, value in item.items() if k not in {"source_input", "source_type"}}
        metadata.update(mesh_file=mesh_relative, center_native_mm=center.tolist(), target_native_mm=points[target].tolist(),
                        bounds_native_mm=[points.min(axis=0).tolist(), points.max(axis=0).tolist()],
                        geometry={"source_input": item["source_input"], "source_object": item["source_name"], "source_type": item["source_type"],
                                  "source_geometry_file": relative + ".npz", "provenance_file": relative + ".json", "vertex_count": len(points),
                                  "triangle_count": len(faces), "target_vertex_index": target, "transform_to_native_mm": transform.tolist(),
                                  "method": source_record["method"], "source_stage": source_record.get("source_stage", "base")})
        structures.append(ModelSurface(**metadata).model_dump())
    sources = []
    for source in recipe["sources"]:
        record = dict(source)
        original = imported.input_paths[record.pop("license_input")]
        relative = f"licenses/{record['id']}{original.suffix}"
        write_asset("license:" + record["id"], relative, "license", lambda path: shutil.copyfile(original, path))
        sources.append(Source(**record, license_file=relative).model_dump())
    write_asset("lessons", "lessons.json", "lessons", lambda path: atomic_json(path, make_lessons(recipe, structures)))
    report = {"engineering_status": "passed", "anatomical_review": "not_performed", "source_objects": len(structures),
              "source_coordinate_system": "SOURCE_XYZ", "maximum_float32_rounding_mm": rounding_max,
              "scope": "Exact retained source-stage vertices and triangles, original object transforms and declared unit conversion; author viewport modifiers are explicit when enabled, with no project-added geometry, MRI alignment or segmentation",
              "warnings": recipe["scope_notes"]}
    write_asset("validation", "validation.json", "validation", lambda path: atomic_json(path, report))
    manifest = Manifest(schema_version="1.7", representation="surface-model", package_id=recipe["id"], dataset_id=recipe["id"],
        title=recipe["title"], package_version=signature[:16], space=ModelSpace(**recipe["space"]), sources=sources, volumes=[], structures=structures,
        assets=[value["asset"] for _, value in sorted(completed.items())], lessons_file="lessons.json",
        build={"signature": signature, "software_version": __version__, "created_utc": state["created_utc"], "recipe_id": recipe["id"],
               "recipe_version": recipe["version"], "recipe": recipe, "implementation": software, "libraries": libraries, "inputs": inputs,
               "parameters": {"registration": "none", "invented_reference_image": False, "anatomical_axis_assignment": "none",
                              "reusable_source_geometry_cache": cache_signature,
                              "source_geometry": "Retained original model geometry with explicit original object transform and metric unit conversion"}},
        validation={"engineering_status": "passed", "anatomical_review": "not_performed", "report": "validation.json", "warnings": report["warnings"]})
    validate_models(manifest, root)
    from .validation import validate_lessons
    validate_lessons(manifest, root)
    atomic_json(manifest_path, manifest.model_dump())
    state.update(status="complete", manifest_sha256=sha256(manifest_path))
    atomic_json(checkpoint, state)
    print(json.dumps({"event": "build-complete", "dataset": recipe["id"], "manifest": str(manifest_path), "source_objects": len(structures),
                      "seconds": round(time.monotonic() - started, 2), **counts}), flush=True)
    return manifest_path
