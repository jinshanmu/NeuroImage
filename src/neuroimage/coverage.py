"""Describe anatomical coverage without merging source spaces or definitions."""
import json
from pathlib import Path
import re
from copy import deepcopy
from functools import lru_cache
from .dataset_policy import dataset_is_excluded


@lru_cache(maxsize=4)
def _read_catalog(filename, modified):
    path = Path(__file__).with_name("catalogs") / filename
    data = json.loads(path.read_text())
    return data["modules" if filename == "modules.json" else "topics"]


def _catalog(filename):
    path = Path(__file__).with_name("catalogs") / filename
    return _read_catalog(filename, path.stat().st_mtime_ns)


def _source_binding(sources, dataset):
    """Reuse anatomy definitions across cases without claiming absent labels."""
    if dataset in sources:
        return sources[dataset]
    canonical = None
    if re.fullmatch(r"thu_mra_case\d{3}", dataset) and 1 <= int(dataset[-3:]) <= 109:
        # Volunteer 009 contains every source segment (1..20). Matching below
        # still requires the actual new-case labels and explicit topic guards.
        canonical = "thu_mra_case009"
    elif dataset == "brainstem_navigator_iit":
        canonical = "brainstem_navigator_mni"
    elif dataset == "spl_nac_complete":
        canonical = "spl_nac"
    elif dataset == "z_anatomy_complete":
        canonical = "z_anatomy"
    elif dataset == "mida_complete":
        canonical = "mida"
    elif re.fullmatch(r"mug500_(healthy|source_mesh)_a\d{4}", dataset):
        canonical = dataset.rsplit("_", 1)[0]
    binding = sources.get(canonical)
    if binding is None:
        return None
    # SPL's original numeric source identities remain stable across the coarse
    # and complete label representations. Other packages namespace their IDs.
    if dataset in {"spl_nac_complete", "z_anatomy_complete", "mida_complete"}:
        return binding
    def remap(value):
        if isinstance(value, str):
            value = value.replace(canonical, dataset)
            if dataset.startswith("mug500_"):
                value = value.replace("a0101", dataset.rsplit("_", 1)[1])
            return value
        if isinstance(value, list):
            return [remap(item) for item in value]
        if isinstance(value, dict):
            return {key: remap(item) for key, item in value.items()}
        return value
    result = remap(binding)
    actual = _known_case_structures(dataset)
    if actual is not None:
        available = {item["id"] for item in actual}
        required = set(result.get("required_ids", []))
        primary = set(result.get("required_any_ids", []))
        if not required <= available or (primary and not primary & available):
            return None
        for field in ("structure_ids", "required_any_ids"):
            if field in result:
                result[field] = [ident for ident in result[field] if ident in available]
    return result


def module_catalog():
    return deepcopy(_catalog("modules.json"))


def topic_catalog():
    return deepcopy(_catalog("anatomy-topics.json"))


def _coverage(catalog, dataset, structures):
    result = []
    for module in catalog:
        binding = _source_binding(module["sources"], dataset)
        if binding is None:
            continue
        record = {"id": module["id"], "title": module["title"], "evidence": binding["evidence"]}
        if binding.get("coverage_note"):
            record["coverage_note"] = binding["coverage_note"]
        if module.get("parent_id"):
            record.update(parent_id=module["parent_id"], kind=module["kind"])
        if binding.get("entry"):
            record["entry"] = deepcopy(binding["entry"])
        if structures is not None:
            required = set(binding.get("required_ids", []))
            available = {structure["id"] for structure in structures}
            if not required <= available:
                continue
            # A related background object alone cannot qualify a source for a
            # detailed subject. Local packages may supply any declared subject
            # unless the topic explicitly requires an entire set (e.g. paired A1).
            primary = set(binding.get("required_any_ids", []))
            if primary and not primary & available:
                continue
            # A whole-brain atlas must deliver labels in every declared major
            # compartment. A reference MRI or one surviving regional label
            # does not establish the package's anatomical label coverage.
            categories = {structure["category"] for structure in structures}
            if not set(binding.get("required_categories", [])) <= categories:
                continue
            excluded = set(binding.get("exclude_ids", []))
            matching = [structure for structure in structures if structure["id"] not in excluded
                        and (structure["category"] in binding.get("categories", []) or structure["id"] in binding.get("structure_ids", []))]
            if primary and not any(structure["id"] in primary for structure in matching):
                continue
            if not matching and not binding.get("image_regions"):
                continue
            record["structures"] = len(matching)
            record["structure_ids"] = [structure["id"] for structure in matching]
            if primary:
                record["primary_structure_ids"] = [structure["id"] for structure in matching
                                                   if structure["id"] in primary]
        result.append(record)
    return result


def source_coverage(dataset, structures=None):
    """Count only structures actually delivered by the selected package version."""
    if dataset_is_excluded(dataset):
        return []
    if structures is None:
        structures = _known_case_structures(dataset)
    return _coverage(_catalog("modules.json"), dataset, structures)


def source_details(dataset, structures=None):
    """Keep subordinate topics separate from the stable top-level groups."""
    if dataset_is_excluded(dataset):
        return []
    if structures is None:
        structures = _known_case_structures(dataset)
    return _coverage(_catalog("anatomy-topics.json"), dataset, structures)


def _known_case_structures(dataset):
    if re.fullmatch(r"thu_mra_case\d{3}", dataset):
        from .thu_cases import _case_catalog
        record = _case_catalog().get(dataset[-3:])
        if record is not None:
            return [{"id": dataset + ":label:" + str(value), "category": "Cerebral arterial segments"}
                    for value in record["present_values"]]
    return None
