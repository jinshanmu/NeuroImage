"""Check actual 2D screenshots for categorical visibility and mesh projection."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image


def check(root):
    def pixels(name):
        return np.asarray(Image.open(root / (name + ".png")).convert("RGB"))

    def difference(first, second):
        if first.shape != second.shape:
            raise ValueError("Capture dimensions changed; rerun the fixed browser fixture")
        return int(np.any(first != second, axis=2).sum())

    model_names = ["model-pons-visible", "model-pons-no-surface", "model-pons-transparent", "model-all-hidden"]
    model = {name: pixels(name) for name in model_names}
    yellow = {name: int(((image[:, :, 0] > 225) & (image[:, :, 1] > 225) & (image[:, :, 2] < 30)).sum()) for name, image in model.items()}
    model_surface_delta = difference(model[model_names[0]], model[model_names[1]])
    mri_surface_delta = difference(pixels("mri-slice-surface-visible"), pixels("mri-slice-surface-hidden"))
    mri_label_delta = difference(pixels("mri-slice-surface-hidden"), pixels("mri-slice-no-label"))
    if model_surface_delta or mri_surface_delta:
        raise ValueError("Changing 3D surface opacity changed an actual 2D slice")
    if yellow[model_names[0]] < 100 or yellow[model_names[2]] or yellow[model_names[3]] or mri_label_delta < 100:
        raise ValueError("Categorical slice visibility or opacity did not change the expected source pixels")
    return {"status": "passed", "model_source_yellow_pixels": yellow, "model_surface_opacity_pixel_changes": model_surface_delta,
            "mri_surface_opacity_pixel_changes": mri_surface_delta, "mri_label_opacity_pixel_changes": mri_label_delta,
            "scope": "Rendered 2D visibility and projection checks; no independent anatomical judgment"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-root", type=Path, default=Path("output/playwright"))
    args = parser.parse_args()
    print(json.dumps(check(args.image_root), indent=2))
