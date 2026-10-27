"""Expanded source data stays within the existing anatomy navigation groups."""
from pathlib import Path

from neuroimage.adapters import import_dataset, load_recipe
from neuroimage.coverage import source_coverage, source_details, module_catalog
from neuroimage.thu_cases import thu_recipe_names


def _case_structures(recipe):
    return [{"id": recipe["id"] + ":label:" + str(item["value"]),
             "category": item["category"]} for item in recipe["selection"]]


def test_all_thu_cases_expose_only_their_actual_source_labels():
    for name in thu_recipe_names():
        recipe = load_recipe(name)
        structures = _case_structures(recipe)
        available = {item["id"] for item in structures}
        groups = source_coverage(name, structures)
        assert groups
        for scope in groups + source_details(name, structures):
            assert set(scope.get("structure_ids", [])) <= available
            assert set(scope.get("primary_structure_ids", [])) <= available
            assert all(ident.startswith(name + ":") for ident in scope.get("structure_ids", []))


def test_complete_spl_regions_include_real_subdivisions_and_add_no_new_primary_groups():
    recipe = load_recipe("spl_nac")
    structures = [{"id": "spl_nac:label:" + str(value), "category": group["category"]}
                  for group in recipe["selection"] for value in group["values"]]
    groups = source_coverage(recipe["id"], structures)
    assert next(item for item in groups if item["id"] == "general-anatomy")["structures"] == 236
    assert next(item for item in groups if item["id"] == "cranial-nerves")["structures"] == 2
    topics = source_details(recipe["id"], structures)
    thalamus = next(item for item in topics if item["id"] == "detail-thalamic-subthalamic")
    assert len(thalamus["structure_ids"]) == 26
    assert all(":label:" in ident for ident in thalamus["structure_ids"])
    assert next(item for item in topics if item["id"] == "detail-cerebellar-lobules")["structures"] == 64
    assert {item["id"] for item in groups} <= {item["id"] for item in module_catalog()}


def test_coverage_catalog_cache_cannot_be_mutated_by_callers():
    original = module_catalog()
    changed = module_catalog()
    changed[0]["title"] = "Changed"
    assert module_catalog() == original
    first = source_coverage("cerebra")
    entry = next((item for item in first if "entry" in item), None)
    if entry:
        entry["entry"]["selected"] = "Changed"
        assert source_coverage("cerebra") != first


def test_broad_white_matter_context_cannot_replace_actual_source_pathways():
    recipe = load_recipe("z_anatomy")
    context = [item for item in recipe["objects"] if item["category"] == "Cerebral white matter model context"]
    assert len(context) == 2
    assert "white-matter-pathways" not in {item["id"] for item in source_coverage(recipe["id"], context)}
    group = next(item for item in source_coverage(recipe["id"], recipe["objects"]) if item["id"] == "white-matter-pathways")
    assert {item["id"] for item in context} <= set(group["structure_ids"])
