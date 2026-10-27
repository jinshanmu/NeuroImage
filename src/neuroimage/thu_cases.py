"""Original THU volunteer cases, with per-case delivered label inventories."""
from copy import deepcopy
from pathlib import Path
import re
from .recipe_metadata import _metadata_json, recipe_metadata
from .case_selection import selected_cases


def _case_catalog():
    path = Path(__file__).with_name("catalogs") / "thu-cerebral-mra-cases.json"
    return {item["case"]: item for item in _metadata_json(path)["cases"]}


def thu_recipe_names():
    selected = selected_cases("thu_mra")
    return [f"thu_mra_case{case}" for case in _case_catalog() if case in selected]


def thu_recipe(name):
    """Return a fresh recipe, or None for an unknown ID; static recipes win upstream."""
    match = re.fullmatch(r"thu_mra_case([0-9]{3})", name)
    if match is None or (case := match[1]) not in _case_catalog():
        return None
    record = _case_catalog()[case]
    # Keep common provenance, units, acquisition policy and licenses identical to
    # the existing packages. The original eight JSON recipes remain authoritative.
    recipe = recipe_metadata(Path(__file__).with_name("recipes") / "thu_mra_case001.json")
    recipe.update(id=name, title=f"Cerebral MRA · healthy volunteer {case}")
    recipe["space"].update(id=f"thu-mra-{case}-source-processed",
                           name=f"Healthy volunteer {case}, original author-processed MRA grid")
    recipe["inputs"] = {**recipe["inputs"], **{
        key: record["members"][key]["target"] for key in ("mra", "labels", "landmarks")}}
    recipe["images"] = [{"id": "mra", "name": f"Case {case} source-processed MRA"}]
    catalog = _metadata_json(Path(__file__).with_name("catalogs") / "thu-cerebral-mra-segments.json")
    segments = {item["value"]: item for item in catalog["segments"]}
    selection = []
    for value in record["present_values"]:
        item = segments[value]
        selection.append({
            "value": value,
            "source_name": item["source_name"],
            "name": f"{item['name']} · segment {value}",
            "category": "Cerebral arterial segments",
            "laterality": item["laterality"],
            "color": deepcopy(item["color"]),
            "evidence": f"Original case {case} semantic annotation; numeric-to-name correspondence follows the project catalog, pending instructor review.",
            "notes": [f"Source segment {value}; {record['values'][str(value)]} annotated voxels in the original paired MRA grid.",
                      "Only delivered nonempty labels are included; missing annotations do not establish anatomical absence.",
                      "The original MetaImage LPS millimeter grid and delivered Slicer RAS landmarks are retained without inter-case registration."],
        })
    recipe["selection"] = selection
    recipe["source_case"].update(case=case, present_values=deepcopy(record["present_values"]),
                                  absent_values=deepcopy(record["absent_values"]),
                                  landmark_count=record["landmark_count"],
                                  landmarks_outside_image=deepcopy(record["landmarks_outside_image"]))
    if record["landmarks_outside_image"]:
        recipe.setdefault("scope_notes", []).append(
            "The delivered FCSV includes landmarks outside the cropped source image: "
            + ", ".join(str(item["id"]) for item in record["landmarks_outside_image"])
            + ". These original coordinates are preserved; no missing point or segment is reconstructed.")
    recipe["archives"][0]["members"] = [deepcopy(record["members"][key])
                                           for key in ("mra", "labels", "landmarks")]
    recipe["acquisition"] = f"Run neuroimage acquire {name} --data-root <data-root>. The common archive is reused and only the selected original case files are extracted."
    # Existing teaching examples make claims about their individual case. New
    # cases expose the same anatomical grouping without copying those examples.
    recipe.pop("teaching_sequences", None)
    return recipe
