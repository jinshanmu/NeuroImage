"""Recompute auxiliary surface-volume QC without modifying historical packages."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path

import nibabel as nib

from neuroimage.build import atomic_json, sha256, utc_now
from neuroimage.geometry import signed_surface_volume


def audit_one(item):
    root, package, structure, original = item
    path = (root / structure["mesh_file"]).resolve()
    path.relative_to(root.resolve())
    surface = nib.load(path)
    signed = signed_surface_volume(surface.darrays[0].data, surface.darrays[1].data)
    stable = abs(signed)
    return {"package_id": package, "structure_id": structure["id"],
            "mesh_file": structure["mesh_file"], "mesh_sha256": sha256(path),
            "original_surface_volume_mm3": original, "surface_volume_mm3": stable,
            "relative_difference": abs(stable - original) / stable if stable else None,
            "outward_signed_volume_positive": signed > 0,
            "voxel_volume_mm3": structure.get("volume_mm3")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--preferred", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    tasks, packages = [], []
    for dataset, key in json.loads(args.preferred.read_text()).items():
        version = key.removeprefix(dataset + "-")
        root = args.data_root / "derivatives" / dataset / version
        manifest_path = root / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        validation = json.loads((root / "validation.json").read_text())
        qualities = validation.get("structures", validation.get("regions", {}))
        if not isinstance(qualities, dict):
            continue
        entries = manifest.get("structures", []) + manifest.get("regions", [])
        selected = []
        for structure in entries:
            original = qualities.get(structure["id"], {}).get("surface_volume_mm3")
            if original is not None:
                tasks.append((root, manifest["package_id"], structure, original))
                selected.append(structure["id"])
        if selected:
            packages.append({"dataset_id": dataset, "package_id": manifest["package_id"],
                             "manifest_sha256": sha256(manifest_path), "surfaces": len(selected)})
    with ThreadPoolExecutor(max_workers=4) as executor:
        rows = list(executor.map(audit_one, tasks))
    summary = {"packages": len(packages), "surfaces": len(rows),
               "nonpositive_winding": sum(not row["outward_signed_volume_positive"] for row in rows),
               "relative_difference_above_one_percent": sum((row["relative_difference"] or 0) > .01 for row in rows),
               "maximum_relative_difference": max((row["relative_difference"] or 0 for row in rows), default=0)}
    result = {"recorded_utc": utc_now(), "method": "Centered float64 oriented tetrahedra",
              "original_packages_modified": False, "display_geometry_modified": False,
              "voxel_count_volumes_modified": False, "summary": summary, "packages": packages, "surfaces": rows}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(args.output, result)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
