"""Check package bytes and the actual geometry referred to by the manifest."""
import hashlib
import json
from pathlib import Path
import nibabel as nib
import numpy as np
from scipy.ndimage import map_coordinates
from .contracts import ImageEvidence, Manifest, ScalarEvidence
from .geometry import read_volume
from .validation_cache import read_receipt, write_receipt


def validate_package(path, *, verify_hashes=True, verify_geometry=True, cache_policy="off", statistics=None):
    if cache_policy not in {"off", "refresh", "reuse"}:
        raise ValueError("Unknown geometry validation cache policy")
    if cache_policy != "off" and not (verify_hashes and verify_geometry):
        raise ValueError("Geometry cache use requires fresh asset hashing and geometry validation")
    path = Path(path).resolve()
    serialized = path.read_bytes()
    manifest = Manifest.model_validate_json(serialized)
    root = path.parent
    for asset in manifest.assets:
        resolved = (root / asset.path).resolve()
        if not resolved.is_relative_to(root) or not resolved.is_file():
            raise ValueError(f"Missing or escaping package asset: {asset.path}")
        with resolved.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest() if verify_hashes else asset.sha256
        if resolved.stat().st_size != asset.bytes or digest != asset.sha256:
            raise ValueError(f"Package asset checksum/size mismatch: {asset.path}")
    manifest_sha256 = hashlib.sha256(serialized).hexdigest()
    reused = verify_geometry and cache_policy == "reuse" and read_receipt(root, manifest_sha256)
    if verify_geometry and not reused:
        validate_geometry(manifest, root)
    validate_lessons(manifest, root)
    written = cache_policy != "off" and not reused and write_receipt(root, manifest_sha256)
    if statistics is not None:
        statistics.update({"asset_sha256": "fresh" if verify_hashes else "not_checked",
                           "geometry": "reused_after_asset_hashing" if reused else "fresh" if verify_geometry else "not_checked",
                           "cache_written": bool(written)})
    return manifest


def validate_geometry(manifest, root):
    if manifest.representation == "surface-model":
        from .model_geometry import validate_models
        validate_models(manifest, root)
        return
    if manifest.representation == "mri-regions":
        from .region_validation import validate_regions
        validate_regions(manifest, root)
        return
    labels = None
    from .source_probability import rounding_tolerance
    probability_tolerance = rounding_tolerance(manifest.build.get("recipe", {}))
    rule = manifest.build.get("recipe", {}).get("hard_label_rule")
    maximum = winner = None
    probability_labels = {s.probability.volume_id: s.label_value for s in manifest.structures if s.probability}
    channels = {s.probability.volume_id: s.probability.source_channel for s in manifest.structures if s.probability}
    for spec in sorted(manifest.volumes, key=lambda item: channels.get(item.id, -1)):
        if spec.image_evidence:
            recipe = manifest.build.get("recipe", {})
            original = next((item for item in recipe.get("images", []) if item.get("id") == spec.id), None)
            if (original is None or spec.image_evidence != ImageEvidence.model_validate(original.get("image_evidence"))
                    or spec.image_evidence.source_input != spec.id
                    or not any(item.get("id") == spec.id for item in manifest.build.get("inputs", []))):
                raise ValueError("Image acquisition evidence differs from its declared original source")
            if (recipe.get("adapter") == "source-hdf5-ct-labels"
                    and spec.image_evidence.source_dataset != recipe.get("hdf5_volumes", {}).get(spec.id, {}).get("dataset")):
                raise ValueError("CT source array identity differs from its declared HDF5 input")
        native = read_volume(root / spec.file)
        if (native.source_geometry["units"] != "mm" or native.data.shape != spec.shape
                or not np.allclose(native.affine, spec.affine_ras_mm, rtol=0, atol=1e-4)
                or not np.allclose(nib.affines.voxel_sizes(native.affine), spec.voxel_size_mm, rtol=0, atol=1e-4)
                or "".join(nib.aff2axcodes(native.affine)) != spec.orientation):
            raise ValueError(f"Manifest-to-volume geometry mismatch: {spec.id}")
        if spec.kind == "labels":
            # Surfaces and targets were constructed in the original float64
            # source grid retained by the manifest. NIfTI-1 stores its sform as
            # float32; after checking that serialized grid above, retain the
            # original affine for submillimeter boundary correspondence.
            native.affine = np.asarray(spec.affine_ras_mm, dtype=float)
            labels = native
        elif spec.kind == "probability" and (native.data.min() < -probability_tolerance or native.data.max() > 1 + probability_tolerance):
            raise ValueError(f"Probability values exceed 0 to 1 and declared source precision: {spec.id}")
        elif spec.kind == "scalar" and spec.scalar.valid_range:
            low, high = spec.scalar.valid_range
            if native.data.min() < low or native.data.max() > high:
                raise ValueError(f"Scalar values exceed the declared range: {spec.id}")
        if rule and spec.kind == "probability":
            if maximum is None:
                maximum = np.zeros(spec.shape, dtype=np.float64)
                winner = np.zeros(spec.shape, dtype=np.uint16)
            higher = native.data > maximum
            winner[higher] = probability_labels[spec.id]
            np.maximum(maximum, native.data, out=maximum)
    if manifest.representation == "mri-streamlines":
        from .streamline_validation import validate_streamlines
        validate_streamlines(manifest, root)
        return
    if manifest.representation in ("mri-volume", "scalar-fields"):
        source_images = manifest.build.get("recipe", {}).get("images", [])
        if {item.get("id") for item in source_images} != {v.id for v in manifest.volumes}:
            raise ValueError("Native packages must declare each original source field")
        for spec in manifest.volumes:
            source_spec = next(item for item in source_images if item["id"] == spec.id)
            if spec.scalar and (spec.scalar.source_input != spec.id or spec.scalar != ScalarEvidence.model_validate(source_spec.get("scalar"))):
                raise ValueError("Scalar metric provenance differs from its declared source")
            input_id = spec.native_frame.source_input if spec.native_frame else spec.id
            original = next((item for item in manifest.build.get("inputs", []) if item.get("id") == input_id), None)
            image_asset = next(asset for asset in manifest.assets if asset.path == (spec.native_frame.source_file if spec.native_frame else spec.file))
            if original is None or image_asset.sha256 != original.get("sha256") or image_asset.bytes != original.get("bytes"):
                raise ValueError("Native packages must retain the exact original NIfTI bytes")
            if spec.native_frame:
                frame = spec.native_frame
                if source_spec.get("source_input") != frame.source_input or source_spec.get("source_frame") != frame.frame:
                    raise ValueError("Native frame identity differs from the source recipe")
                source_path = root / frame.source_file
                if tuple(nib.load(source_path).shape) != frame.source_shape:
                    raise ValueError("Native source series shape differs from the record")
                source = read_volume(source_path, frame=frame.frame)
                output = read_volume(root / spec.file)
                if (not np.array_equal(source.data, output.data) or not np.allclose(source.affine, output.affine,rtol=0,atol=1e-5)):
                    raise ValueError("Native frame extraction changed source samples or spatial geometry")
        return
    data = labels.data
    if rule:
        if rule.get("method") != "maximum-probability-inclusive-threshold" or not 0 < rule.get("threshold", 0) <= 1 or maximum is None:
            raise ValueError("Invalid declared probability-to-label relationship")
        winner[maximum < rule["threshold"]] = 0
        if not np.array_equal(winner, data):
            raise ValueError("Probability evidence and categorical labels disagree with the declared source relationship")
    if not np.issubdtype(data.dtype, np.integer) or data.min() < 0 or data.max() > 65535:
        raise ValueError("Package labels must be unsigned-range categorical integers")
    counts = np.bincount(data.ravel(), minlength=65536)
    declared = {s.label_value for s in manifest.structures}
    if set(np.flatnonzero(counts)) - {0} != declared:
        raise ValueError("Label volume and structure inventory do not agree")
    inverse = np.linalg.inv(labels.affine)
    voxel_volume = abs(np.linalg.det(labels.affine[:3, :3]))
    for structure in manifest.structures:
        prefix = f"Structure {structure.id}"
        if counts[structure.label_value] != structure.voxel_count or not np.isclose(structure.voxel_count * voxel_volume, structure.volume_mm3, rtol=1e-5, atol=1e-4):
            raise ValueError(f"{prefix}: source label volume/count mismatch")
        focus = nib.affines.apply_affine(inverse, structure.target_ras_mm)
        index = np.rint(focus).astype(int)
        if not np.allclose(focus, index, atol=1e-4) or np.any(index < 0) or np.any(index >= data.shape) or data[tuple(index)] != structure.label_value:
            raise ValueError(f"{prefix}: target is not a member voxel")
        validate_surface_geometry(structure, root, data, labels.affine, structure.label_value)


def validate_surface_geometry(structure, root, data, affine, membership_value=1):
    """Check an unrefined surface against a declared binary membership field."""
    prefix = f"Structure {structure.id}"
    inverse = np.linalg.inv(affine)
    mesh = nib.load(root / structure.mesh_file)
    points_arrays = mesh.get_arrays_from_intent("NIFTI_INTENT_POINTSET")
    faces_arrays = mesh.get_arrays_from_intent("NIFTI_INTENT_TRIANGLE")
    if len(points_arrays) != 1 or len(faces_arrays) != 1:
        raise ValueError(f"{prefix}: expected one point and triangle array")
    points, faces = points_arrays[0].data, faces_arrays[0].data
    if (points.ndim != 2 or points.shape[1] != 3 or len(points) < 3 or not np.isfinite(points).all()
            or faces.ndim != 2 or faces.shape[1] != 3 or not np.issubdtype(faces.dtype, np.integer)
            or faces.size == 0 or faces.min() < 0 or faces.max() >= len(points)):
        raise ValueError(f"{prefix}: invalid mesh arrays")
    if (mesh.meta.get("CoordinateSystem") != "RAS" or mesh.meta.get("Units") != "mm"
            or not np.allclose(points_arrays[0].coordsys.xform, np.eye(4), rtol=0, atol=1e-7)):
        raise ValueError(f"{prefix}: undeclared or transformed mesh coordinates")
    bounds = [points.min(axis=0), points.max(axis=0)]
    if not np.allclose(bounds, structure.bounds_ras_mm, rtol=0, atol=1e-4):
        raise ValueError(f"{prefix}: mesh bounds differ from the manifest")
    voxels = nib.affines.apply_affine(inverse, points)
    low = np.maximum(np.floor(voxels.min(axis=0)).astype(int) - 1, 0)
    high = np.minimum(np.ceil(voxels.max(axis=0)).astype(int) + 2, data.shape)
    if np.any(high <= low):
        raise ValueError(f"{prefix}: mesh is outside the label grid")
    crop = (data[tuple(slice(int(a), int(b)) for a, b in zip(low, high))] == membership_value).astype(np.float32)
    values = map_coordinates(crop, (voxels - low).T, order=1, mode="grid-constant", cval=0, prefilter=False)
    if not np.allclose(values, .5, rtol=0, atol=2e-4):
        raise ValueError(f"{prefix}: surface does not match its source label boundary")

def validate_lessons(manifest, root):
    lessons = json.loads((root / manifest.lessons_file).read_text())
    if lessons.get("schema_version") != "1.0" or not isinstance(lessons.get("lessons"), list):
        raise ValueError("Invalid lesson package")
    available = {s.id for s in manifest.structures}
    seen = set()
    for lesson in lessons["lessons"]:
        ident = lesson.get("id")
        ids = lesson.get("structure_ids", [])
        steps = lesson.get("steps", [])
        if not ident or ident in seen or not ids or not steps or not set(ids).issubset(available):
            raise ValueError("Lesson has duplicate IDs or unavailable structures")
        if any(step.get("structure_id") not in ids for step in steps):
            raise ValueError("Lesson step references an unavailable target")
        seen.add(ident)
