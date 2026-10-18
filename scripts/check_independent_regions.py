"""Independently compare a built regional atlas with acquired native NIfTI inputs."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

import nibabel as nib
import numpy as np


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def check(manifest_path, data_root):
    manifest = json.loads(manifest_path.read_text())
    assert manifest["representation"] == "mri-regions"
    recipe = manifest["build"]["recipe"]
    volumes = {volume["id"]: volume for volume in manifest["volumes"]}
    source_ids = {image["id"]: image["id"] for image in recipe["images"]}
    for structure in manifest["structures"]:
        for role in ("mask", "probability"):
            source_ids[structure[role]["volume_id"]] = structure[role]["source_input"]
    records = []
    for ident, source_id in source_ids.items():
        original_path = data_root / recipe["inputs"][source_id]
        original, built = nib.load(original_path), nib.load(manifest_path.parent / volumes[ident]["file"])
        a, b = np.asanyarray(original.dataobj), np.asanyarray(built.dataobj)
        assert np.array_equal(a, b), f"Changed source values: {ident}"
        assert np.array_equal(original.affine, built.affine), f"Changed native affine: {ident}"
        assert original.header.get_xyzt_units()[0] == built.header.get_xyzt_units()[0] == "mm"
        assert original.shape == tuple(volumes[ident]["shape"])
        record = {"id": ident, "source_input": source_id, "source_sha256": digest(original_path), "source_dtype": str(a.dtype),
                  "native_shape": list(original.shape), "exact_values_preserved": True, "exact_affine_preserved": True,
                  "range": [float(a.min()), float(a.max())], "finite": bool(np.isfinite(a).all())}
        assert record["finite"]
        records.append(record)
    reference = nib.load(data_root / recipe["inputs"][recipe["images"][0]["id"]])
    counts = np.zeros(reference.shape, np.uint16)
    masks, regions = {}, []
    for structure in manifest["structures"]:
        source_mask = nib.load(data_root / recipe["inputs"][structure["mask"]["source_input"]])
        source_probability = nib.load(data_root / recipe["inputs"][structure["probability"]["source_input"]])
        mask, probability = np.asanyarray(source_mask.dataobj), np.asanyarray(source_probability.dataobj)
        assert np.isin(mask, [0, 1]).all()
        assert np.array_equal(source_mask.affine, reference.affine) and np.array_equal(source_probability.affine, reference.affine)
        assert np.array_equal(mask.astype(bool), probability >= structure["mask"]["threshold"])
        indices = np.argwhere(mask == 1)
        centroid = nib.affines.apply_affine(reference.affine, indices.mean(axis=0))
        assert np.allclose(centroid, structure["center_ras_mm"], rtol=0, atol=1e-7)
        if structure["laterality"] in ("left", "right"):
            assert (centroid[0] < 0) == (structure["laterality"] == "left")
        counts += mask.astype(np.uint16)
        masks[structure["id"]] = set(map(tuple, indices))
        regions.append({"id": structure["id"], "mask_voxels": len(indices), "centroid_ras_mm": centroid.tolist(),
                        "exact_threshold_voxels": int(np.count_nonzero(probability == structure["mask"]["threshold"])),
                        "positive_probability_outside_mask": int(np.count_nonzero((probability > 0) & (mask == 0)))})
    overlaps = [{"voxel": index.tolist(), "ras_mm": nib.affines.apply_affine(reference.affine, index).tolist(),
                 "region_ids": [ident for ident, members in masks.items() if tuple(index) in members]} for index in np.argwhere(counts > 1)]
    return {"checked_utc": datetime.now(timezone.utc).isoformat(), "status": "passed", "package_version": manifest["package_version"],
            "build_signature": manifest["build"]["signature"], "method": "Direct independent NiBabel reads of source and constructed arrays; no project adapter or construction functions used",
            "source_reference_affine": reference.affine.tolist(), "volumes": records, "regions": regions,
            "overlap_voxels": overlaps, "maximum_memberships": int(counts.max()), "expert_review": "not_performed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = check(args.manifest, args.data_root)
    text = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.write_text(text)
    print(text)
