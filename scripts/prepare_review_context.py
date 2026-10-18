"""Select existing full-section notebook scenes for paired instructor captures.

Run in the NeuroImage environment. This changes the review sequence only; scene
coordinates, source bindings, annotations and source data are never rewritten.
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import shutil
import uuid

from neuroimage.library import content_binding


def prepare_context(notebook_path, data_root, minimum_free_gib=400):
    notebook_path, data_root = Path(notebook_path).resolve(), Path(data_root).resolve()
    if not notebook_path.is_relative_to(data_root):
        raise ValueError("The original notebook must remain on the configured data drive")
    content_binding(notebook_path)
    original = json.loads(notebook_path.read_text())
    if original.get("kind") != "neuroimage-teaching-notebook":
        raise ValueError("Select an image, label or scalar-field teaching notebook")
    selected = []
    for entry in original["scenes"]:
        pan = entry["scene"]["state"].get("pan")
        if not isinstance(pan, list) or len(pan) != 4:
            raise ValueError("Each recorded scene must supply its four-component slice pan and zoom")
        if pan[3] == 1:
            selected.append(entry)
    if not selected:
        raise ValueError("The notebook has no recorded complete-section views at 1x zoom")
    book = deepcopy(original)
    book["scenes"] = selected
    book["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, "neuroimage:complete-section-review:" + original["id"]))
    book["title"] = original["title"] + " · full-section review"
    if len(book["title"]) > 120:
        raise ValueError("The derived review title exceeds the portable notebook limit")
    folder = data_root / "exports" / original["package_id"] / ("context-review-" + original["id"])
    if not folder.resolve().is_relative_to(data_root):
        raise ValueError("The review output escapes the configured data drive")
    output = folder / "review-notebook.json"
    serialized = json.dumps(book, indent=2) + "\n"
    if output.exists():
        if json.loads(output.read_text()) != book:
            raise ValueError("The existing review notebook differs; preserve it before preparing another sequence")
        status = "reused"
    else:
        if shutil.disk_usage(data_root).free < minimum_free_gib * 1024 ** 3 + len(serialized.encode()) * 2:
            raise ValueError("Insufficient data-drive capacity and safety margin")
        folder.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(".json.partial")
        if temporary.exists():
            raise ValueError("An existing partial review notebook requires inspection")
        temporary.write_text(serialized)
        temporary.replace(output)
        status = "prepared"
    return {"status": status, "notebook": str(output), "views": len(selected),
            "source_scenes_unchanged": True, "expert_review": "not_performed"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("notebook", type=Path)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--minimum-free-gib", type=float, default=400)
    args = parser.parse_args()
    if args.minimum_free_gib < 0:
        parser.error("The safety floor cannot be negative")
    print(json.dumps(prepare_context(args.notebook, args.data_root, args.minimum_free_gib), indent=2))


if __name__ == "__main__":
    main()
