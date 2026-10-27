"""Audit the pinned THU archive and preserve historical full-cohort definitions.

No downloads, package builds, resampling or replacement of existing inputs occur.
Missing-image extraction is restricted to currently selected cases before any
input is written. Ordinary retained-case recovery uses neuroimage acquire.
"""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import tempfile
import zipfile

import numpy as np
import SimpleITK as sitk
from neuroimage.case_selection import case_exclusion_reason, selected_cases
from neuroimage.dataset_policy import ExcludedDatasetError


ARCHIVE_SHA256 = "fc174e2da9827df331a94e9530f2b59742a9e890dde935088ac9decbbed1b82e"
ARCHIVE_BYTES = 1198822695
RAW_DIRECTORY = "raw/thu_cerebral_mra/preprocessed"
CASE_IDS = [f"{number:03d}" for number in range(1, 110)]
SUFFIXES = {"mra": "img.mha", "labels": "sseg-label.mha", "landmarks": "land.fcsv"}


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def add_missing_input(path, content):
    """Create exclusively, refusing to replace any target (including on exFAT)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def write_json(path, value):
    """Publish derived reports atomically; original source inputs use xb above."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", prefix="." + path.name, dir=path.parent, delete=False) as stream:
        stream.write(json.dumps(value, indent=2) + "\n")
        stream.flush()
        os.fsync(stream.fileno())
        staged = stream.name
    os.replace(staged, path)


def grid(image):
    return {"shape_xyz": list(image.GetSize()), "origin_lps": list(image.GetOrigin()),
            "spacing": list(image.GetSpacing()), "direction": list(image.GetDirection())}


def landmark_inventory(path, image):
    lines = path.read_text().splitlines()
    if "# CoordinateSystem = 0" not in lines:
        raise ValueError(f"Expected original Slicer RAS landmarks: {path}")
    points, outside = [], []
    for row in csv.reader(line for line in lines if line and not line.startswith("#")):
        ident = int(row[11].split("-")[-1])
        point = np.asarray(row[1:4], dtype=float)
        if not np.isfinite(point).all():
            raise ValueError(f"Nonfinite landmark in {path}")
        index = np.asarray(image.TransformPhysicalPointToContinuousIndex(tuple(point * [-1, -1, 1])))
        if np.any(index < -0.5) or np.any(index > np.asarray(image.GetSize()) - 0.5):
            outside.append({"id": ident, "ras_mm": point.tolist(), "original_voxel_index": index.tolist()})
        points.append(ident)
    if sorted(points) != list(range(1, 21)):
        raise ValueError(f"Expected the original 20 unique delivered FCSV IDs: {path}")
    return sorted(points), outside


def prepare(data_root, extract_missing_images=False):
    if extract_missing_images:
        selected = selected_cases("thu_mra")
        for case in CASE_IDS:
            if case not in selected:
                raise ExcludedDatasetError(case_exclusion_reason("thu_mra_case" + case)
                    or f"THU Cerebral MRA case {case} is temporarily not included.")
    archive = data_root / "downloads/thu_cerebral_mra/annotation-aftpreprocess.zip"
    if archive.stat().st_size != ARCHIVE_BYTES or sha256_file(archive) != ARCHIVE_SHA256:
        raise ValueError("THU archive does not match the pinned original bytes and SHA256")
    old_inventory = json.loads((data_root / "benchmarks/thu_cerebral_mra/source-readiness/label-inventory.json").read_text())
    inventory = {item["case"]: item for item in old_inventory}
    if set(inventory) != set(CASE_IDS):
        raise ValueError("The original label inventory must cover cases 001–109 exactly")
    result, added = [], []
    with zipfile.ZipFile(archive) as source:
        expected = {f"annotation-aftpreprocess/{case}-{suffix}"
                    for case in CASE_IDS for suffix in SUFFIXES.values()}
        files = [item for item in source.infolist() if not item.is_dir()]
        if len(files) != len(expected) or {item.filename for item in files} != expected:
            raise ValueError("The archive must contain exactly the 109 original three-file case sets")
        for case in CASE_IDS:
            members = {}
            for key, suffix in SUFFIXES.items():
                name = f"{case}-{suffix}"
                member = f"annotation-aftpreprocess/{name}"
                content = source.read(member)  # Also verifies the source ZIP CRC.
                digest = hashlib.sha256(content).hexdigest()
                target = f"{RAW_DIRECTORY}/{name}"
                path = data_root / target
                if not path.exists():
                    if key != "mra" or not extract_missing_images:
                        raise FileNotFoundError(f"Missing original input {path}; MRI extraction requires --extract-missing-images")
                    add_missing_input(path, content)
                    added.append(target)
                if path.stat().st_size != len(content) or sha256_file(path) != digest:
                    raise ValueError(f"Existing source input differs from the pinned archive; not replaced: {path}")
                members[key] = {"member": member, "target": target, "bytes": len(content), "sha256": digest}
            mra = sitk.ReadImage(str(data_root / members["mra"]["target"]))
            labels = sitk.ReadImage(str(data_root / members["labels"]["target"]))
            if any(image.GetDimension() != 3 or image.GetNumberOfComponentsPerPixel() != 1
                   for image in (mra, labels)) or not np.isfinite(sitk.GetArrayViewFromImage(mra)).all():
                raise ValueError(f"Expected finite scalar 3D source MRA and labels: {case}")
            original = inventory[case]
            if grid(mra) != grid(labels) or grid(labels) != {key: original[key] for key in grid(labels)}:
                raise ValueError(f"Original MRA/label pairing or inventoried physical grid differs: {case}")
            pixels = sitk.GetArrayFromImage(labels)
            values, counts = np.unique(pixels, return_counts=True)
            if not np.isfinite(values).all() or not np.array_equal(values, values.astype(int)):
                raise ValueError(f"Labels must be finite original categorical integers: {case}")
            observed = {str(int(value)): int(count) for value, count in zip(values, counts)}
            if observed != original["values"] or not set(values.astype(int)) <= set(range(21)):
                raise ValueError(f"Actual label inventory differs from the source evidence: {case}")
            ids, outside = landmark_inventory(data_root / members["landmarks"]["target"], mra)
            present = sorted(int(value) for value in observed if value != "0")
            result.append({"case": case, **grid(mra), "values": observed, "present_values": present,
                           "absent_values": sorted(set(range(1, 21)) - set(present)),
                           "landmark_count": len(ids), "landmark_ids": ids,
                           "landmark_coordinate_system": "RAS", "landmarks_outside_image": outside,
                           "members": members})
            if int(case) % 10 == 0 or case == "109":
                print(f"Verified case {case}/109", flush=True)
    return ({"schema_version": "1.0", "source_id": "thu_cerebral_mra",
             "archive": {"filename": archive.name, "bytes": ARCHIVE_BYTES, "sha256": ARCHIVE_SHA256},
             "coordinate_policy": "Original MetaImage LPS millimeters and delivered Slicer RAS FCSV; no resampling or inter-case correspondence added.",
             "annotation_policy": "Only each case's actual nonempty delivered values are selected. Missing labels do not establish anatomical absence. Numeric-to-name correspondence uses the existing 20-segment project catalog.",
             "cases": result}, added)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--extract-missing-images", action="store_true")
    parser.add_argument("--catalog-output", required=True, type=Path)
    parser.add_argument("--report-output", required=True, type=Path)
    args = parser.parse_args()
    catalog, added = prepare(args.data_root.resolve(), args.extract_missing_images)
    write_json(args.catalog_output, catalog)
    write_json(args.report_output, {"case_count": len(catalog["cases"]),
        "segment_count": sum(len(item["present_values"]) for item in catalog["cases"]),
        "added_images": added, "added_bytes": sum(item["members"]["mra"]["bytes"]
        for item in catalog["cases"] if item["members"]["mra"]["target"] in added),
        "all_source_hashes_verified": True, "all_paired_grids_verified": True,
        "all_label_inventories_verified": True, "all_landmark_coordinate_systems_verified": True,
        "cases_with_source_landmarks_outside_image": {
            item["case"]: item["landmarks_outside_image"] for item in catalog["cases"]
            if item["landmarks_outside_image"]}})
    print(f"Verified {len(catalog['cases'])} original cases; added {len(added)} missing images")


if __name__ == "__main__":
    main()
