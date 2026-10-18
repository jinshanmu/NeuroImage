"""Compare real browser probability samples with independent native NIfTI reads."""
import argparse
import json
from pathlib import Path
import zipfile
import nibabel as nib
import numpy as np
from PIL import Image


def check(manifest_path, browser_log, data_root, image_root, export_path):
    manifest = json.loads(manifest_path.read_text())
    log = browser_log.read_text()
    if "### Result\n" not in log:
        raise ValueError("Browser check did not produce a completed result")
    browser, _ = json.JSONDecoder().raw_decode(log.split("### Result\n", 1)[1])
    if browser.get("status") != "passed" or browser["package_version"] != manifest["package_version"]:
        raise ValueError("Browser check does not match this package")
    errors, lower, zero, sides = [], 0, 0, set()
    for structure in manifest["structures"]:
        reference = structure["probability"]
        source = nib.load(data_root / manifest["build"]["recipe"]["inputs"][reference["source_input"]], keep_file_open=True)
        values = np.asanyarray(source.dataobj[..., reference["source_channel"]])
        probes = [p for p in browser["probes"] if p["structure_id"] == structure["id"]]
        if len(probes) < 2:
            raise ValueError("Every source channel must have multiple independent browser samples")
        for probe in probes:
            if not isinstance(probe.get("displayed_support"), (int, float)) or not np.isfinite(probe["displayed_support"]):
                raise ValueError("A browser probability sample was not numeric; wait for its channel to finish loading")
            voxel = np.floor(nib.affines.apply_affine(np.linalg.inv(source.affine), probe["position_ras_mm"]) + .5).astype(int)
            if np.any(voxel < 0) or np.any(voxel >= values.shape):
                raise ValueError("Numeric sample refers to an out-of-bounds coordinate")
            expected = float(values[tuple(voxel)])
            errors.append(abs(expected - probe["displayed_support"]))
            lower += 0 < expected < .25
            zero += expected == 0
            sides.add("left" if probe["position_ras_mm"][0] < 0 else "right")
    if max(errors) > .000051 or not lower or not zero or sides != {"left", "right"}:
        raise ValueError("Browser samples differ from source probabilities or omit required coverage")
    def pixels(name):
        return np.asarray(Image.open(image_root / (name + ".png")).convert("RGB"))
    visible, no_surface, transparent = [pixels(name) for name in ("probability-visible", "probability-no-surface", "probability-transparent")]
    surface_delta = int(np.any(visible != no_surface, axis=2).sum())
    probability_delta = int(np.any(no_surface != transparent, axis=2).sum())
    if surface_delta or probability_delta < 50:
        raise ValueError("The rendered probability overlay or 2D surface isolation is incorrect")
    with zipfile.ZipFile(export_path) as archive:
        provenance = json.loads(archive.read("provenance.json"))
        scene = json.loads(archive.read("scene.json"))
        rendering = json.loads(archive.read("rendering.json"))
        if (provenance["package_version"] != manifest["package_version"] or scene["state"]["overlay"] != "probability"
                or rendering["mesh_projection_in_2d"] is not False
                or len([v for v in provenance["volumes"] if v["kind"] == "probability"]) != len(manifest["structures"])):
            raise ValueError("Export lost its probability evidence or rendering policy")
        for asset in manifest["assets"]:
            if asset["role"] == "license" and asset["path"] not in archive.namelist():
                raise ValueError("Export omitted a source license")
    return {"status": "passed", "package_version": manifest["package_version"], "samples": len(errors),
            "maximum_readout_error": max(errors), "readout_decimal_places": 4, "positive_samples_below_threshold": lower,
            "zero_samples": zero, "sides_sampled": sorted(sides), "surface_opacity_pixel_changes": surface_delta,
            "probability_opacity_pixel_changes": probability_delta, "export_probability_provenance": "passed",
            "anatomical_review": "not_performed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--browser-log", required=True, type=Path)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--image-root", type=Path, default=Path("output/playwright"))
    parser.add_argument("--export", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(check(args.manifest, args.browser_log, args.data_root, args.image_root, args.export), indent=2))
