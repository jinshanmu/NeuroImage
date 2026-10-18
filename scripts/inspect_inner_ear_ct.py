"""Inspect original Dataset A CT, labels and landmarks without changing source data.

The optional source-inspection dependency is h5py. Use the project environment.
This report is a source-readiness receipt, separate from a constructed atlas.
"""
from collections import Counter
from itertools import product
from pathlib import Path
import argparse
import hashlib
import json
import platform

import h5py
import numpy as np

from neuroimage.build import atomic_json, utc_now


def json_value(value):
    """Retain numeric metadata and decode the original text attributes."""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="strict")
    if isinstance(value, np.ndarray):
        if value.nbytes > 1024 ** 2:
            raise ValueError("An attribute exceeds the bounded metadata budget")
        return json_value(value.tolist())
    if isinstance(value, np.generic):
        return json_value(value.item())
    if isinstance(value, (list, tuple)):
        return [json_value(item) for item in value]
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    raise ValueError(f"Unsupported source attribute type: {type(value).__name__}")


def original_node(source, path):
    """Open only internal objects from the explicitly selected original file."""
    current = source
    for name in path.split("/"):
        if not isinstance(current, h5py.Group) or not isinstance(current.get(name, getlink=True), h5py.HardLink):
            raise ValueError(f"Expected an original internal HDF5 object at {path}")
        current = current[name]
    return current


def describe(node):
    record = {"attributes": {key: json_value(value) for key, value in node.attrs.items()}}
    if isinstance(node, h5py.Dataset):
        record.update(shape=list(node.shape) if node.shape is not None else None, dtype=str(node.dtype),
                      chunks=list(node.chunks) if node.chunks else None,
                      compression=node.compression,
                      uncompressed_bytes=node.size * node.dtype.itemsize if node.size is not None else 0)
    else:
        record["kind"] = "group"
    return record


def profile(dataset, maximum_memory_mib, *, categorical=False):
    if dataset.is_virtual or dataset.external:
        raise ValueError("The selected original must contain its own image samples")
    if len(dataset.shape) != 3 or dataset.dtype.kind not in "biuf":
        raise ValueError("The selected image and label datasets must be numeric 3D arrays")
    plane_bytes = int(np.prod(dataset.shape[1:])) * dataset.dtype.itemsize
    # The factor accounts for finite checks and the unique-value working arrays.
    budget = maximum_memory_mib * 1024 ** 2
    if plane_bytes * 6 > budget:
        raise ValueError("One source plane exceeds the inspection memory budget")
    depth = max(1, min(dataset.shape[0], budget // (6 * plane_bytes)))
    counts = Counter()
    low, high, nonfinite = float("inf"), float("-inf"), 0
    for first in range(0, dataset.shape[0], depth):
        block = dataset[first:first + depth]
        finite = np.isfinite(block)
        nonfinite += int(block.size - np.count_nonzero(finite))
        if np.any(finite):
            low = min(low, float(np.min(block[finite])))
            high = max(high, float(np.max(block[finite])))
        if categorical:
            if not np.all(finite) or not np.equal(block, np.floor(block)).all():
                raise ValueError("Original label samples must be finite categorical integers")
            values, frequencies = np.unique(block, return_counts=True)
            counts.update({int(value): int(count) for value, count in zip(values, frequencies)})
            if len(counts) > 65536:
                raise ValueError("Label inventory exceeds the declared categorical inspection bound")
    result = {"minimum": low, "maximum": high, "nonfinite_samples": nonfinite,
              "source_planes_per_chunk": depth, "all_samples_inspected": True}
    if categorical:
        result["label_voxel_counts"] = {str(value): count for value, count in sorted(counts.items())}
    return result


def spatial_evidence(image, labels, landmarks):
    """Compare the declared NRRD-style grid with independently supplied points."""
    attrs = image.attrs
    if json_value(attrs.get("space")) != "left-posterior-superior":
        raise ValueError("Inspect this source's coordinate convention before interpreting its grid")
    directions = np.asarray(attrs["space directions"], dtype=float)
    origin = np.asarray(attrs["space origin"], dtype=float)
    sizes = np.asarray(attrs["sizes"], dtype=int)
    if directions.shape != (3, 3) or origin.shape != (3,) or not np.isfinite(directions).all() or not np.isfinite(origin).all():
        raise ValueError("Expected finite three-axis physical metadata")
    if not np.array_equal(sizes, image.shape) or abs(np.linalg.det(directions)) < 1e-12:
        raise ValueError("The declared grid must match the stored array and be invertible")
    affine = np.eye(4)
    affine[:3, :3], affine[:3, 3] = directions.T, origin
    spacing = np.linalg.norm(directions, axis=1)
    # Compare to the farthest corner of the voxel centered at the supplied index.
    half_diagonal = float(max(np.linalg.norm(directions.T @ (np.array(corner) - .5))
                              for corner in product((0, 1), repeat=3)))
    points = []
    for path, record in landmarks.items():
        a = record["attributes"]
        if a["coordsys"] != "LPS":
            raise ValueError("Landmark and image bases must be interpreted explicitly")
        index, xyz = np.asarray(a["ijk_position"], dtype=float), np.asarray(a["xyz_position"], dtype=float)
        if index.shape != (3,) or xyz.shape != (3,) or not np.isfinite(index).all() or not np.isfinite(xyz).all():
            raise ValueError("Expected finite three-component original landmark coordinates")
        if not np.equal(index, np.floor(index)).all() or np.any(index < 0) or np.any(index >= sizes):
            raise ValueError("Original landmark index is outside the image")
        predicted = directions.T @ index + origin
        continuous = np.linalg.solve(directions.T, xyz - origin)
        residual = float(np.linalg.norm(predicted - xyz))
        points.append({"path": path, "source_name": a["label"], "source_ijk": index.astype(int).tolist(),
                       "source_xyz_lps": xyz.tolist(), "grid_xyz_lps": predicted.tolist(),
                       "xyz_to_continuous_ijk": continuous.tolist(), "distance_mm": residual,
                       "within_half_voxel_diagonal": residual <= half_diagonal + 1e-6,
                       "label_at_source_ijk": int(labels[tuple(index.astype(int))])})
    label_definitions = []
    for key in sorted(labels.attrs):
        if key.endswith("_LabelValue"):
            prefix = key.removesuffix("_LabelValue")
            label_definitions.append({"value": int(labels.attrs[key]),
                                      "name": json_value(labels.attrs[f"{prefix}_Name"]),
                                      "color": json_value(labels.attrs[f"{prefix}_Color"]),
                                      "source_id": json_value(labels.attrs[f"{prefix}_ID"])})
    return {"array_axis_order": "I,J,K; stored shape matches the source sizes attribute",
            "source_affine_lps": affine.tolist(), "spacing_mm": spacing.tolist(),
            "length_unit_basis": "Publication reports a 98.6 micrometer reconstructed isotropic grid",
            "label_grid_basis": "Paired original HDF5 arrays; label array has the same shape and no separate affine attributes",
            "source_label_definitions": label_definitions,
            "half_voxel_diagonal_mm": half_diagonal, "landmark_comparisons": points,
            "landmark_correspondence": "Preserve both original coordinate records; reconcile the recorded residuals before landmark integration",
            "laterality": "Specimen side is not explicitly declared in this HDF5 file"}


def inspect(path, publisher_md5, maximum_memory_mib):
    if maximum_memory_mib < 16 or maximum_memory_mib > 2048:
        raise ValueError("Choose an inspection memory budget between 16 and 2048 MiB")
    md5, sha = hashlib.md5(), hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(4 * 1024 ** 2):
            md5.update(block)
            sha.update(block)
    if md5.hexdigest() != publisher_md5:
        raise ValueError("The original source does not match the publisher checksum")
    with h5py.File(path, "r") as source:
        image = original_node(source, "raw/raw-0")
        labels = original_node(source, "label/label-0")
        if not isinstance(image, h5py.Dataset) or not isinstance(labels, h5py.Dataset):
            raise ValueError("Expected original image and label datasets")
        if image.shape != labels.shape:
            raise ValueError("Original image and label shapes differ; resolve their correspondence first")
        image_record, label_record = describe(image), describe(labels)
        image_record["samples"] = profile(image, maximum_memory_mib)
        label_record["samples"] = profile(labels, maximum_memory_mib, categorical=True)
        landmarks = {f"landmark/landmark-{i}": describe(original_node(source, f"landmark/landmark-{i}"))
                     for i in range(3)}
        spatial = spatial_evidence(image, labels, landmarks)
        return {
            "recorded_utc": utc_now(), "kind": "original-ct-source-readiness", "dataset_id": "inner_ear_ct",
            "source_version": "10.5281/zenodo.8277159", "source_filename": path.name,
            "source_bytes": path.stat().st_size, "source_sha256": sha.hexdigest(),
            "publisher_md5": publisher_md5, "publisher_md5_verified": True,
            "root_attributes": describe(source)["attributes"],
            "image": image_record, "labels": label_record, "landmarks": landmarks,
            "same_source_array_shape": True, "spatial_evidence": spatial,
            "intensity_units": "Original CT integer values. The publication describes HU reconstruction; the HDF5 image stores no explicit intensity-unit or calibration attributes.",
            "atlas_constructed": False, "source_modified": False, "source_resampling": "none",
            "software": {"python": platform.python_version(), "h5py": h5py.__version__,
                         "libhdf5": h5py.version.hdf5_version, "numpy": np.__version__},
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--publisher-md5", required=True)
    parser.add_argument("--maximum-memory-mib", type=int, default=256)
    args = parser.parse_args()
    report = inspect(args.source, args.publisher_md5, args.maximum_memory_mib)
    report["script_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(args.output, report)
    print(json.dumps({"report": str(args.output), "source_md5_verified": True,
                      "shape": report["image"]["shape"],
                      "source_labels": report["labels"]["samples"]["label_voxel_counts"],
                      "atlas_constructed": False}))


if __name__ == "__main__":
    main()
