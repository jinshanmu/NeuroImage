"""Content-addressed, checkpointed atlas construction on the selected data drive."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
import fcntl
import hashlib
import json
import os
import shutil
import sys
import time

import nibabel as nib
import numpy as np
from . import __version__
from .adapters import import_dataset
from .contracts import Asset, Manifest, Source, Space, Structure, Volume
from .geometry import NativeVolume, NiftiFrameReader, read_volume, save_nifti, save_surface, surface_from_mask

GIB = 1024 ** 3


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def atomic_json(path, value):
    path = Path(path)
    tmp = path.with_name("." + path.name + ".partial")
    with tmp.open("w") as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def asset_record(path, root, role):
    return Asset(path=path.relative_to(root).as_posix(), role=role, bytes=path.stat().st_size, sha256=sha256(path)).model_dump()


def intact(root, record):
    path = root / record["path"]
    return path.is_file() and path.stat().st_size == record["bytes"] and sha256(path) == record["sha256"]


@contextmanager
def build_lock(path):
    with path.open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("Another process is constructing this package; wait and resume") from exc
        yield


def fingerprint(imported):
    inputs = [{"id": key, "path": imported.recipe["inputs"][key], "bytes": path.stat().st_size, "sha256": sha256(path)}
              for key, path in sorted(imported.input_paths.items())]
    # Serving or CLI-only changes must not invalidate otherwise identical anatomy.
    # The software release number alone does not alter data construction.
    implementation = ["adapters.py", "build.py", "contracts.py", "geometry.py", "lessons.py"]
    if imported.recipe.get("adapter") == "siibra-labelled-map":
        implementation += ["label_mapping.py"]
    if imported.recipe.get("adapter") == "source-lut-nifti":
        implementation += ["source_lut.py"]
    if imported.recipe.get("adapter") == "source-hdf5-ct-labels":
        implementation += ["hdf5_source.py"]
    if imported.recipe.get("probabilities"):
        implementation += ["source_probability.py"]
    if imported.recipe.get("representation") == "mri-streamlines":
        implementation += ["streamlines.py", "streamline_build.py"]
    if imported.recipe.get("representation") == "mri-regions":
        implementation += ["region_build.py"]
    if imported.recipe.get("representation") in ("mri-volume", "scalar-fields"):
        implementation += ["volume_build.py"]
    if imported.recipe.get("representation") == "surface-model":
        extractor = {"stl-source-surfaces": "stl_extract.py", "gifti-source-surfaces": "gifti_extract.py",
                     "blender-source-surfaces": "blender_extract.py"}[imported.recipe["adapter"]]
        implementation += ["model_build.py", "model_geometry.py", extractor]
    software = {name: sha256(Path(__file__).with_name(name)) for name in implementation}
    libraries = {name: version(name) for name in ("numpy", "scipy", "nibabel", "pynrrd", "scikit-image", "pydantic")}
    if imported.recipe.get("adapter") == "source-hdf5-ct-labels":
        libraries["h5py"] = version("h5py")
    if any(path.suffix.lower() == ".mha" for path in imported.input_paths.values()):
        libraries["SimpleITK"] = version("SimpleITK")
    if imported.recipe.get("adapter") == "blender-source-surfaces":
        from .model_build import blender_runtime
        libraries["blender_embedded_runtime"] = blender_runtime(imported.recipe)[1]
    payload = {"recipe": imported.recipe, "inputs": inputs, "implementation": software, "libraries": libraries}
    signature = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return signature, inputs, software, libraries


def volume_record(ident, name, kind, relative, native, *, probability_maximum=1, scalar=None, image_evidence=None):
    low, high = np.percentile(native.data, [.5, 99.5]) if kind == "image" else (0, probability_maximum) if kind == "probability" else (0, float(native.data.max()))
    if high <= low:
        high = low + 1
    return Volume(id=ident, name=name, kind=kind, file=relative, shape=native.data.shape,
                  affine_ras_mm=native.affine.tolist(), voxel_size_mm=nib.affines.voxel_sizes(native.affine).tolist(),
                  orientation="".join(nib.aff2axcodes(native.affine)), cal_min=float(low), cal_max=float(high), scalar=scalar,
                  image_evidence=image_evidence).model_dump()


def build_atlas(recipe_name, data_root, *, workers=4, minimum_free_gib=400):
    """Import a registered source recipe and construct its local package."""
    data_root = Path(data_root).resolve()
    return build_imported_atlas(import_dataset(recipe_name, data_root), data_root,
                                workers=workers, minimum_free_gib=minimum_free_gib)


def build_imported_atlas(imported, data_root, *, workers=4, minimum_free_gib=400):
    """Construct an adapter result, including a locally generated test fixture."""
    import re
    recipe_name = imported.recipe["id"]
    if not re.fullmatch(r"[a-z][a-z0-9_-]{0,99}", recipe_name):
        raise ValueError("A dataset ID must be a lowercase name, not a path")
    started = time.monotonic()
    data_root = Path(data_root).resolve()
    recipe = imported.recipe
    # Reserve output, temporary compressed files and possible interrupted outputs.
    expected_peak_gib = max(2, float(recipe.get("construction_peak_gib", 2)))
    available = shutil.disk_usage(data_root).free / GIB
    if available < minimum_free_gib + expected_peak_gib:
        raise ValueError(f"Need {minimum_free_gib + expected_peak_gib:.1f} GiB free including the safety floor; have {available:.1f} GiB")
    signature, inputs, software, libraries = fingerprint(imported)
    root = data_root / "derivatives" / recipe_name / signature[:16]
    root.mkdir(parents=True, exist_ok=True)
    with build_lock(root / ".build.lock"):
        if recipe.get("representation") == "surface-model":
            from .model_build import construct
            return construct(imported, root, signature, inputs, software, libraries, workers, available, expected_peak_gib, started)
        if recipe.get("representation") in ("mri-volume", "scalar-fields"):
            from .volume_build import construct
            return construct(imported, root, signature, inputs, software, libraries, workers, available, expected_peak_gib, started)
        if recipe.get("representation") == "mri-streamlines":
            from .streamline_build import construct
            return construct(imported, root, signature, inputs, software, libraries, workers, available, expected_peak_gib, started)
        if recipe.get("representation") == "mri-regions":
            from .region_build import construct
            return construct(imported, root, signature, inputs, software, libraries, workers, available, expected_peak_gib, started)
        return _construct(imported, root, signature, inputs, software, libraries, workers, available, expected_peak_gib, started)


def _construct(imported, root, signature, inputs, software, libraries, workers, available, peak, started):
    recipe = imported.recipe
    state_path = root / ".build-state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {"signature": signature, "completed": {}, "created_utc": utc_now()}
    if state["signature"] != signature:
        raise ValueError("Checkpoint signature mismatch")
    # The signature already verifies every source byte and construction input.
    # A complete, byte-identical package needs integrity checks, not new geometry.
    manifest_path = root / "manifest.json"
    if (state.get("status") == "complete" and manifest_path.is_file()
            and state.get("manifest_sha256") == sha256(manifest_path)
            and all(intact(root, record["asset"]) for record in state["completed"].values())):
        Manifest.model_validate_json(manifest_path.read_text())
        print(json.dumps({"event": "build-complete", "dataset": recipe["id"], "manifest": str(manifest_path),
                          "structures": len(imported.structures), "seconds": round(time.monotonic() - started, 2),
                          "reused": len(state["completed"]), "built": 0, "geometry_recomputed": False}), flush=True)
        return manifest_path
    for sub in ("volumes", "meshes", "licenses"):
        (root / sub).mkdir(exist_ok=True)
    completed = state["completed"]
    counters = {"reused": 0, "built": 0}

    def finish(key, path, role, metadata):
        record = {"asset": asset_record(path, root, role), "metadata": metadata}
        completed[key] = record
        counters["built"] += 1
        atomic_json(state_path, state)
        return record

    def reuse(key):
        record = completed.get(key)
        if record and intact(root, record["asset"]):
            counters["reused"] += 1
            return record
        return None

    def write_asset(relative, writer):
        path = root / relative
        tmp = path.with_name(".partial-" + path.name)
        writer(tmp)
        os.replace(tmp, path)
        return path

    def progress(event, **extra):
        print(json.dumps({"event": event, "dataset": recipe["id"], **extra}), flush=True)

    progress("build-start", package_version=signature[:16], workers=max(1, min(workers, 8)), free_gib=round(available, 2), estimated_peak_gib=peak)
    unit_args = {"declared_nrrd_units": recipe.get("nrrd_units"), "declared_nifti_units": recipe.get("nifti_units"),
                 "declared_metaimage_units": recipe.get("metaimage_units")}
    def read_source(ident):
        if recipe.get("adapter") == "source-hdf5-ct-labels":
            from .hdf5_source import read_hdf5_volume
            return read_hdf5_volume(imported.input_paths[ident], recipe["hdf5_volumes"][ident])
        return read_volume(imported.input_paths[ident], **unit_args)

    original = read_source("labels")
    if not np.equal(original.data, np.floor(original.data)).all() or original.data.min() < 0 or original.data.max() > 65535:
        raise ValueError("Expected unsigned categorical integer label values, not probabilities")
    source_values = set(np.unique(original.data).tolist())
    if recipe.get("require_full_label_inventory") and source_values - {0} != {value for item in imported.structures for value in item["source_values"]}:
        raise ValueError("The source name-to-label inventory must cover every original nonzero label exactly")
    lookup = np.zeros(65536, dtype=np.uint16)
    active = []
    for structure in imported.structures:
        present = [v for v in structure["source_values"] if v in source_values]
        if not present:
            raise ValueError(f"Selected structure has no source voxels: {structure['id']}")
        omitted = sorted(set(structure["source_values"]) - set(present))
        if omitted:
            structure["source_notes"].append(f"Requested source values absent from this volume: {omitted}; no voxels were invented.")
        lookup[present] = structure["label_value"]
        active.append(structure)
    selected = lookup[original.data.astype(np.uint16, copy=False)]
    native_labels = NativeVolume(selected, original.affine, original.source_geometry)
    volume_records, grid_checks, source_geometry = [], [], {"labels": original.source_geometry}
    for spec in [*recipe["images"], {"id": "labels", "name": "Source label model (no MRI)" if recipe.get("representation") == "label-model" else "Selected source parcellations"}]:
        ident = spec["id"]
        native = native_labels if ident == "labels" else read_source(ident)
        kind = "labels" if ident == "labels" else "image"
        if ident != "labels":
            exact = native.data.shape == selected.shape and np.allclose(native.affine, original.affine, atol=1e-5)
            if recipe.get("require_same_grid") and not exact:
                raise ValueError("This recipe requires an exact image-to-label grid match")
            delta = (native.affine[:3, 3] - original.affine[:3, 3]).tolist()
            grid_checks.append({"image": ident, "same_shape": native.data.shape == selected.shape, "exact_affine_match": exact,
                                "image_minus_label_origin_ras_mm": delta, "resampling": "none", "registration": "none"})
        source_geometry[ident] = native.source_geometry
        key, relative = f"volume:{ident}", f"volumes/{ident}.nii.gz"
        record = reuse(key)
        if not record:
            path = write_asset(relative, lambda tmp: save_nifti(native, tmp))
            restored = nib.load(path)
            if not np.allclose(restored.affine, native.affine, atol=1e-4) or not np.array_equal(np.asanyarray(restored.dataobj), native.data):
                raise ValueError("Volume round-trip changed voxels or geometry")
            record = finish(key, path, kind, volume_record(ident, spec["name"], kind, relative, native, image_evidence=spec.get("image_evidence")))
        volume_records.append(record["metadata"])
        progress("volume-ready", id=ident)
    probability_checks = []
    probabilities = recipe.get("probabilities", [])
    from .source_probability import rounding_tolerance
    probability_tolerance = rounding_tolerance(recipe)
    rule = recipe.get("hard_label_rule")
    maximum = np.zeros(selected.shape, dtype=np.float64) if rule else None
    winner = np.zeros(selected.shape, dtype=np.uint16) if rule else None
    # Sequential channels retain one compressed-file stream per source. No full
    # 4D array or expanded source copy is kept, including after an interrupted build.
    with ExitStack() as resources:
        readers = {}
        for spec in sorted(probabilities, key=lambda item: item["channel"]):
            source_path = imported.input_paths[spec["input"]]
            if source_path not in readers:
                readers[source_path] = resources.enter_context(NiftiFrameReader(source_path, declared_nifti_units=recipe.get("nifti_units")))
            native = readers[source_path].read(spec["channel"])
            if native.data.shape != selected.shape or not np.array_equal(native.affine, native_labels.affine):
                raise ValueError("Probability channel does not preserve the label grid")
            if native.data.min() < -probability_tolerance or native.data.max() > 1 + probability_tolerance:
                raise ValueError("Source probability values must remain within 0 to 1 plus declared source precision")
            if rule:
                higher = native.data > maximum
                winner[higher] = spec["label_value"]
                np.maximum(maximum, native.data, out=maximum)
            ident, relative = spec["id"], f"volumes/{spec['id']}.nii.gz"
            record = reuse(f"volume:{ident}")
            if not record:
                path = write_asset(relative, lambda tmp: save_nifti(native, tmp))
                restored = nib.load(path)
                if not np.array_equal(restored.affine, native.affine) or not np.array_equal(np.asanyarray(restored.dataobj), native.data):
                    raise ValueError("Probability channel round-trip changed values or geometry")
                record = finish(f"volume:{ident}", path, "probability", volume_record(ident, spec["name"], "probability", relative, native))
            volume_records.append(record["metadata"])
            source_geometry[ident] = native.source_geometry
            probability_checks.append({"volume_id": ident, "source_input": spec["input"], "source_channel": spec["channel"],
                                       "minimum": float(native.data.min()), "maximum": float(native.data.max()),
                                       "source_rounding_tolerance": probability_tolerance,
                                       "exact_values_and_grid": True, "resampling": "none"})
            progress("probability-ready", id=ident)
    hard_label_check = None
    if rule:
        if rule["method"] != "maximum-probability-inclusive-threshold" or not 0 < rule["threshold"] <= 1:
            raise ValueError("Unsupported probability-to-label relationship")
        winner[maximum < rule["threshold"]] = 0
        mismatch = int(np.count_nonzero(winner != selected))
        if mismatch:
            raise ValueError(f"Delivered categorical labels differ from the declared probability rule at {mismatch} voxels")
        hard_label_check = {**rule, "mismatch_voxels": mismatch, "basis": "Verified against delivered source labels; labels were not regenerated"}
    del original, native, maximum, winner

    source_records = []
    for source in recipe["sources"]:
        spec = dict(source)
        input_key = spec.pop("license_input")
        original_path = imported.input_paths[input_key]
        relative = f"licenses/{source['id']}{original_path.suffix}"
        if not reuse(f"license:{source['id']}"):
            path = write_asset(relative, lambda tmp: shutil.copyfile(original_path, tmp))
            finish(f"license:{source['id']}", path, "license", {})
        source_records.append(Source(**spec, license_file=relative).model_dump())
    # Keep any additional delivered license notice alongside the official terms.
    if "archive_license" in imported.input_paths:
        key = "license:archive_notice"
        if not reuse(key):
            path = write_asset("licenses/archive-notice.md", lambda tmp: shutil.copyfile(imported.input_paths["archive_license"], tmp))
            finish(key, path, "license", {})

    def mesh_task(spec):
        mask = selected == spec["label_value"]
        points, faces, stats, qc = surface_from_mask(mask, native_labels.affine)
        relative = f"meshes/label-{spec['label_value']}.gii"
        path = write_asset(relative, lambda tmp: save_surface(points, faces, tmp))
        restored = nib.load(path)
        if not np.array_equal(restored.darrays[0].data, points) or not np.array_equal(restored.darrays[1].data, faces):
            raise ValueError("Mesh round-trip changed the coordinates or triangles")
        specification = {k: v for k, v in spec.items() if k != "source_values"}
        structure = Structure(**specification, mesh_file=relative, **stats).model_dump()
        return spec["id"], path, {"structure": structure, "qc": qc, "source_values": spec["source_values"]}

    pending = [spec for spec in active if not reuse("mesh:" + spec["id"])]
    with ThreadPoolExecutor(max_workers=max(1, min(workers, 8))) as executor:
        futures = [executor.submit(mesh_task, spec) for spec in pending]
        for index, future in enumerate(as_completed(futures)):
            ident, path, metadata = future.result()
            finish("mesh:" + ident, path, "mesh", metadata)
            if (index + 1) % 10 == 0 or index + 1 == len(pending):
                progress("meshes-ready", completed=index + 1, pending_total=len(pending))
    structures = [completed["mesh:" + s["id"]]["metadata"]["structure"] for s in active]
    # Derive lessons solely from structures actually constructed in this package.
    from .lessons import make_lessons
    lessons = make_lessons(recipe, structures)
    lessons_path = root / "lessons.json"
    if not reuse("lessons"):
        atomic_json(lessons_path, lessons)
        finish("lessons", lessons_path, "lessons", {})
    corners = np.array([[i, j, k] for i in (0, selected.shape[0] - 1) for j in (0, selected.shape[1] - 1) for k in (0, selected.shape[2] - 1)])
    world = nib.affines.apply_affine(native_labels.affine, corners)
    back = nib.affines.apply_affine(np.linalg.inv(native_labels.affine), world)
    laterality = []
    for side in ("left", "right"):
        xs = [s["center_ras_mm"][0] for s in structures if s["laterality"] == side]
        laterality.append({"side": side, "median_ras_x_mm": float(np.median(xs)) if xs else None, "count": len(xs)})
    both_sides = all(item["count"] > 0 for item in laterality)
    if both_sides and laterality[0]["median_ras_x_mm"] >= laterality[1]["median_ras_x_mm"]:
        raise ValueError("Source left/right ordering conflicts with RAS coordinates")
    report = {"engineering_status": "passed", "anatomical_review": "not_performed",
              "scope": "Conversion, native geometry and within-source correspondence; not independent anatomical accuracy",
              "coordinate_roundtrip_max_error_vox": float(abs(back - corners).max()), "image_label_grids": grid_checks,
              "probability_channels": probability_checks, "hard_label_probability_relationship": hard_label_check,
              "source_geometry": source_geometry, "laterality_distribution": laterality,
              "laterality_order_check": "passed" if both_sides else "not_applicable; source does not provide both left and right labelled groups",
              "structures": {s["id"]: completed["mesh:" + s["id"]]["metadata"]["qc"] for s in active},
              "label_mapping": {s["id"]: s["source_values"] for s in active},
              "surface_method": "Binary 0.5 isosurface; full source voxel resolution; no smoothing, decimation, mirroring or registration",
              "warnings": [recipe["space"]["correspondence"], "Source labels may be inferred or manually delineated. Surface interpolation does not reveal subvoxel anatomy.", "Source name conflicts and incomplete coverage are recorded per structure."]}
    if not reuse("validation"):
        atomic_json(root / "validation.json", report)
        finish("validation", root / "validation.json", "validation", {})
    manifest = Manifest(schema_version="1.10" if recipe.get("representation") == "ct-labels" else "1.2",
                        package_id=recipe["id"], dataset_id=recipe["id"], title=recipe["title"], package_version=signature[:16], representation=recipe.get("representation", "mri-labels"),
                        space=Space(**recipe["space"]), sources=source_records, volumes=volume_records, structures=structures,
                        assets=[v["asset"] for _, v in sorted(completed.items())], lessons_file="lessons.json",
                        build={"software_version": __version__, "signature": signature, "created_utc": state["created_utc"], "recipe_id": recipe["id"],
                               "recipe_version": recipe["version"], "recipe": recipe, "implementation": software, "libraries": libraries, "inputs": inputs,
                               "parameters": {"resampling": "none", "smoothing": False, "decimation": False, "mesh_level": .5},
                               "label_mapping": report["label_mapping"]},
                        validation={"engineering_status": "passed", "anatomical_review": "not_performed", "report": "validation.json", "warnings": report["warnings"]})
    atomic_json(root / "manifest.json", manifest.model_dump())
    state["status"] = "complete"
    state["manifest_sha256"] = sha256(root / "manifest.json")
    atomic_json(state_path, state)
    progress("build-complete", manifest=str(root / "manifest.json"), structures=len(structures), seconds=round(time.monotonic() - started, 2), **counters)
    return root / "manifest.json"



def validate_package(path, *, verify_hashes=True, verify_geometry=True):
    from .validation import validate_package as validate
    return validate(path, verify_hashes=verify_hashes, verify_geometry=verify_geometry)
