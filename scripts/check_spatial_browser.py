"""Independently check spatial display pixels, source targets and credited exports."""
import argparse
import json
from pathlib import Path
import zipfile

import nibabel as nib
import numpy as np
from PIL import Image
from neuroimage.library import library_records


def check(data_root, browser_log, image_root):
    text = browser_log.read_text()
    if "### Result\n" not in text:
        raise ValueError("The real-browser spatial fixture did not produce a completed result")
    result, _ = json.JSONDecoder().raw_decode(text.split("### Result\n", 1)[1])
    if result.get("status") != "passed":
        raise ValueError("Browser spatial acceptance failed")
    records = library_records(data_root)
    fixtures = []
    for fixture in result["fixtures"]:
        dataset, version = fixture["dataset_id"], fixture["package_version"]
        matches = [record for record in records if record.get("status") == "available"
                   and record["dataset_id"] == dataset and record["package_version"] == version]
        if len(matches) != 1:
            raise ValueError("The browser fixture does not identify one available local package")
        manifest_path = Path(matches[0]["manifest"])
        manifest = json.loads(manifest_path.read_text())
        output = data_root / "exports" / dataset / "spatial-validation"
        scene = json.loads((output / "spatial-scene.json").read_text())
        names = ["slice-before", "slice-opacity", "slice-guides", "quad-opacity", "quad-opaque", "quad-guides", "saved", "restored", "imported"]
        pixels = {name: np.asarray(Image.open(image_root / f"spatial-{dataset}-{name}.png").convert("RGB")) for name in names}
        if len({image.shape for image in pixels.values()}) != 1:
            raise ValueError("All comparisons require an unchanged anatomy-canvas size")
        differences = {}
        for name in ("slice-opacity", "slice-guides"):
            count = int(np.any(pixels[name] != pixels["slice-before"], axis=2).sum())
            differences[name] = count
            if count:
                raise ValueError(f"A 3D display setting changed real 2D section pixels in {dataset}: {name}: {count}")
        height, width = pixels["quad-opacity"].shape[:2]
        render_region = np.zeros((height, width), dtype=bool)
        render_region[height // 2:, width // 2:] = True
        for name in ("quad-opaque", "quad-guides"):
            difference = np.any(pixels[name] != pixels["quad-opacity"], axis=2)
            counts = {"3d": int(difference[render_region].sum()), "other_views": int(difference[~render_region].sum())}
            differences[name] = counts
            if counts["3d"] < 100 or counts["other_views"]:
                raise ValueError(f"Expected a visible 3D-only change for {dataset}/{name}: {counts}")
        for name in ("restored", "imported"):
            count = int(np.any(pixels[name] != pixels["saved"], axis=2).sum())
            differences[name] = count
            if count:
                raise ValueError(f"Scene recovery changed anatomy-canvas pixels in {dataset}: {name}: {count}")
        labels = next(volume for volume in manifest["volumes"] if volume["kind"] == "labels")
        image = nib.load(manifest_path.parent / labels["file"])
        voxel = np.floor(nib.affines.apply_affine(np.linalg.inv(image.affine), scene["state"]["position"]) + .5).astype(int)
        if np.any(voxel < 0) or np.any(voxel >= image.shape):
            raise ValueError("Selected target is outside the native label field")
        structure = next(item for item in manifest["structures"] if item["id"] == fixture["selected"])
        if not np.allclose(scene["state"]["position"], structure["target_ras_mm"], rtol=0, atol=1e-8):
            raise ValueError("The saved physical target lost precision during capture")
        value = int(np.asanyarray(image.dataobj)[tuple(voxel)])
        if value != structure["label_value"]:
            raise ValueError("Display controls changed the source-labelled target")
        with zipfile.ZipFile(output / "spatial-teaching.zip") as archive:
            exported = json.loads(archive.read("scene.json"))
            rendering = json.loads(archive.read("rendering.json"))
            if exported["state"] != scene["state"] or rendering["section_guides"]["depth_picking"] is not False:
                raise ValueError("Credited image export changed the scene or lost guide interpretation")
            licenses = [asset for asset in manifest["assets"] if asset["role"] == "license"]
            for asset in licenses:
                if archive.read(asset["path"]) != (manifest_path.parent / asset["path"]).read_bytes():
                    raise ValueError("A source license was omitted or changed")
        if scene["state"]["surfaceOpacity"][structure["id"]] != .25 or len(scene["state"]["sectionPlanes"]) != 3:
            raise ValueError("The portable scene lost the new physical display state")
        fixtures.append({**fixture, "pixel_differences": differences, "native_label_value": value,
                         "saved_position_ras_mm": scene["state"]["position"],
                         "licenses_verified": len(licenses), "export_state": "unchanged", "renderer_sha256": rendering["build_sha256"]})
    return {"status": "passed", "fixtures": fixtures, "graphics": result["graphics"],
            "page_errors": result["page_errors"], "external_requests": result["external_requests"],
            "scope": "Engineering source-grid, display, pixel restoration and export checks; independent anatomy review not performed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--browser-log", required=True, type=Path)
    parser.add_argument("--image-root", type=Path, default=Path("output/playwright"))
    args = parser.parse_args()
    print(json.dumps(check(args.data_root, args.browser_log, args.image_root), indent=2))
