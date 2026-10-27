"""One current inclusion list, independent of archived cohort definitions and data cleanup."""
from functools import lru_cache
from pathlib import Path
import re

from .recipe_metadata import _metadata_json, _stamp


_CATALOGS = Path(__file__).with_name("catalogs")
_SELECTION = _CATALOGS / "case-selection.json"
_INVENTORIES = {"thu_mra": _CATALOGS / "thu-cerebral-mra-cases.json",
                "mug500": _CATALOGS / "mug500-cases.json"}
_MAXIMUM_CASES = 10


def _validate_selection(selection, inventories):
    if (not isinstance(selection, dict) or selection.get("schema_version") != "1.0"
            or selection.get("maximum_cases_per_family") != _MAXIMUM_CASES
            or not isinstance(selection.get("families"), dict)
            or set(selection["families"]) != set(_INVENTORIES)):
        raise ValueError("Case selection must declare the supported families and a maximum of 10 source cases")
    result = {}
    for family, definition in selection["families"].items():
        if not isinstance(definition, dict):
            raise ValueError("Each family must declare its selected source case IDs")
        cases = definition.get("case_ids")
        if (not isinstance(cases, list) or not cases or len(cases) > _MAXIMUM_CASES
                or any(not isinstance(case, str) for case in cases) or len(set(cases)) != len(cases)):
            raise ValueError("Each family must select 1 to 10 distinct source case IDs")
        known = ({item["case"] for item in inventories[family]["cases"]}
                 if family == "thu_mra" else set(inventories[family]["cases"]))
        for case in cases:
            valid = (re.fullmatch(r"[0-9]{3}", case) and 1 <= int(case) <= 109
                     if family == "thu_mra" else
                     re.fullmatch(r"A[0-9]{4}", case) and 1 <= int(case[1:]) <= 500)
            if not valid or case not in known:
                raise ValueError(f"Case selection contains an unknown or invalid {family} source case: {case}")
        result[family] = frozenset(cases)
    return result


def selection_revision():
    """Invalidate discovery snapshots when inclusion policy or its known-source evidence changes."""
    return tuple(_stamp(path) for path in (_SELECTION, *_INVENTORIES.values()))


@lru_cache(maxsize=4)
def _selected(revision):
    selection = _metadata_json(_SELECTION)
    inventories = {family: _metadata_json(path) for family, path in _INVENTORIES.items()}
    result = _validate_selection(selection, inventories)
    if selection_revision() != revision:
        raise ValueError("Case selection changed while being read; refresh the source library")
    return result


def selected_cases(family):
    """Immutable selected source IDs; representations and revisions do not add cases."""
    return _selected(selection_revision())[family]


def case_identity(identity):
    """Recognize a case dataset ID or its exact historical package-key prefix."""
    if not isinstance(identity, str):
        return None
    match = re.fullmatch(r"thu_mra_case([0-9]{3})(?:-[A-Za-z0-9_.-]+)?", identity, re.IGNORECASE)
    if match:
        return "thu_mra", match[1]
    match = re.fullmatch(r"mug500_(?:healthy|source_mesh)(?:_(a[0-9]{4}))?(?:-[A-Za-z0-9_.-]+)?",
                         identity, re.IGNORECASE)
    if match:
        return "mug500", match[1].upper() if match[1] else "A0101"
    return None


def case_exclusion_reason(identity):
    case = case_identity(identity)
    if case is None or case[1] in selected_cases(case[0]):
        return None
    title = "THU Cerebral MRA" if case[0] == "thu_mra" else "MUG500+"
    return (f"{title} case {case[1]} is temporarily not included. This application currently selects at most "
            "10 independent source cases per dataset family; labels, meshes and package versions count as one case. "
            "Source definitions and historical validation records may remain archived, but this case cannot be acquired, built or opened.")
