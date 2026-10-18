"""Inspect original normal-case label blocks and independent navigation metadata.

This reads source arrays and headers. It neither fits a registration nor changes
source labels, and it keeps MRI sampling separate from histological assignment.
"""
import argparse
from collections import defaultdict
from pathlib import Path
import json

import nibabel as nib
import numpy as np

from neuroimage.build import atomic_json, sha256, utc_now
from neuroimage.adapters import load_recipe, recipe_names
from neuroimage.geometry import read_volume
from neuroimage.source_lut import read_freesurfer_lut

CASES = {
    1: {"specimen": "P57-16", "commit": "21b097d599fbeae883119c768ff7897dd438d4d2",
        "receipt": "label-block-acquisition-2026-10-14.json", "last_block": 45,
        "ontology": "literature/nextbrain-native-readiness/case-1-ontology.json",
        "mri": "mri.nii.gz", "defaults": [5, 7, 8, 25, 33, 41, 45]},
    2: {"specimen": "P41-16", "commit": "9c29e15e2eef6db902296f53de636d57fc5aa6a1",
        "receipt": "case2-native-label-acquisition-2026-10-14.json", "last_block": 41,
        "ontology": None, "mri": "mri_rotated/mri.nii.gz", "defaults": [3, 5, 6, 7, 15, 16, 18, 38]},
}


def inspect(root, output, blocks, case_number=1):
    case = CASES[case_number]
    commit, specimen = case["commit"], case["specimen"]
    source = root / f"raw/nextbrain_core/registered_browser/{commit[:12]}/{specimen}"
    receipt_path = root / "downloads/nextbrain_core" / case["receipt"]
    pinned = {}
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text())
        if receipt["source_commit"] != commit:
            raise ValueError("The label receipt must identify the pinned case source")
        pinned.update({item["path"]: item for item in receipt["files"]})
    for name in recipe_names():
        if name.startswith(f"nextbrain_case{case_number}_block"):
            pinned.update({item["target"]: item for item in load_recipe(name)["files"]})
    mri_path = source / case["mri"]
    mri = read_volume(mri_path, declared_nifti_units="mm")
    index_path = source / "mri_rotated/indices.nii.gz"
    indices = read_volume(index_path, declared_nifti_units="mm") if index_path.exists() else None
    original_path = root / f"raw/nextbrain_core/MRI/{specimen}/mri.nii.gz"
    raw_mri = nib.load(original_path) if original_path.exists() else None
    raw_to_processed = np.linalg.inv(raw_mri.affine) @ mri.affine if raw_mri is not None else None
    table = read_freesurfer_lut(root / "raw/nextbrain_core/3dAtlas/lut.freeview.txt", selected_values=set())
    by_name = {entry["source_name"].casefold(): value for value, entry in table.items()}
    ontology_path = root / case["ontology"] if case["ontology"] else source / "image_ontology_hierarchical.json"
    nodes = defaultdict(list)
    for group in json.loads(ontology_path.read_text()):
        for node in group.get("children", []):
            if isinstance(node.get("label"), str):
                nodes[int(node["data"]["blockNumber"])].append(node)
    report = {
        "recorded_utc": utc_now(), "inspector_sha256": sha256(Path(__file__)), "source_commit": commit,
        "case": specimen, "label_acquisition_receipt_sha256": sha256(receipt_path) if receipt_path.exists() else None,
        "mri_sha256": sha256(mri_path), "ontology_sha256": sha256(ontology_path),
        "optional_original_mri_available": raw_mri is not None,
        "optional_block_index_volume_available": indices is not None,
        "original_mri_header_units": raw_mri.header.get_xyzt_units()[0] if raw_mri is not None else None,
        "processed_to_original_mri_index_matrix": raw_to_processed.tolist() if raw_to_processed is not None else None,
        "processed_to_original_integer_grid_residual": float(np.max(np.abs(raw_to_processed - np.rint(raw_to_processed)))) if raw_to_processed is not None else None,
        "mri_and_block_index_shape_equal": mri.data.shape == indices.data.shape if indices is not None else None,
        "mri_and_block_index_affine_maximum_difference_mm": float(np.max(np.abs(mri.affine - indices.affine))) if indices is not None else None,
        "method": "Use original 3D label NIfTI headers directly. Sample every eighth in-plane source voxel in each slice for block-index context. Compare exact-name source ontology points with the corresponding source label; record distances rather than fitting transforms.",
        "interpretation": "Block-index sampling is descriptive: source masks and reconstructed blocks have different native grids and edge extents. Ontology navigation points are a separate source representation. Source-header preservation is an engineering result; anatomical correspondence requires its own review.",
        "unused_source_color_defects": [value for value, item in table.items() if any(v < 0 or v > 255 for v in item["color"])],
        "blocks": [],
    }
    inverse_index = np.linalg.inv(indices.affine if indices is not None else mri.affine)
    for block in blocks:
        path = source / f"labels_blocks/{block}/LABELS.nii.gz"
        relative = path.relative_to(root).as_posix()
        expected = pinned.get(relative)
        if expected is None or sha256(path) != expected["sha256"] or path.stat().st_size != expected["bytes"]:
            raise ValueError(f"Original block {block} differs from its pinned acquisition")
        native = read_volume(path, declared_nifti_units="mm")
        values, counts = np.unique(native.data, return_counts=True)
        if (native.data.dtype != np.uint16 or any(int(v) not in table for v in values)
                or any(any(c < 0 or c > 255 for c in table[int(v)]["color"]) for v in values)):
            raise ValueError(f"Original block {block} requires an explicit valid label identity")
        sampled = np.argwhere(native.data[::8, ::8, :] > 0) * [8, 8, 1]
        index_points = np.rint(nib.affines.apply_affine(inverse_index @ native.affine, sampled)).astype(int)
        inside = np.all((index_points >= 0) & (index_points < (indices.data.shape if indices is not None else mri.data.shape)), axis=1)
        sampled_blocks = indices.data[tuple(index_points[inside].T)] if indices is not None else None
        points, placeholders, unknown_names = [], [], []
        inverse = np.linalg.inv(native.affine)
        for node in nodes[block]:
            data, key = node["data"], node["label"].strip().casefold()
            if data["xh"] == 0 and data["yh"] == 0 and data["zh"] == 1:
                placeholders.append(node["label"])
                continue
            if key not in by_name:
                unknown_names.append(node["label"])
                continue
            point = nib.affines.apply_affine(inverse @ mri.affine, [data[k] for k in ("xm", "ym", "zm")])
            rounded = np.rint(point).astype(int)
            in_block = bool(np.all((rounded >= 0) & (rounded < native.data.shape)))
            actual = int(native.data[tuple(rounded)]) if in_block else None
            wanted = by_name[key]
            distance = None
            if actual == wanted:
                distance = 0.0
            elif wanted in values:
                delta = (np.argwhere(native.data == wanted) - point) @ native.affine[:3, :3].T
                distance = float(np.sqrt(np.min(np.sum(delta * delta, axis=1))))
            points.append({"source_name": node["label"], "expected_label": wanted, "observed_label": actual,
                           "native_label_index": point.tolist(), "exact_nearest_voxel_match": actual == wanted,
                           "nearest_label_distance_mm": distance, "label_present_in_block": wanted in values})
        distances = [p["nearest_label_distance_mm"] for p in points if p["nearest_label_distance_mm"] is not None]
        record = {
            "block": block, "source_path": relative, "sha256": expected["sha256"],
            "shape": list(native.data.shape), "affine_ras_mm": native.affine.tolist(),
            "voxel_size_mm": nib.affines.voxel_sizes(native.affine).tolist(), "source_geometry": native.source_geometry,
            "label_counts": {str(int(v)): int(n) for v, n in zip(values, counts)},
            "sampled_nonzero_voxels": len(sampled), "mri_in_bounds_fraction": float(inside.mean()),
            "matching_block_index_fraction": float(np.mean(sampled_blocks == block)) if sampled_blocks is not None else None,
            "exact_ontology_label_matches": sum(p["exact_nearest_voxel_match"] for p in points),
            "ontology_points": points, "placeholder_names": placeholders, "names_without_exact_lut_match": unknown_names,
            "maximum_distance_to_present_source_label_mm": max(distances) if distances else None,
        }
        report["blocks"].append(record)
        atomic_json(output, report)
        print(json.dumps({"block": block, "labels": len(values) - 1, "points": len(points),
                          "exact_point_matches": record["exact_ontology_label_matches"],
                          "maximum_present_label_distance_mm": record["maximum_distance_to_present_source_label_mm"]}), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--case", type=int, choices=sorted(CASES), default=1)
    parser.add_argument("--blocks", type=int, nargs="+")
    parser.add_argument("--output")
    args = parser.parse_args()
    root = Path(args.data_root).resolve()
    case = CASES[args.case]
    blocks = args.blocks or case["defaults"]
    filename = "native-block-inspection.json" if args.case == 1 else f"case{args.case}-native-block-inspection.json"
    output = (root / (args.output or f"benchmarks/nextbrain_core/fine-anatomy-20261014/{filename}")).resolve()
    output.relative_to(root)
    output.parent.mkdir(parents=True, exist_ok=True)
    if any(block < 1 or block > case["last_block"] for block in blocks) or len(set(blocks)) != len(blocks):
        parser.error(f"Block identifiers must be distinct source values from 1 through {case['last_block']}")
    inspect(root, output, blocks, args.case)


if __name__ == "__main__":
    main()
