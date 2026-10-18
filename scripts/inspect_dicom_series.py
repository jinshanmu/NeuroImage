"""Read source DICOM geometry and contrast identities without creating an atlas."""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path

import numpy as np
import pydicom


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def vector(value):
    return [float(item) for item in value] if value is not None else []


def geometry(rows):
    result = {"sampling_status": "insufficient_or_unsupported_geometry", "files": len(rows)}
    if any(row["anatomical_orientation_type"] != "BIPED" for row in rows):
        result["sampling_status"] = "unsupported_anatomical_orientation_type"
        return result
    required = lambda row: (row["frames"] == 1 and len(row["orientation_lps"]) == 6
                            and len(row["position_lps_mm"]) == 3 and len(row["pixel_spacing_mm"]) == 2)
    if not all(required(row) for row in rows):
        return result
    orientations = np.array([row["orientation_lps"] for row in rows])
    positions = np.array([row["position_lps_mm"] for row in rows])
    spacing = np.array([row["pixel_spacing_mm"] for row in rows])
    if not all(np.isfinite(value).all() for value in (orientations, positions, spacing)) or np.any(spacing <= 0):
        return result
    first = orientations[0]
    if (not np.allclose(orientations, first, rtol=0, atol=1e-5)
            or not np.allclose(spacing, spacing[0], rtol=0, atol=1e-5)
            or len({tuple(row["dimensions_rows_columns"]) for row in rows}) != 1):
        result["sampling_status"] = "inconsistent_shape_spacing_or_orientation"
        return result
    a, b = first[:3], first[3:]
    if abs(np.linalg.norm(a)-1) > 1e-4 or abs(np.linalg.norm(b)-1) > 1e-4 or abs(a @ b) > 1e-4:
        result["sampling_status"] = "invalid_orientation_basis"
        return result
    normal = np.cross(a, b)
    order = np.argsort(positions @ normal, kind="stable")
    ordered = positions[order]
    deltas = np.diff(ordered, axis=0)
    steps = deltas @ normal
    unique, counts = np.unique(np.round(steps, 6), return_counts=True)
    step_tolerance_mm, numerical_guard_mm = 1e-4, 1e-9
    deviation = float(np.max(np.abs(deltas-deltas[0]))) if len(steps) else None
    regular = len(steps) > 0 and np.all(steps > 1e-4) and deviation <= step_tolerance_mm + numerical_guard_mm
    result.update(sampling_status="regular_single_frame_grid" if regular else "nonuniform_or_duplicate_physical_origins" if len(steps) else "single_source_plane",
                  dimensions_rows_columns=rows[0]["dimensions_rows_columns"], pixel_spacing_mm=spacing[0].tolist(),
                  orientation_lps=first.tolist(), source_normal_lps=normal.tolist(),
                  first_position_lps_mm=ordered[0].tolist(), last_position_lps_mm=ordered[-1].tolist(),
                  interval_counts=[{"normal_step_mm": float(value), "adjacent_pairs": int(count)} for value, count in zip(unique, counts)],
                  duplicate_origin_intervals=int(np.sum(steps <= 1e-4)),
                  maximum_in_plane_step_mm=float(np.max(np.linalg.norm(deltas-steps[:, None]*normal, axis=1))) if len(steps) else 0,
                  physical_order=[rows[index]["file"] for index in order],
                  first_observed_lps_step_mm=deltas[0].tolist() if len(steps) else None,
                  maximum_step_component_deviation_mm=deviation,
                  step_comparison_tolerance_mm=step_tolerance_mm, numerical_guard_mm=numerical_guard_mm)
    return result


def inspect(data_root, source_folder):
    root = Path(data_root).resolve()
    folder = (root / source_folder).resolve()
    if not folder.is_relative_to(root) or not folder.is_dir():
        raise ValueError("Choose an existing source folder inside the configured data root")
    groups, failures = defaultdict(list), []
    for path in sorted(folder.rglob("*")):
        if not path.is_file():
            continue
        relative = str(path.relative_to(root))
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            failures.append({"file": relative, "reason": "Source links are not followed"})
            continue
        try:
            before = path.stat()
            data = pydicom.dcmread(path, stop_before_pixels=True)
            key = (str(data.SeriesInstanceUID), str(data.get("EchoNumbers", "")),
                   str(data.get("EchoTime", "")), str(data.get("TemporalPositionIdentifier", "")),
                   tuple(map(str, data.get("ImageType", []))))
            row = {"file": relative, "sha256": digest(path), "bytes": path.stat().st_size,
                   "sop_instance_uid": str(data.SOPInstanceUID), "frames": int(data.get("NumberOfFrames", 1)),
                   "dimensions_rows_columns": [int(data.Rows), int(data.Columns)],
                   "position_lps_mm": vector(data.get("ImagePositionPatient")),
                   "orientation_lps": vector(data.get("ImageOrientationPatient")),
                   "pixel_spacing_mm": vector(data.get("PixelSpacing")),
                   "slice_thickness_mm": float(data.SliceThickness) if "SliceThickness" in data else None,
                   "rescale_slope": float(data.RescaleSlope) if "RescaleSlope" in data else None,
                   "rescale_intercept": float(data.RescaleIntercept) if "RescaleIntercept" in data else None,
                   "rescale_type": str(data.get("RescaleType", "not declared")),
                   "image_type": list(map(str, data.get("ImageType", []))), "modality": str(data.Modality),
                   "anatomical_orientation_type": str(data.get("AnatomicalOrientationType", "BIPED")),
                   "frame_of_reference_uid": str(data.get("FrameOfReferenceUID", "not declared"))}
            after = path.stat()
            if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
                raise ValueError("The source changed while reading its header and checksum")
            groups[key].append(row)
        except (OSError, ValueError, AttributeError, pydicom.errors.InvalidDicomError) as error:
            failures.append({"file": relative, "reason": type(error).__name__ + ": " + str(error)})
    series = []
    for key, rows in sorted(groups.items()):
        item = {"series_instance_uid": key[0], "echo_numbers": key[1], "echo_time_ms": key[2],
                "temporal_position": key[3], "image_type": list(key[4]), "modality": sorted({row["modality"] for row in rows}),
                "frame_of_reference_uids": sorted({row["frame_of_reference_uid"] for row in rows}),
                "source_files": rows, "geometry": geometry(rows)}
        if len({row["sop_instance_uid"] for row in rows}) != len(rows):
            item["geometry"]["sampling_status"] = "duplicate_source_instances"
        if len(item["frame_of_reference_uids"]) != 1:
            item["geometry"]["sampling_status"] = "mixed_frames_of_reference"
        if len(item["modality"]) != 1:
            item["geometry"]["sampling_status"] = "mixed_modalities"
        series.append(item)
    return {"schema_version": "1.0", "kind": "neuroimage-dicom-readiness", "source_folder": str(folder.relative_to(root)),
            "preparer_sha256": digest(Path(__file__)), "pydicom_version": pydicom.__version__,
            "source_files": sum(len(rows) for rows in groups.values()), "contrast_groups": len(series),
            "grouping": "SeriesInstanceUID plus EchoNumbers, EchoTime, TemporalPositionIdentifier and ImageType; no contrast fusion",
            "coordinate_system": "DICOM patient LPS millimeters; no transform or resampling applied",
            "scope": "Header geometry and original-file identity only. No pixels decoded, atlas constructed, correspondence inferred or anatomical normality assessed. ImageType NORMAL is not a clinical assessment.",
            "series": series, "unreadable_or_unsupported_files": failures}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--source-folder", required=True, type=Path, help="Source folder relative to the data root")
    parser.add_argument("--output", required=True, type=Path, help="New JSON receipt relative to the data-root benchmarks directory")
    args = parser.parse_args()
    root = args.data_root.resolve()
    if not (root / "benchmarks").resolve().is_relative_to(root):
        raise ValueError("Keep benchmark output inside the configured data root")
    target = (root / "benchmarks" / args.output).resolve()
    if not target.is_relative_to((root / "benchmarks").resolve()) or target.suffix != ".json":
        raise ValueError("Write the metadata receipt below the data-root benchmarks directory")
    result = inspect(root, args.source_folder)
    serialized = json.dumps(result, indent=2, allow_nan=False) + "\n"
    if target.exists() and target.read_text() != serialized:
        raise ValueError("The existing receipt differs; select a new output name without overwriting it")
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(serialized)
    print(json.dumps({"status": "inspected", "receipt": str(target.relative_to(root)), "sha256": digest(target),
                      "source_files": result["source_files"], "contrast_groups": result["contrast_groups"],
                      "groups": [{"modality": item["modality"], "echo": item["echo_numbers"], **{key: value for key, value in item['geometry'].items() if key != 'physical_order'}} for item in result['series']],
                      "unreadable_or_unsupported_files": len(result["unreadable_or_unsupported_files"]),
                      "clinical_normality": "not_assessed"}, indent=2))
