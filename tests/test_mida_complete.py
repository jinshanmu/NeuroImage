"""Complete normal cranial air-space context without broadening the MIDA tissue scope."""

from copy import deepcopy
import hashlib
import json
from pathlib import Path

import nibabel as nib
import numpy as np

from neuroimage import adapters
from neuroimage.adapters import load_recipe, mida_catalog
from neuroimage.build import build_atlas
from neuroimage.validation import validate_package


ROOT = Path(__file__).resolve().parents[1]
AUDIT_PATH = ROOT / "config/mida-source-eligibility-2026-10-26.json"
LEGACY_PATH = ROOT / "config/source-recipe-history/mida-3.json"


def _audit():
    return json.loads(AUDIT_PATH.read_text())


def _write_lut(path, records):
    path.write_text("\n".join("\t".join([
        str(item["value"]), *item["source_color_components"], item["source_name"],
    ]) for item in records) + "\n", encoding="cp1252")


def test_complete_mida_adds_only_original_ethmoidal_and_frontal_air_classes():
    legacy = json.loads(LEGACY_PATH.read_bytes())
    complete = load_recipe("mida")
    assert complete["id"] == "mida" and complete["version"] == "4"
    assert complete["title"] == legacy["title"]
    old = {item["value"]: item for item in legacy["selection"]}
    new = {item["value"]: item for item in complete["selection"]}
    assert len(old) == 51 and len(new) == 53
    assert set(new) == set(old) | {26, 27}
    assert all(new[value] == spec for value, spec in old.items())
    assert complete["inputs"] == legacy["inputs"]
    assert complete["space"] == legacy["space"]
    assert complete["teaching_sequences"] == legacy["teaching_sequences"]
    assert complete["representation"] == "label-model" and complete["images"] == []
    assert new[26]["source_name"] == "Air Internal - Ethmoidal Sinus"
    assert new[27]["source_name"] == "Air Internal - Frontal Sinus"
    assert new[26]["category"] == new[27]["category"] == new[29]["category"] == "Skull-base context"


def test_mida_audit_uses_actual_source_classes_and_keeps_excluded_tissues_out():
    audit = _audit()
    assert audit["counts"] == {
        "source_lut_values": 116, "present_named_source_values": 116,
        "source_anatomical_values_excluding_named_background_50": 115,
        "legacy_enabled": 51, "newly_enabled": 2, "complete_enabled": 53,
    }
    records = {item["value"]: item for item in audit["structures"]}
    assert len(records) == 116 and all(item["voxel_count"] > 0 for item in records.values())
    assert {value for value, item in records.items() if item["complete_enabled"]} == {
        item["value"] for item in load_recipe("mida")["selection"]
    }
    assert records[50]["eligibility"] == "non_anatomical_background"
    assert records[13]["eligibility"] == "deferred_cervical_neural_extension"
    assert records[44]["eligibility"] == records[45]["eligibility"] == "deferred_craniocervical_bone_extension"
    assert all(not records[value]["complete_enabled"]
               for value in (13, 28, 31, 35, 36, 41, 44, 45, 50, 55, 56, 85, 86, 97))
    assert hashlib.sha256(LEGACY_PATH.read_bytes()).hexdigest() == audit["legacy_recipe_sha256"]


def test_complete_mida_adapter_keeps_canonical_ids_unsplit_source_names_and_colors(tmp_path):
    records = _audit()["structures"]
    _write_lut(tmp_path / "labels.txt", records)
    structures = mida_catalog(load_recipe("mida"), {"label_table": tmp_path / "labels.txt"})
    assert len(structures) == 53
    for item in structures:
        assert item["id"] == f"mida:label:{item['label_value']}"
        assert item["source_values"] == [item["label_value"]]
        assert item["laterality"] == "unspecified"
    lookup = {item["label_value"]: item for item in structures}
    assert lookup[26]["source_name"] == "Air Internal - Ethmoidal Sinus"
    assert lookup[27]["source_name"] == "Air Internal - Frontal Sinus"
    source = {item["value"]: item for item in records}
    for value in (26, 27):
        assert lookup[value]["color"] == [round(float(v) * 255)
                                         for v in source[value]["source_color_components"]]


def test_complete_mida_new_air_labels_preserve_oblique_source_values_and_space(tmp_path, monkeypatch):
    recipe = deepcopy(load_recipe("mida"))
    keep = {26, 27, 29}
    recipe["selection"] = [item for item in recipe["selection"] if item["value"] in keep]
    recipe["inputs"] = {"labels": "labels.nii.gz", "label_table": "labels.txt", "license": "license.txt"}
    recipe["teaching_sequences"] = []
    recipe["construction_peak_gib"] = 1
    _write_lut(tmp_path / "labels.txt", _audit()["structures"])
    (tmp_path / "license.txt").write_text("Synthetic regression fixture; CC0.\n")
    labels = np.zeros((16, 8, 8), dtype=np.uint16)
    for start, value in zip((2, 6, 10), (26, 27, 29)):
        labels[start:start + 3, 2:5, 2:5] = value
    affine = np.asarray([[.48, -.14, 0., -12.], [.14, .48, 0., 3.], [0., 0., .5, -8.], [0., 0., 0., 1.]])
    image = nib.Nifti1Image(labels, affine)
    image.header.set_xyzt_units("mm")
    nib.save(image, tmp_path / "labels.nii.gz")
    original = nib.load(tmp_path / "labels.nii.gz")
    monkeypatch.setattr(adapters, "load_recipe", lambda _: recipe)
    path = build_atlas("mida", tmp_path, workers=1, minimum_free_gib=0)
    manifest = validate_package(path)
    assert manifest.dataset_id == manifest.package_id == "mida"
    assert manifest.representation == "label-model"
    assert len(manifest.volumes) == 1 and manifest.volumes[0].kind == "labels"
    assert {item.label_value for item in manifest.structures} == keep
    restored = nib.load(path.parent / manifest.volumes[0].file)
    assert np.array_equal(np.asanyarray(restored.dataobj), labels)
    assert np.array_equal(restored.affine, original.affine)
