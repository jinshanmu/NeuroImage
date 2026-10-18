"""Resolve original model annotation tips without changing the atlas geometry."""
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np

from .acquire import capacity, destination
from .build import atomic_json, build_lock, sha256
from .model_build import blender_runtime


def annotation_context(spec, manifest):
    """Require the annotation's own source file and original context object."""
    selected = next((s for s in manifest.structures if s.id == spec["context_structure_id"]), None)
    recipe = manifest.build.get("recipe", {})
    if (manifest.representation != "surface-model" or recipe.get("adapter") != "blender-source-surfaces"
            or recipe.get("mesh_geometry_stage") != "author-viewport" or selected is None
            or selected.geometry.source_input != spec["source_input"]
            or selected.geometry.source_stage != "author-viewport"
            or selected.geometry.source_type != "MESH"):
        raise ValueError("Source annotation requires its original Blender context model and source input")
    return selected


def validate_annotation(record, spec, manifest, source_hash, signature):
    context = annotation_context(spec, manifest)
    if (record.get("signature") != signature or record.get("source_sha256") != source_hash
            or record.get("spec") != spec or record.get("coordinate_system") != "SOURCE_XYZ"
            or record.get("units") != "mm" or record.get("embedded_script_execution") is not False
            or record.get("context_object") != context.geometry.source_object
            or record.get("source_stage") != "author-viewport"
            or record.get("edge_indices") != [[0, 1]] or record.get("polygon_count") != 0
            or record.get("hook_vertex_indices") != [1]):
        raise ValueError("Source annotation provenance differs from its recorded context")
    points = np.asarray(record.get("source_vertices"), dtype=np.float64)
    transform = np.asarray(record.get("transform_to_native_mm"), dtype=np.float64)
    native = np.asarray(record.get("points_native_mm"), dtype=np.float64)
    context_transform = np.asarray(record.get("context_transform_to_native_mm"), dtype=np.float64)
    if (points.shape != (2, 3) or transform.shape != (4, 4) or native.shape != (2, 3)
            or context_transform.shape != (4, 4)
            or not all(np.isfinite(value).all() for value in (points, transform, native, context_transform))
            or not np.array_equal(transform[3], [0, 0, 0, 1])
            or abs(np.linalg.det(transform[:3, :3])) < 1e-12
            or not np.allclose(points @ transform[:3, :3].T + transform[:3, 3], native, rtol=0, atol=1e-9)
            or not np.allclose(context_transform, context.geometry.transform_to_native_mm, rtol=0, atol=1e-6)):
        raise ValueError("Source annotation native points or context transform changed")
    return {**record, "position_native_mm": native[spec["source_vertex_index"]].tolist()}


def prepare_source_annotations(manifest, steps, data_root, minimum_free_gib=400):
    """Reuse checked per-annotation records; completed notebooks need no extractor."""
    specs = {}
    for step in steps:
        spec = step.get("source_annotation")
        if spec is None:
            continue
        annotation_context(spec, manifest)
        if spec["id"] in specs and specs[spec["id"]] != spec:
            raise ValueError("A source annotation ID must retain one source definition")
        specs[spec["id"]] = spec
    if not specs:
        return {}
    source_ids = {item["source_input"] for item in specs.values()}
    if len(source_ids) != 1:
        raise ValueError("One annotation preparation uses one original Blender source")
    source_id = next(iter(source_ids))
    source = next((item for item in manifest.build["inputs"] if item["id"] == source_id), None)
    if source is None:
        raise ValueError("The original annotation source input is unavailable in this package record")
    data_root = Path(data_root).resolve()
    original = destination(data_root, source["path"])
    if not original.is_file():
        raise ValueError(f"Acquire or restore the recorded original model at {source['path']} before preparing source annotations")
    if original.stat().st_size != source["bytes"] or sha256(original) != source["sha256"]:
        raise ValueError("Original annotation source differs from the atlas input; the file was preserved")
    executable, runtime = blender_runtime(manifest.build["recipe"])
    expected_runtime = manifest.build.get("libraries", {}).get("blender_embedded_runtime")
    if runtime != expected_runtime:
        raise ValueError("Source annotations require the original atlas Blender runtime")
    payload = {"source_sha256": source["sha256"], "runtime": runtime, "specs": specs,
               "implementation": {name: sha256(Path(__file__).with_name(name)) for name in ("source_annotations.py", "blender_annotations.py")},
               "contexts": {s["context_structure_id"]: annotation_context(s, manifest).model_dump() for s in specs.values()}}
    signature = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    root = destination(data_root, f"cache/{manifest.dataset_id}/source-annotations/{signature[:20]}")
    if any(parent.is_symlink() for parent in [root, *root.parents] if parent != data_root and parent.is_relative_to(data_root)):
        raise ValueError("Source annotation directories must remain inside the regular data layout")
    capacity(data_root, 64 * 1024 ** 2, minimum_free_gib)
    root.mkdir(parents=True, exist_ok=True)
    paths = {ident: root / (hashlib.sha256(ident.encode()).hexdigest()[:20] + ".json") for ident in specs}
    lock = root / ".lock"
    if any(p.is_symlink() for p in [lock, root / "request.json", root / ".request.json.partial", *paths.values(), *[p.with_suffix(".sha256") for p in paths.values()]]):
        raise ValueError("Source annotation cache files must remain regular local files")
    with build_lock(lock):
        records, missing = {}, []
        for ident, spec in specs.items():
            path = paths[ident]
            stamp = path.with_suffix(".sha256")
            if path.is_file() and stamp.is_file():
                if path.stat().st_size > 1024 ** 2 or sha256(path) != stamp.read_text().strip():
                    raise ValueError("Cached source annotation changed; preserve it before preparing a new cache")
                records[ident] = validate_annotation(json.loads(path.read_text()), spec, manifest, source["sha256"], signature)
            else:
                missing.append({"spec": spec, "key": path.stem, "context_object": annotation_context(spec, manifest).geometry.source_object})
        if missing:
            request = {"signature": signature, "source_sha256": source["sha256"], "source_scale_length": manifest.build["recipe"]["source_scale_length"],
                       "annotations": missing, "output": str(root)}
            request_path = root / "request.json"
            atomic_json(request_path, request)
            process = subprocess.Popen([executable, "--background", "--factory-startup", "--disable-autoexec", "--threads", "2",
                str(original), "--python-exit-code", "2", "--python", str(Path(__file__).with_name("blender_annotations.py")), "--", "--request", str(request_path)])
            try:
                if process.wait() != 0:
                    raise ValueError("Source annotation extraction interrupted; completed annotation records remain reusable")
            except BaseException:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill(); process.wait()
                raise
            for item in missing:
                spec = item["spec"]; path = paths[spec["id"]]
                if not path.is_file() or path.stat().st_size > 1024 ** 2 or sha256(path) != path.with_suffix(".sha256").read_text().strip():
                    raise ValueError("Source annotation extraction did not finish its checked record")
                records[spec["id"]] = validate_annotation(json.loads(path.read_text()), spec, manifest, source["sha256"], signature)
        return records
