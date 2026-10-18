"""Verify rendered teaching markers and their exported source-bound notes."""
import argparse
import io
import json
from pathlib import Path
import zipfile
import numpy as np
from PIL import Image


def check(image_root, data_root):
    records = []
    for dataset in ("spl_nac", "mida"):
        def pixels(suffix):
            return np.asarray(Image.open(image_root / f"markers-{dataset}-{suffix}.png").convert("RGB"))
        visible, hidden = pixels("quad"), pixels("quad-hidden")
        difference = np.any(visible != hidden, axis=2)
        height, width = difference.shape
        quadrants = [int(difference[y0:y1, x0:x1].sum()) for y0, y1 in ((0, height // 2), (height // 2, height))
                     for x0, x1 in ((0, width // 2), (width // 2, width))]
        off_plane_changes = int(np.any(pixels("off-plane") != pixels("off-plane-hidden"), axis=2).sum())
        if any(count < 20 for count in quadrants) or off_plane_changes:
            raise ValueError(f"Marker visibility does not follow the actual view planes: {dataset}")
        folder = data_root / "exports" / dataset / "browser-validation"
        with zipfile.ZipFile(folder / "teaching-markers.zip") as archive:
            scene = json.loads(archive.read("scene.json"))
            rendering = json.loads(archive.read("rendering.json"))
            notes = archive.read("teaching-notes.txt").decode()
            if len(scene["state"]["annotations"]) != 1 or not scene["state"]["showMarkers"]:
                raise ValueError("Export lost the marker state")
            marker = scene["state"]["annotations"][0]
            if any(value not in notes for value in (marker["id"], marker["text"], marker["structure_id"])):
                raise ValueError("Exported marker notes are incomplete")
            if rendering["teaching_markers"]["three_dimensional"] != "projected-through-anatomy":
                raise ValueError("Marker projection evidence is missing")
            image = Image.open(io.BytesIO(archive.read("anatomy.png")))
            image.save(folder / "teaching-markers.png")
        with zipfile.ZipFile(folder / "unrevealed-practice.zip") as archive:
            scene = json.loads(archive.read("scene.json"))
            if not scene["state"]["teaching"]["practice"] or scene["state"]["teaching"]["revealed"]:
                raise ValueError("The practice export does not preserve its unrevealed state")
            Image.open(io.BytesIO(archive.read("anatomy.png"))).save(folder / "unrevealed-practice.png")
        records.append({"dataset": dataset, "marker_changed_pixels_by_quadrant": quadrants,
                        "off_plane_marker_pixel_changes": off_plane_changes, "marker_export_and_appendix": "passed"})
    return {"status": "passed", "packages": records, "practice_image_text_review": "requires separate visual or OCR inspection", "anatomical_review": "not_performed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-root", type=Path, default=Path("output/playwright"))
    parser.add_argument("--data-root", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(check(args.image_root, args.data_root), indent=2))
