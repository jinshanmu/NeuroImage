"""Inspect pinned NextBrain native source grids without atlas construction.

Read docs/nextbrain-native-readiness.md for the scope and coordinate conventions.
This diagnostic preserves source bytes and does not fit spatial registration.
"""
from pathlib import Path
import argparse
import datetime
import gc
import hashlib
import json
import resource
import time

import nibabel as nib
import numpy as np


def inspect_case_1_transforms(root, output):
    """Compare source matrices and row/column/slice ontology coordinates."""
    metadata = root / "literature/nextbrain-native-readiness"
    source_root = root / "raw/nextbrain_core/registered_browser/21b097d599fb/P57-16"
    receipt = json.loads((root / "downloads/nextbrain_core/native-transform-inspection-2026-10-13.json").read_text())
    for item in receipt["files"]:
        path = (root / item["path"]).resolve()
        path.relative_to(root)
        with path.open("rb") as handle:
            assert hashlib.file_digest(handle, "sha256").hexdigest() == item["sha256"]
    ontology = json.loads((metadata / "case-1-ontology.json").read_text())
    dimensions = json.loads((metadata / "case-1-histologyDimensionsKey.json").read_text())
    matrices = {i: np.loadtxt(source_root / f"mri_rotated/matrices/block_{i:02d}.txt") for i in range(1, 46)}
    inverse = np.loadtxt(source_root / "histology/01/matrix.txt")
    index_image = nib.load(source_root / "mri_rotated/indices.nii.gz")
    indices = np.asanyarray(index_image.dataobj)
    mri = nib.load(source_root / "mri.nii.gz")
    rows = []

    def visit(node, parent):
        data = node.get("data", {})
        path = parent + [node["label"]]
        if all(key in data for key in ("blockNumber", "xm", "ym", "zm", "xh", "yh", "zh")):
            block = int(data["blockNumber"])
            mr_point = np.array([data[key] for key in ("xm", "ym", "zm")] + [1.0])
            hist_point = np.array([data[key] for key in ("xh", "yh", "zh")] + [1.0])
            mapped = matrices[block] @ mr_point
            dim = dimensions[str(block)]
            # The author indexes slice[xh, yh]; xh is row and yh is column.
            hist_shape = np.array([dim["height"], dim["width"], dim["slices"]])
            voxel = np.rint(mr_point[:3]).astype(int)
            inside = bool(np.all((voxel >= 0) & (voxel < indices.shape)))
            sampled = int(indices[tuple(voxel)]) if inside else None
            rows.append({
                "path": path,
                "block": block,
                "mri_voxel": mr_point[:3].tolist(),
                "histology_row_column_slice": hist_point[:3].tolist(),
                "mapped_histology_row_column_slice": mapped[:3].tolist(),
                "maximum_mapping_residual": float(np.max(np.abs(mapped[:3] - hist_point[:3]))),
                "histology_coordinate_in_declared_extent": bool(np.all((hist_point[:3] >= 0) & (hist_point[:3] < hist_shape))),
                "mri_coordinate_in_extent": inside,
                "block_at_rounded_mri_coordinate": sampled,
                "rounded_mri_block_matches_declared": sampled == block,
                "zero_row_column_placeholder_pattern": bool(hist_point[0] == 0 and hist_point[1] == 0 and hist_point[2] == 1),
            })
        for child in node.get("children", []):
            visit(child, path)

    for node in ontology:
        visit(node, [])
    inverse_residual = float(np.max(np.abs(matrices[1] @ inverse - np.eye(4))))
    inverse_13_receipt = json.loads((root / "downloads/nextbrain_core/block-13-inverse-inspection-2026-10-13.json").read_text())
    inverse_13_path = (root / inverse_13_receipt["file"]).resolve()
    inverse_13_path.relative_to(root)
    with inverse_13_path.open("rb") as handle:
        assert hashlib.file_digest(handle, "sha256").hexdigest() == inverse_13_receipt["sha256"]
    inverse_13 = np.loadtxt(inverse_13_path)
    slice_receipt = json.loads((root / "downloads/nextbrain_core/native-slice-inspection-2026-10-13.json").read_text())
    slice_checks = []
    for item in slice_receipt["files"]:
        path = (root / item["file"]).resolve()
        path.relative_to(root)
        with path.open("rb") as handle:
            assert hashlib.file_digest(handle, "sha256").hexdigest() == item["sha256"]
        with np.load(path, allow_pickle=False) as archive:
            shape = list(archive["data"].shape)
        dim = dimensions[str(item["block"])]
        declared = [dim["height"], dim["width"]]
        slice_checks.append({"block": item["block"], "file": item["file"],
                             "original_array_shape": shape, "declared_row_column_shape": declared,
                             "metadata_matches_original_array": shape == declared})
    unresolved = [row for row in rows if row["maximum_mapping_residual"] > 0.5
                  and not row["zero_row_column_placeholder_pattern"]]
    record = {
        "recorded_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "inspector_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "case": 1,
        "source_commit": "21b097d599fbeae883119c768ff7897dd438d4d2",
        "mri_and_block_indices_same_shape": mri.shape == indices.shape,
        "mri_and_block_indices_maximum_affine_difference": float(np.max(np.abs(mri.affine - index_image.affine))),
        "block_01_source_inverse_pair_maximum_residual": inverse_residual,
        "block_13_source_inverse_pair_maximum_residual": float(np.max(np.abs(matrices[13] @ inverse_13 - np.eye(4)))),
        "blocks": len(matrices),
        "ontology_points": len(rows),
        "histology_convention": "xh=row, yh=column, zh=source slice index; established from author generation code",
        "point_counts": {
            "mapping_residual_le_1e_5": sum(row["maximum_mapping_residual"] <= 1e-5 for row in rows),
            "mapping_residual_le_half_pixel": sum(row["maximum_mapping_residual"] <= 0.5 for row in rows),
            "zero_row_column_placeholder_pattern": sum(row["zero_row_column_placeholder_pattern"] for row in rows),
            "outside_declared_histology_extent": sum(not row["histology_coordinate_in_declared_extent"] for row in rows),
            "outside_mri_extent": sum(not row["mri_coordinate_in_extent"] for row in rows),
            "nearest_mri_block_mismatch": sum(not row["rounded_mri_block_matches_declared"] for row in rows),
            "unresolved_nonplaceholder_coordinate_pairs": len(unresolved),
        },
        "unresolved_nonplaceholder_blocks": sorted({row["block"] for row in unresolved}),
        "source_slice_dimension_checks": slice_checks,
        "interpretation": "Numerical source consistency is separate from anatomical validity. Preserve source placeholders and unresolved matrix/ontology differences. Rounded block lookup can differ near boundaries.",
        "points": rows,
    }
    (output / "case-1-native-transform-and-ontology.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps({key: value for key, value in record.items() if key != "points"}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, help="Configured data root containing the preserved source receipts")
    parser.add_argument("--acquisition", default="downloads/nextbrain_core/registered-browser-inspection-2026-10-13.json")
    parser.add_argument("--output", default="benchmarks/nextbrain_core/native-readiness-20261013/reproduced")
    parser.add_argument("--inspect-case-1-transforms", action="store_true")
    arguments = parser.parse_args()
    root = Path(arguments.data_root).expanduser().resolve()
    acquisition = json.loads((root / arguments.acquisition).read_text())
    output = (root / arguments.output).resolve()
    output.relative_to(root)
    output.mkdir(parents=True, exist_ok=True)
    records = []
    for source in acquisition["files"]:
        started = time.monotonic()
        local_id = {1: "P57-16", 5: "EXT9-19"}[source["case"]]
        raw_path = root / "raw/nextbrain_core/MRI" / local_id / "mri.nii.gz"
        display_path = root / source["destination"]
        raw_path.resolve().relative_to(root)
        display_path.resolve().relative_to(root)
        with display_path.open("rb") as handle:
            assert hashlib.file_digest(handle, "sha256").hexdigest() == source["sha256"]
        original, display = nib.load(raw_path), nib.load(display_path)
        matrix = np.linalg.inv(original.affine) @ display.affine
        integer = np.rint(matrix).astype(int)
        assert np.max(np.abs(matrix - integer)) < 1e-3
        linear = integer[:3, :3]
        assert np.all(np.abs(linear).sum(axis=0) == 1) and np.all(np.abs(linear).sum(axis=1) == 1)
        raw = np.asanyarray(original.dataobj)
        registered = np.asanyarray(display.dataobj)
        assert raw.dtype == np.float32 and registered.dtype == np.uint8
        raw_axes = [int(np.argmax(np.abs(linear[:, axis]))) for axis in range(3)]
        signs = [int(linear[raw_axes[axis], axis]) for axis in range(3)]
        rearranged = np.transpose(raw, raw_axes)[tuple(slice(None, None, sign) for sign in signs)]
        ranges = []
        for axis, raw_axis in enumerate(raw_axes):
            shift = int(integer[raw_axis, 3])
            start = -shift if signs[axis] == 1 else shift - raw.shape[raw_axis] + 1
            stop = start + raw.shape[raw_axis]
            assert 0 <= start < stop <= registered.shape[axis]
            ranges.append([start, stop])
        region = registered[tuple(slice(start, stop) for start, stop in ranges)]
        assert region.shape == rearranged.shape
        x = rearranged[::3, ::3, ::3].astype(np.float64).ravel()
        y = region[::3, ::3, ::3].astype(np.float64).ravel()
        mask = (y > 1) & (y < 254) & np.isfinite(x)
        x, y = x[mask], y[mask]
        dx, dy = x - x.mean(), y - y.mean()
        slope = float(np.dot(dx, dy) / np.dot(dx, dx))
        intercept = float(y.mean() - slope * x.mean())
        correlation = float(np.dot(dx, dy) / np.sqrt(np.dot(dx, dx) * np.dot(dy, dy)))
        raw_min, raw_max = float(raw.min()), float(raw.max())
        candidates = {
            "global_minmax_floor": (255 / (raw_max - raw_min), -255 * raw_min / (raw_max - raw_min), "floor"),
            "global_max_floor": (255 / raw_max, 0.0, "floor"),
            "sample_linear_round": (slope, intercept, "round"),
        }
        comparisons = {name: {"gain": gain, "offset": offset, "quantization": mode,
                              "compared_voxels": 0, "matching_voxels": 0, "maximum_uint8_difference": 0,
                              "absolute_difference_sum": 0} for name, (gain, offset, mode) in candidates.items()}
        for start in range(0, rearranged.shape[0], 16):
            values = rearranged[start:start + 16].astype(np.float64)
            expected = region[start:start + 16].astype(np.int16)
            for name, (gain, offset, mode) in candidates.items():
                predicted = np.clip(values * gain + offset, 0, 255)
                if mode == "round":
                    predicted = np.rint(predicted)
                difference = np.abs(predicted.astype(np.int16) - expected)
                current = comparisons[name]
                current["compared_voxels"] += int(difference.size)
                current["matching_voxels"] += int(np.count_nonzero(difference == 0))
                current["maximum_uint8_difference"] = max(current["maximum_uint8_difference"], int(difference.max()))
                current["absolute_difference_sum"] += int(difference.sum(dtype=np.int64))
        for value in comparisons.values():
            value["matching_fraction"] = value["matching_voxels"] / value["compared_voxels"]
            value["mean_absolute_uint8_difference"] = value["absolute_difference_sum"] / value["compared_voxels"]
        record = {"case": source["case"], "repository_case_id": source["repository_case_id"], "local_raw_id": local_id,
                  "source_commit": source["commit"], "original_file": raw_path.relative_to(root).as_posix(),
                  "original_sha256": hashlib.file_digest(raw_path.open("rb"), "sha256").hexdigest(),
                  "registered_file": source["destination"], "registered_sha256": source["sha256"],
                  "raw_shape": list(raw.shape), "registered_shape": list(registered.shape),
                  "registered_header_units": list(display.header.get_xyzt_units()),
                  "header_index_mapping": matrix.tolist(), "integer_index_mapping_candidate": integer.tolist(),
                  "header_integer_residual_maximum": float(np.max(np.abs(matrix - integer))),
                  "registered_original_extent": ranges, "raw_range": [raw_min, raw_max],
                  "outside_original_extent_nonzero_voxels": int(np.count_nonzero(registered) - np.count_nonzero(region)),
                  "sample_voxels": int(x.size), "sample_linear_gain": slope, "sample_linear_offset": intercept,
                  "sample_value_correlation": correlation, "value_comparisons": comparisons,
                  "seconds": time.monotonic() - started,
                  "processing": "Read-only comparison. Integer axis permutation/reversal and crop derive from the original headers; no fitted spatial registration or resampling is performed.",
                  "interpretation": "Value correspondence is measured evidence; source naming, unit declarations and derivative intensity encoding remain separately recorded."}
        (output / f"case-{source['case']}-grid-and-values.json").write_text(json.dumps(record, indent=2) + "\n")
        records.append(record)
        print(json.dumps({"case": source["case"], "correlation": correlation, "raw_range": record["raw_range"],
                          "outside_nonzero": record["outside_original_extent_nonzero_voxels"],
                          "comparisons": comparisons, "seconds": round(record["seconds"], 3)}), flush=True)
        del raw, registered, rearranged, region, values, expected, predicted, difference, x, y, dx, dy, mask
        gc.collect()
    summary = {"recorded_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(), "cases": len(records),
               "peak_resident_memory_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
               "code_sha256": hashlib.file_digest(Path(__file__).open("rb"), "sha256").hexdigest(),
               "output": output.relative_to(root).as_posix(), "source_files_unchanged": True, "atlas_packages_created": 0}
    (output / "inspection.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary), flush=True)
    if arguments.inspect_case_1_transforms:
        inspect_case_1_transforms(root, output)


if __name__ == "__main__":
    main()
