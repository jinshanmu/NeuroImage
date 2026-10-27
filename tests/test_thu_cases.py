"""Preserve all 109 source definitions while enabling the selected ten volunteers."""
from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import zipfile

import numpy as np
import pytest
import SimpleITK as sitk

from neuroimage.adapters import load_recipe, recipe_names, source_label_catalog
from neuroimage.thu_cases import thu_recipe, thu_recipe_names
from neuroimage.case_selection import selected_cases


ROOT = Path(__file__).parents[1]
CATALOG = json.loads((ROOT / "src/neuroimage/catalogs/thu-cerebral-mra-cases.json").read_text())
LEGACY = {"001", "006", "007", "009", "010", "014", "021", "030"}


def test_all_original_cases_registered_once_and_legacy_recipes_unchanged():
    expected = {f"thu_mra_case{case}" for case in selected_cases("thu_mra")}
    assert set(thu_recipe_names()) == expected
    names = [name for name in recipe_names() if name.startswith("thu_mra_case")]
    assert set(names) == expected and len(names) == 10
    assert len(CATALOG["cases"]) == 109
    for case in LEGACY:
        path = ROOT / "src/neuroimage/recipes" / f"thu_mra_case{case}.json"
        assert load_recipe(path.stem) == json.loads(path.read_text())


@pytest.mark.parametrize("case", CATALOG["cases"], ids=lambda case: case["case"])
def test_each_case_selects_its_exact_nonempty_original_inventory(case):
    name = "thu_mra_case" + case["case"]
    recipe = load_recipe(name) if case["case"] in selected_cases("thu_mra") else thu_recipe(name)
    positive = sorted(int(value) for value, count in case["values"].items() if int(value) > 0 and count > 0)
    assert positive == case["present_values"] == recipe["source_case"]["present_values"]
    assert set(positive).isdisjoint(case["absent_values"])
    assert set(positive) | set(case["absent_values"]) == set(range(1, 21))
    assert sum(case["values"].values()) == np.prod(case["shape_xyz"])
    assert [item["value"] for item in recipe["selection"]] == positive
    structures = source_label_catalog(recipe)
    assert [item["source_values"] for item in structures] == [[value] for value in positive]
    assert all(item["id"].startswith(name + ":label:") for item in structures)
    assert all(isinstance(item["source_notes"], list) for item in structures)
    reference = {item["value"]: item for item in load_recipe("thu_mra_case009")["selection"]}
    for item in recipe["selection"]:
        for key in ("name", "source_name", "category", "laterality", "color"):
            assert item[key] == reference[item["value"]][key]
    assert recipe["metaimage_units"] == "mm"
    assert recipe["require_same_grid"] and recipe["require_full_label_inventory"]
    assert recipe["space"]["id"] == f"thu-mra-{case['case']}-source-processed"
    assert recipe["space"]["name"].startswith(f"Healthy volunteer {case['case']},")
    assert case["landmark_ids"] == list(range(1, 21))
    assert case["landmark_count"] == recipe["source_case"]["landmark_count"] == 20
    for key, member in zip(("mra", "labels", "landmarks"), recipe["archives"][0]["members"]):
        assert member == case["members"][key]
        assert recipe["inputs"][key] == member["target"]
        assert member["member"].startswith(f"annotation-aftpreprocess/{case['case']}-")
        assert len(member["sha256"]) == 64 and member["bytes"] > 0


@pytest.mark.parametrize("name", ["thu_mra_case000", "thu_mra_case110", "thu_mra_case1",
                                  "thu_mra_case001/../../x", "unrelated"])
def test_factory_does_not_guess_unsupported_case_ids(name):
    assert thu_recipe(name) is None


def test_new_case_recipes_are_independent_and_preserve_source_limitations():
    original = thu_recipe("thu_mra_case002")
    before = deepcopy(original)
    original["selection"][0]["color"][0] = -1
    original["archives"][0]["members"][0]["sha256"] = "changed"
    original["source_case"]["landmarks_outside_image"].clear()
    assert thu_recipe("thu_mra_case002") == before
    assert 14 in [point["id"] for point in before["source_case"]["landmarks_outside_image"]]
    assert any("outside the cropped source image" in note for note in before["scope_notes"])
    assert "teaching_sequences" not in before
    assert "thu_mra_case001" not in json.dumps(before)


@pytest.fixture
def preparation_module():
    spec = importlib.util.spec_from_file_location("prepare_thu_test", ROOT / "scripts/prepare_thu_mra_cases.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_missing_input_is_exclusive_and_never_replaces_existing_original(tmp_path, preparation_module):
    path = tmp_path / "case.mha"
    preparation_module.add_missing_input(path, b"original")
    with pytest.raises(FileExistsError):
        preparation_module.add_missing_input(path, b"replacement")
    assert path.read_bytes() == b"original"


def test_verification_accepts_only_original_explicitly_inventoried_crop_external_points():
    spec = importlib.util.spec_from_file_location("verify_thu_test", ROOT / "scripts/verify_thu_mra_source.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    image = sitk.Image((10, 10, 10), sitk.sitkFloat32)
    point = np.asarray([4., 5., 2.])
    evidence = {"id": 14, "ras_mm": point.tolist(), "original_voxel_index": [-4., -5., 2.]}
    with pytest.raises(ValueError, match="matching source evidence"):
        module.landmark_observation(14, point, image, [])
    with pytest.raises(ValueError, match="matching source evidence"):
        module.landmark_observation(14, point, image, [{**evidence, "ras_mm": [1, 2, 3]}])
    observation = module.landmark_observation(14, point, image, [evidence])
    assert observation["inside_source_image"] is False
    assert observation["ras_mm"] == point.tolist()
    assert observation["original_voxel_index"] == [-4., -5., 2.]
    assert module.landmark_observation(1, np.asarray([-1., -2., 3.]), image, [])["inside_source_image"]


def test_offline_preparation_verifies_actual_pair_and_preserves_original_bytes(tmp_path, monkeypatch, preparation_module):
    module = preparation_module
    monkeypatch.setattr(module, "CASE_IDS", ["001", "015"])
    raw = tmp_path / module.RAW_DIRECTORY
    raw.mkdir(parents=True)
    staging = tmp_path / "staging"
    staging.mkdir()
    archive = tmp_path / "downloads/thu_cerebral_mra/annotation-aftpreprocess.zip"
    archive.parent.mkdir(parents=True)
    inventory, original_bytes = [], {}
    with zipfile.ZipFile(archive, "w") as source:
        for case in module.CASE_IDS:
            image = sitk.GetImageFromArray(np.arange(27, dtype=np.float32).reshape(3, 3, 3))
            image.SetSpacing((1.2, 2, 2.5))
            image.SetOrigin((1, 2, 3))
            image.SetDirection((0, 1, 0, 1, 0, 0, 0, 0, -1))
            pixels = np.zeros((3, 3, 3), dtype=np.uint8)
            pixels[0, 0, 0], pixels[2, 2, 2] = 1, 20
            labels = sitk.GetImageFromArray(pixels)
            labels.CopyInformation(image)
            point = np.asarray(image.TransformIndexToPhysicalPoint((1, 1, 1))) * [-1, -1, 1]
            landmarks = "# CoordinateSystem = 0\n" + "\n".join(
                f"point,{point[0]},{point[1]},{point[2]},0,0,0,1,1,1,1,F-{ident},,"
                for ident in range(1, 21))
            sitk.WriteImage(image, str(staging / f"{case}-img.mha"))
            sitk.WriteImage(labels, str(staging / f"{case}-sseg-label.mha"))
            (staging / f"{case}-land.fcsv").write_text(landmarks)
            inventory.append({"case": case, **module.grid(labels), "values": {"0": 25, "1": 1, "20": 1}})
            for key, suffix in module.SUFFIXES.items():
                filename = f"{case}-{suffix}"
                content = (staging / filename).read_bytes()
                source.writestr(f"annotation-aftpreprocess/{filename}", content)
                if case == "001" or key != "mra":
                    (raw / filename).write_bytes(content)
                    original_bytes[filename] = content
    evidence = tmp_path / "benchmarks/thu_cerebral_mra/source-readiness/label-inventory.json"
    evidence.parent.mkdir(parents=True)
    evidence.write_text(json.dumps(inventory))
    monkeypatch.setattr(module, "ARCHIVE_BYTES", archive.stat().st_size)
    monkeypatch.setattr(module, "ARCHIVE_SHA256", module.sha256_file(archive))
    with pytest.raises(FileNotFoundError):
        module.prepare(tmp_path)
    catalog, added = module.prepare(tmp_path, extract_missing_images=True)
    assert added == [f"{module.RAW_DIRECTORY}/015-img.mha"]
    assert all(case["present_values"] == [1, 20] for case in catalog["cases"])
    assert all(case["direction"] == [0, 1, 0, 1, 0, 0, 0, 0, -1] for case in catalog["cases"])
    assert all((raw / name).read_bytes() == content for name, content in original_bytes.items())
    for case in catalog["cases"]:
        for member in case["members"].values():
            assert hashlib.sha256((tmp_path / member["target"]).read_bytes()).hexdigest() == member["sha256"]
    # An altered original is reported, never silently overwritten from the ZIP.
    damaged = raw / "001-land.fcsv"
    damaged.write_bytes(b"changed original")
    with pytest.raises(ValueError, match="not replaced"):
        module.prepare(tmp_path, extract_missing_images=True)
    assert damaged.read_bytes() == b"changed original"


def test_full_cohort_extraction_rejects_unselected_cases_before_any_input_write(tmp_path, monkeypatch, preparation_module):
    from neuroimage.dataset_policy import ExcludedDatasetError
    monkeypatch.setattr(preparation_module, "CASE_IDS", ["001", "002"])
    monkeypatch.setattr(preparation_module, "add_missing_input",
                        lambda *args: pytest.fail("Case policy must be checked before writing any source input"))
    with pytest.raises(ExcludedDatasetError, match="temporarily not included"):
        preparation_module.prepare(tmp_path, extract_missing_images=True)
    assert list(tmp_path.iterdir()) == []
