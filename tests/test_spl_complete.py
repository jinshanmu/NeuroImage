"""Preserve every verified SPL/NAC source label without replacing fine labels by unions."""

from copy import deepcopy
import csv
import hashlib
import json
from pathlib import Path

import nibabel as nib
import nrrd
import numpy as np
import pytest

from neuroimage import adapters
from neuroimage.adapters import load_recipe, spl_catalog
from neuroimage.build import build_atlas
from neuroimage.validation import validate_package


ROOT = Path(__file__).resolve().parents[1]
AUDIT_PATH = ROOT / "config/spl-nac-source-inventory-2026-10-26.json"


def _audit():
    return json.loads(AUDIT_PATH.read_text())


def _selection_values(recipe):
    return [value for group in recipe["selection"] for value in group["values"]]


def _enabled_records():
    return [item for item in _audit()["structures"]
            if item["eligibility"] in {"intracranial_source", "cranial_nerve_whole_source"}]


def _write_tables(root, records):
    """Retain the inspected source snapshot's exact labels, colors and metadata."""
    for filename, fields, rows in (
        ("labels.tsv", ["value", "label", "color"],
         [{"value": item["value"], "label": item["source_name"], "color": item["source_color"]}
          for item in records]),
        ("metadata.tsv", ["value", "label", "notes"],
         [{"value": item["value"], "label": item["source_metadata_name"] or "",
           "notes": item["source_metadata_notes"] or ""} for item in records]),
    ):
        with (root / filename).open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fields, delimiter="\t")
            writer.writeheader()
            writer.writerows(rows)


@pytest.mark.parametrize("name", ["spl_nac", "spl_nac_complete"])
def test_complete_spl_recipe_matches_the_inspected_nonempty_named_source_inventory(name):
    audit = _audit()
    recipe = load_recipe(name)
    values = _selection_values(recipe)
    records = _enabled_records()
    assert len(values) == len(set(values)) == 236
    assert values == [item["value"] for item in records]
    assert all(item["voxel_count"] > 0 for item in records)
    assert 0 not in values and 1 not in values
    assert not recipe.get("unions")
    assert not set(values) & {60001, 60002, 60003, 60004}
    assert audit["counts"]["present_nonzero_values"] == 312
    assert audit["counts"]["present_named_labels"] == 311
    assert audit["unnamed_present_values"][0]["value"] == 1
    assert len(audit["lut_only_absent_from_label_volume"]) == 32
    assert audit["eligibility_counts"] == {
        "intracranial_source": 234, "cranial_nerve_whole_source": 2,
        "extracranial_head_neck": 73, "orbital_source": 2,
    }
    assert not set(values) & set(audit["enabled_recipe_scope"]["excluded_named_source_values"])


@pytest.mark.parametrize("name", ["spl_nac", "spl_nac_complete"])
def test_complete_spl_catalog_keeps_source_names_sides_and_compound_labels(tmp_path, name):
    recipe = load_recipe(name)
    records = _enabled_records()
    _write_tables(tmp_path, records)
    structures = spl_catalog(recipe, {
        "label_table": tmp_path / "labels.tsv", "metadata_table": tmp_path / "metadata.tsv",
    })
    assert [item["source_name"] for item in structures] == [item["source_name"] for item in records]
    assert [item["source_values"] for item in structures] == [[item["value"]] for item in records]
    lookup = {item["label_value"]: item for item in structures}
    assert lookup[66]["laterality"] == "left" and lookup[71]["laterality"] == "right"
    assert lookup[373]["source_name"] == "left FaGE nuclei"  # Do not invent individual nuclei.
    assert lookup[300]["source_name"] == "left I II v"  # Retain source abbreviations.
    assert 4002 not in lookup and 4027 not in lookup and 4028 not in lookup
    assert lookup[215]["source_name"] == "right optic nerve"
    assert lookup[3020]["source_name"] == "right superior colliculus"
    assert not any(item["id"].startswith("spl_nac:group:") for item in structures)


def test_legacy_spl_unions_remain_available_independently_and_are_not_modified():
    audit = _audit()
    legacy_path = ROOT / "config/source-history/spl_nac-v1.json"
    assert hashlib.sha256(legacy_path.read_bytes()).hexdigest() == audit["legacy_recipe_sha256"]
    legacy = json.loads(legacy_path.read_text())
    direct = set(_selection_values(legacy))
    unions = {value for group in legacy["unions"] for value in group["source_values"]}
    present = {item["value"] for item in audit["structures"]}
    assert len(direct) == 101 and len(legacy["unions"]) == 4
    assert len(unions) == 94 and len(unions & present) == 90
    assert sorted(unions - present) == [325, 326, 359, 360]
    assert len(present - direct) == 210
    assert len(present - direct - unions) == 120
    current = load_recipe("spl_nac")
    assert current["version"] == "2" and current["id"] == legacy["id"]
    assert current["title"] == legacy["title"] and current["space"] == legacy["space"]
    assert set(_selection_values(current)) >= direct
    assert not current.get("unions")


def test_vtk_only_sulci_stay_out_of_the_volume_recipe_without_invented_voxels():
    audit = _audit()
    values = set(_selection_values(load_recipe("spl_nac")))
    vtk_only = {item["value"] for item in audit["vtk_only_named_values"]}
    assert vtk_only == {3, *range(5001, 5023)}
    assert not values & vtk_only
    assert all(item["source_models"] for item in audit["vtk_only_named_values"])
    assert audit["counts"]["source_vtk_files"] == 359
    assert audit["counts"]["source_vtk_label_ids"] == 328


def test_complete_spl_build_retains_fine_labels_and_both_native_physical_grids(tmp_path, monkeypatch):
    recipe = deepcopy(load_recipe("spl_nac"))
    keep = {66, 300, 71}
    records = [item for item in _audit()["structures"] if item["value"] in keep]
    recipe["selection"] = [{"category": item["category"], "values": [item["value"]]}
                           for item in records]
    recipe["inputs"] = {"labels": "labels.nrrd", "t1": "t1.nrrd", "t2": "t2.nrrd",
                        "label_table": "labels.tsv", "metadata_table": "metadata.tsv",
                        "license": "license.txt", "archive_license": "license.txt"}
    _write_tables(tmp_path, records)
    (tmp_path / "license.txt").write_text("Synthetic regression fixture; CC0.\n")
    labels = np.zeros((16, 8, 8), dtype=np.uint16)
    labels[0, 0, 0] = 1  # No named source definition: it must not become invented anatomy.
    for start, value in zip((10, 6, 2), (66, 300, 71)):
        labels[start:start + 3, 2:5, 2:5] = value
    header = {"space": "left-posterior-superior", "space directions": np.eye(3),
              "space origin": np.asarray([-7., -8., -9.])}
    nrrd.write(str(tmp_path / "labels.nrrd"), labels, header)
    image_header = {**header, "space origin": header["space origin"] + .5}
    image = np.arange(labels.size, dtype=np.uint16).reshape(labels.shape)
    for name in ("t1", "t2"):
        nrrd.write(str(tmp_path / f"{name}.nrrd"), image, image_header)
    monkeypatch.setattr(adapters, "load_recipe", lambda _: recipe)
    path = build_atlas("spl_nac", tmp_path, workers=1, minimum_free_gib=0)
    manifest = validate_package(path)
    label_volume = next(volume for volume in manifest.volumes if volume.kind == "labels")
    native = nib.load(path.parent / label_volume.file)
    expected = labels.copy()
    expected[expected == 1] = 0
    assert np.array_equal(np.asanyarray(native.dataobj), expected)
    assert {item.label_value for item in manifest.structures} == keep
    expected_affine = np.diag([-1., -1., 1., 1.])
    expected_affine[:3, 3] = [7., 8., -9.]
    assert np.array_equal(native.affine, expected_affine)
    expected_image_affine = expected_affine.copy()
    expected_image_affine[:3, 3] = [6.5, 7.5, -8.5]
    for volume in manifest.volumes:
        if volume.id in {"t1", "t2"}:
            actual_image = nib.load(path.parent / volume.file)
            assert np.array_equal(actual_image.affine, expected_image_affine)
            assert np.array_equal(np.asanyarray(actual_image.dataobj), image)
