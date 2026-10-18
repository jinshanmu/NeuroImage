"""Independently compare expanded packages with original NiBabel source records."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import json
from pathlib import Path
import struct
import time

import nibabel as nib
import numpy as np


def check_bundle(arguments):
    data, recipe, root, structure = arguments
    evidence = structure["streamlines"]
    source = data / recipe["inputs"][evidence["source_input"]]
    full = next(level for level in evidence["levels"] if level["id"] == "full")
    output = nib.streamlines.load(root / full["file"], lazy_load=True).streamlines
    digest = hashlib.sha256()
    count = points = 0
    minimum, maximum = np.full(3, np.inf), np.full(3, -np.inf)
    total = np.zeros(3)
    iterator = iter(output)
    with gzip.open(source, "rb") as stream:
        original = nib.streamlines.TrkFile.load(stream, lazy_load=True).streamlines
        for line in original:
            line = np.asarray(line, dtype="<f4")
            retained = next(iterator, None)
            if retained is None or not np.array_equal(line, retained):
                raise ValueError(f"Source trajectory changed: {structure['id']}, line {count}")
            digest.update(struct.pack("<I", len(line)))
            digest.update(line.tobytes())
            minimum = np.minimum(minimum, line.min(axis=0))
            maximum = np.maximum(maximum, line.max(axis=0))
            total += line.sum(axis=0, dtype=np.float64)
            count += 1
            points += len(line)
    if next(iterator, None) is not None or count != evidence["source_streamline_count"] or points != evidence["source_point_count"]:
        raise ValueError("Source trajectory counts changed")
    if digest.hexdigest() != evidence["decoded_ras_sha256"]:
        raise ValueError("Independent source coordinate digest differs")
    center = total / points
    np.testing.assert_allclose(center, structure["center_ras_mm"], rtol=0, atol=1e-6)
    np.testing.assert_array_equal([minimum, maximum], structure["bounds_ras_mm"])
    if structure["laterality"] == "left" and center[0] >= 0 or structure["laterality"] == "right" and center[0] <= 0:
        raise ValueError("Declared side disagrees with the native point-weighted centroid")
    return {"id": structure["id"], "streamlines": count, "points": points,
            "decoded_ras_sha256": digest.hexdigest(), "point_weighted_ras_center_mm": center.tolist()}


def compare_volume(source, output):
    original, retained = nib.load(source), nib.load(output)
    np.testing.assert_array_equal(np.asanyarray(original.dataobj), np.asanyarray(retained.dataobj))
    np.testing.assert_allclose(original.affine, retained.affine, rtol=0, atol=1e-5)
    return original, np.asanyarray(original.dataobj)


def run(data_root, manifests, workers):
    started = time.monotonic()
    data_root = data_root.resolve()
    findings = []
    for path in manifests:
        root = path.resolve().parent
        manifest = json.loads(path.read_text())
        dataset = manifest["dataset_id"]
        recipe = json.loads((Path(__file__).resolve().parents[1] / "src/neuroimage/recipes" / f"{dataset}.json").read_text())
        record = {"dataset_id": dataset, "package_version": manifest["package_version"], "status": "passed"}
        if dataset == "hcp1065_tracts":
            with ThreadPoolExecutor(max_workers=max(1, min(workers, 2))) as executor:
                record["bundles"] = list(executor.map(check_bundle, [(data_root, recipe, root, s) for s in manifest["structures"]]))
            record["source_streamlines"] = sum(item["streamlines"] for item in record["bundles"])
            record["source_points"] = sum(item["points"] for item in record["bundles"])
            for volume in manifest["volumes"]:
                compare_volume(data_root / recipe["inputs"][volume["id"]], root / volume["file"])
            record["method"] = "Independent NiBabel TrackVis decoder compared every original RAS point, line order and complete trajectory with the full TCK; original template arrays and affine compared exactly."
        elif dataset == "mida":
            image = nib.load(data_root / recipe["inputs"]["labels"])
            retained = nib.load(root / manifest["volumes"][0]["file"])
            values = np.asanyarray(image.dataobj)
            chosen = [s["label_value"] for s in manifest["structures"]]
            expected = np.where(np.isin(values, chosen), values, 0)
            np.testing.assert_array_equal(expected, np.asanyarray(retained.dataobj))
            np.testing.assert_allclose(image.affine, retained.affine, rtol=0, atol=1e-5)
            del expected
            counts = np.bincount(values.astype(np.int64).ravel())
            structures = []
            for structure in manifest["structures"]:
                label = structure["label_value"]
                count = int(counts[label])
                if count != structure["voxel_count"]:
                    raise ValueError("Original model voxel count differs")
                index = np.rint(nib.affines.apply_affine(np.linalg.inv(image.affine), structure["target_ras_mm"])).astype(int)
                if values[tuple(index)] != label:
                    raise ValueError("Model teaching target is outside its original source label")
                mesh = nib.load(root / structure["mesh_file"])
                vertices = mesh.get_arrays_from_intent("NIFTI_INTENT_POINTSET")[0].data
                native = nib.affines.apply_affine(np.linalg.inv(image.affine), vertices)
                # Unsimplified marching-cubes vertices must lie on original
                # half-grid edges, including very small source nerve classes.
                np.testing.assert_allclose(native * 2, np.rint(native * 2), rtol=0, atol=5e-4)
                if not np.isfinite(vertices).all() or not len(vertices):
                    raise ValueError("Model surface has no finite vertices")
                structures.append({"id": structure["id"], "original_voxels": count, "surface_vertices": len(vertices)})
            record.update(structures=structures, method="All selected source label voxels and the oblique affine retained; unselected source classes are background in this derived package; every selected label count and target verified; every unsmoothed surface vertex remains on the original half-grid edges.")
        elif dataset == "mouches_arteries":
            volumes = {v["id"]: v for v in manifest["volumes"]}
            structure = manifest["structures"][0]
            _, values = compare_volume(data_root / recipe["inputs"]["probability"], root / volumes[structure["probability"]["volume_id"]]["file"])
            image, tof = compare_volume(data_root / recipe["inputs"]["tof"], root / volumes["tof"]["file"])
            original = nib.load(data_root / recipe["inputs"]["probability"])
            np.testing.assert_array_equal(image.affine, original.affine)
            threshold = structure["mask"]["threshold"]
            mask = nib.load(root / volumes[structure["mask"]["volume_id"]]["file"])
            np.testing.assert_array_equal(np.asanyarray(mask.dataobj), values >= threshold)
            np.testing.assert_array_equal(mask.affine, original.affine)
            if structure["probability"]["units"] != "percent" or values.max() != 100 or not np.isfinite(values).all():
                raise ValueError("Source percent units or value extent differs")
            record.update(source_probability_range=[float(values.min()), float(values.max())],
                original_nonzero_voxels=int(np.count_nonzero(values)), display_mask_voxels=int(np.count_nonzero(values >= threshold)),
                threshold_percent=threshold, source_tof_range=[float(tof.min()), float(tof.max())],
                method="Every original TOF and percent probability value retained on the original shared grid; every project mask voxel equals the declared inclusive threshold; no reorientation or registration.")
        else:
            raise ValueError(f"This acceptance script has no independent source method for {dataset}")
        findings.append(record)
    return {"status": "passed", "seconds": round(time.monotonic() - started, 2), "datasets": findings,
            "expert_review": "Not performed by this engineering verification"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--manifest", action="append", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = run(args.data_root, args.manifest, args.workers)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"status": result["status"], "seconds": result["seconds"], "output": str(args.output)}))
