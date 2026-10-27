"""Verified healthy MUG500+ cases in their original label and mesh spaces.

The A0101 recipes remain byte-for-byte compatible. Additional cases are
materialized from the same recipes only after their archive and selected source
members have been verified and recorded in the case inventory.
"""
from copy import deepcopy
from pathlib import Path
import re
from .recipe_metadata import _metadata_json, recipe_metadata
from .case_selection import selected_cases


_CATALOG = Path(__file__).with_name("catalogs") / "mug500-cases.json"
_PATTERN = re.compile(r"mug500_(healthy|source_mesh)_(a\d{4})\Z")


def _inventory():
    return _metadata_json(_CATALOG)["cases"] if _CATALOG.is_file() else {}


def case_inventory():
    return deepcopy(_inventory())


def mug_recipe_names():
    selected = selected_cases("mug500")
    return [f"mug500_{kind}_{case.lower()}" for case, entry in sorted(_inventory().items())
            if case != "A0101" and case in selected for kind, member in (("healthy", "labels"), ("source_mesh", "stl"))
            if member in entry]


def _replace(value, old, new):
    if isinstance(value, str):
        return value.replace(old, new)
    if isinstance(value, list):
        return [_replace(item, old, new) for item in value]
    if isinstance(value, dict):
        return {key: _replace(item, old, new) for key, item in value.items()}
    return value


def mug_recipe(name):
    match = _PATTERN.fullmatch(name)
    if not match:
        return None
    kind, case = match[1], match[2].upper()
    entry = deepcopy(_inventory().get(case))
    if entry is None or case == "A0101" or (kind == "source_mesh" and "stl" not in entry):
        return None
    original_id = f"mug500_{kind}"
    recipe = recipe_metadata(Path(__file__).with_name("recipes") / f"{original_id}.json")
    recipe = _replace(recipe, "A0101", case)
    recipe = _replace(recipe, "a0101", case.lower())
    recipe["id"] = name
    recipe["source_case"] = {"case": case, "cohort": "publisher-designated healthy A-series",
                             "source_record": "10.6084/m9.figshare.9616319.v20"}
    # Structure and lesson IDs belong to this package, while source attribution
    # and the shared source-file directories retain the upstream source identity.
    for sequence in recipe.get("teaching_sequences", []):
        sequence["id"] += "-" + case
        sequence["structure_ids"] = [ident.replace(original_id + ":", name + ":")
                                     for ident in sequence["structure_ids"]]
    member_kind = "labels" if kind == "healthy" else "stl"
    member = entry[member_kind]
    recipe["inputs"][member_kind] = member["target"]
    archive = entry["archive"]
    recipe["archives"] = [{**archive, "members": [member]}]
    recipe["acquisition"] = (f"Run neuroimage acquire {name} --data-root <data-root>. "
                             f"Reuse the verified {archive['filename']} and extract only {member['member']}.")
    if kind == "healthy":
        header = entry["label_header"]
        recipe["space"]["reference"] = (
            f"Original {case}.nrrd {header['space']} directions and origin, converted exactly to RAS millimeters. "
            f"Stored space directions: {header['space_directions']}; origin: {header['space_origin']}."
        )
        notes = recipe["selection"][0]["notes"]
        notes[1] = ("Stored source-grid directions and origin are retained exactly. "
                    "Stored voxel sampling does not establish effective CT acquisition resolution.")
    else:
        original_name = Path(member["member"]).name
        recipe["source_version"] = "10.6084/m9.figshare.9616319.v20/" + case + "/" + original_name
        recipe["space"]["reference"] = (
            f"Original publisher file {member['member']}; source facet coordinates are retained "
            "with identity metric scaling and no project anatomical registration."
        )
        recipe["space"]["unit_basis"] = (
            "The primary Methods describe author STL surfaces extracted from the corresponding "
            "segmentation with millimeter sampling. Source facet coordinates are retained exactly; "
            "the independent viewer does not assign anatomically unverified axis labels."
        )
        recipe["model_notes"] = [note for note in recipe["model_notes"]
                                 if "MUG-20261013-01" not in note]
        for item in recipe["objects"]:
            item["id"] = item["id"].replace(original_id + ":", name + ":")
            item["source_name"] = original_name
    return recipe
