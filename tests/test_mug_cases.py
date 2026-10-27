"""Healthy-case identity and geometry provenance must survive cohort expansion."""
import json
from pathlib import Path

import pytest

from neuroimage.adapters import load_recipe, import_dataset
from neuroimage.dataset_info import dataset_info
from neuroimage import mug_cases


@pytest.mark.parametrize("name", mug_cases.mug_recipe_names())
def test_verified_case_recipes_have_distinct_case_and_native_source_inputs(name):
    recipe = load_recipe(name)
    case = recipe["source_case"]["case"]
    assert name.endswith(case.lower())
    assert dataset_info(recipe)["case_id"] == case
    assert dataset_info(recipe)["case_label"] == "Skull " + case
    assert all("A0101" not in paragraph for paragraph in dataset_info(recipe)["description"])
    assert json.loads(json.dumps(recipe, allow_nan=False)) == recipe
    archive = recipe["archives"][0]
    assert len(archive["sha256"]) == 64
    assert "publisher MD5" in archive["hash_basis"]
    member = archive["members"][0]
    assert Path(member["member"]).parent.name == case
    assert member["bytes"] > 0 and len(member["sha256"]) == 64
    assert recipe["inputs"]["stl" if "source_mesh" in name else "labels"] == member["target"]
    assert recipe["inputs"]["license"] == "licenses/mug500_healthy/official-record-v20.json"


def test_original_a0101_recipes_are_not_replaced_by_generated_cases():
    assert mug_cases.mug_recipe("mug500_healthy") is None
    assert mug_cases.mug_recipe("mug500_source_mesh") is None
    assert mug_cases.mug_recipe("mug500_healthy_a0101") is None
    for name in ("mug500_healthy", "mug500_source_mesh"):
        original = json.loads((Path(mug_cases.__file__).with_name("recipes") / (name + ".json")).read_text())
        assert load_recipe(name) == original


@pytest.mark.parametrize("name", ["mug500_healthy_a0000", "mug500_healthy_a0501", "mug500_healthy_../../bad", "unknown"])
def test_unverified_case_ids_cannot_materialize(name):
    assert mug_cases.mug_recipe(name) is None


@pytest.mark.parametrize("case,source_name", [("A0192", "A192_clear.stl"), ("A0473", "A0473_clear .stl")])
def test_publisher_filename_anomalies_retain_original_case_directory_and_name(monkeypatch, case, source_name):
    seed = next(iter(mug_cases.case_inventory().values()))
    entry = json.loads(json.dumps(seed))
    entry["stl"]["member"] = "source/" + case + "/" + source_name
    entry["stl"]["target"] = "raw/mug500_healthy/" + source_name
    monkeypatch.setattr(mug_cases, "_inventory", lambda: {case: entry})
    recipe = mug_cases.mug_recipe("mug500_source_mesh_" + case.lower())
    assert recipe["source_case"]["case"] == case
    assert recipe["objects"][0]["source_name"] == source_name
    assert source_name in recipe["space"]["reference"]
    assert recipe["inputs"]["stl"].endswith(source_name)


def test_materializing_one_case_does_not_mutate_inventory_or_other_recipes():
    names = mug_cases.mug_recipe_names()
    if not names:
        pytest.skip("No additional verified case inventory")
    name = names[0]
    before = json.loads(json.dumps(mug_cases.case_inventory()))
    first = mug_cases.mug_recipe(name)
    first["space"]["name"] = "Changed by caller"
    first["archives"][0]["members"][0]["sha256"] = "changed"
    first["archives"][0]["filename"] = "changed"
    assert mug_cases.mug_recipe(name)["space"]["name"] != "Changed by caller"
    assert mug_cases.mug_recipe(name)["archives"][0]["members"][0]["sha256"] != "changed"
    assert mug_cases.case_inventory() == before


def test_public_inventory_does_not_expose_the_cached_source_records():
    first = mug_cases.case_inventory()
    if not first:
        pytest.skip("No verified healthy inventory")
    case = next(iter(first))
    first[case]["labels"]["sha256"] = "changed"
    assert mug_cases.case_inventory()[case]["labels"]["sha256"] != "changed"
