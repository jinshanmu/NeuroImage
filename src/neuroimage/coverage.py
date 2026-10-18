"""Describe anatomical coverage without merging source spaces or definitions."""
import json
from pathlib import Path


def module_catalog():
    return json.loads(Path(__file__).with_name("catalogs").joinpath("modules.json").read_text())["modules"]


def topic_catalog():
    return json.loads(Path(__file__).with_name("catalogs").joinpath("anatomy-topics.json").read_text())["topics"]


def _coverage(catalog, dataset, structures):
    result = []
    for module in catalog:
        binding = module["sources"].get(dataset)
        if binding is None:
            continue
        record = {"id": module["id"], "title": module["title"], "evidence": binding["evidence"]}
        if module.get("parent_id"):
            record.update(parent_id=module["parent_id"], kind=module["kind"])
        if binding.get("entry"):
            record["entry"] = binding["entry"]
        if structures is not None:
            required = set(binding.get("required_ids", []))
            available = {structure["id"] for structure in structures}
            if not required <= available:
                continue
            matching = [structure for structure in structures if structure["category"] in binding.get("categories", []) or structure["id"] in binding.get("structure_ids", [])]
            if not matching and not binding.get("image_regions"):
                continue
            record["structures"] = len(matching)
            record["structure_ids"] = [structure["id"] for structure in matching]
        result.append(record)
    return result


def source_coverage(dataset, structures=None):
    """Count only structures actually delivered by the selected package version."""
    return _coverage(module_catalog(), dataset, structures)


def source_details(dataset, structures=None):
    """Keep subordinate topics separate from the stable top-level groups."""
    return _coverage(topic_catalog(), dataset, structures)
