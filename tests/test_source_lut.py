"""Verify explicit label identity and native oblique MRI correspondence."""
import copy
import json

import nibabel as nib
import numpy as np
import pytest

from neuroimage.source_lut import read_freesurfer_lut, read_index_name_color_tsv, source_lut_catalog
from neuroimage.geometry import NativeVolume, save_nifti
from neuroimage import build as pipeline
from test_pipeline import source, build


@pytest.fixture
def lut_source(tmp_path):
    lut = tmp_path / "source-lut.txt"
    lut.write_text("# Synthetic identity fixture\n0 Unknown 0 0 0 0\n11 layer_of_rostral_ca1 20 40 60 0\n50 ctx-rh-test 80 100 120 0\n")
    hierarchy = tmp_path / "hierarchy.json"
    hierarchy.write_text(json.dumps([{"label": "Synthetic-Hippocampus", "children": [
        {"label": "layer_of_rostral_ca1", "data": {"xm": 999}}, {"label": None}]}]))
    recipe = {"id": "synthetic", "representation": "mri-labels", "images": [{"id": "t1"}],
              "label_table": {"input": "lut", "format": "freesurfer-lut", "values": [50, 11],
                              "hierarchy_input": "hierarchy", "default_category": "Source anatomy",
                              "evidence": "Generated fixture", "source_notes": ["Synthetic native block"]}}
    return recipe, {"lut": lut, "hierarchy": hierarchy}


def test_source_identity_colors_and_only_explicit_laterality(lut_source):
    recipe, paths = lut_source
    records = source_lut_catalog(recipe, paths)
    assert [r["source_values"] for r in records] == [[11], [50]]
    assert records[0]["source_name"] == "layer_of_rostral_ca1"
    assert records[0]["name"] == "Layer of rostral CA1"
    assert records[0]["category"] == "Synthetic Hippocampus"
    assert records[0]["laterality"] == "unspecified"
    assert records[0]["color"] == [20, 40, 60]
    assert records[1]["laterality"] == "right"
    assert records[1]["category"] == "Source anatomy"
    assert "xm" not in records[0]


def test_indexed_tsv_binds_explicit_probability_channels(lut_source):
    recipe, paths = lut_source
    paths["lut"].write_text("index\tname\tcolor\n11\tLeft_CrusI\t#1256ab\n50\tVermis_X\t#aBcD12\n")
    paths["probabilities"] = paths["lut"].parent / "fixture-series.nii.gz"
    recipe["label_table"].update(format="index-name-color-tsv", laterality_prefixes={"Left_": "left", "Vermis_": "midline"},
        categories=[{"values": [50], "title": "Midline source regions"}])
    recipe.update(probability_interpretation="Generated support", probability_derivation="Known fixture",
        probabilities=[{"id": "support-11", "input": "probabilities", "channel": 2, "label_value": 11, "source_name": "Left_CrusI"}])
    result = source_lut_catalog(recipe, paths)
    assert result[0]["color"] == [18, 86, 171] and result[0]["laterality"] == "left"
    assert result[0]["probability"]["source_channel"] == 2
    assert result[1]["laterality"] == "midline" and result[1]["category"] == "Midline source regions"
    assert "probability" not in result[1]
    recipe["probabilities"][0]["source_name"] = "Vermis_X"
    with pytest.raises(ValueError, match="explicit LUT identities"):
        source_lut_catalog(recipe, paths)


def test_display_palette_retains_original_color_and_numeric_identity(lut_source):
    recipe, paths = lut_source
    original = paths["lut"].read_bytes()
    recipe["label_table"].update(display_colors={"11": [240, 190, 80]},
                                display_color_evidence="Presentation contrast on a dark background")
    record = source_lut_catalog(recipe, paths)[0]
    assert record["color"] == [240, 190, 80] and record["source_values"] == [11]
    assert "Original source RGB: [20, 40, 60]" in record["source_notes"][-1]
    assert paths["lut"].read_bytes() == original
    recipe["label_table"]["display_colors"]["11"] = [256, 190, 80]
    with pytest.raises(ValueError, match="valid RGB"):
        source_lut_catalog(recipe, paths)


@pytest.mark.parametrize("content", [
    "name\tindex\tcolor\nLeft_Test\t1\t#000000\n",
    "index\tname\tcolor\n1\tLeft_Test\t#00000g\n",
    "index\tname\tcolor\n1\tLeft_Test\t#000000\n1\tOther\t#ffffff\n",
    "index\tname\tcolor\n1\t\t#000000\n",
    "index\tname\tcolor\n1\tLeft_Test\n",
])
def test_ambiguous_indexed_tsv_fails_without_rewriting_source(tmp_path, content):
    path = tmp_path / "source.tsv"
    path.write_text(content)
    with pytest.raises(ValueError):
        read_index_name_color_tsv(path)
    assert path.read_text() == content


@pytest.mark.parametrize("line", ["11 conflicting 1 2 3 0", "12 bad 256 0 0 0", "13 incomplete 1 2 3", "14 fractional 1.5 2 3 0"])
def test_ambiguous_or_malformed_lut_is_preserved_and_rejected(lut_source, line):
    _, paths = lut_source
    path = paths["lut"]
    path.write_text(path.read_text() + line + "\n")
    original = path.read_bytes()
    with pytest.raises(ValueError):
        read_freesurfer_lut(path)
    assert path.read_bytes() == original


@pytest.mark.parametrize("values", [[11, 999], [11, 11], [True], [0], []])
def test_missing_or_invalid_numeric_identity_requires_resolution(lut_source, values):
    recipe, paths = lut_source
    recipe = copy.deepcopy(recipe)
    recipe["label_table"]["values"] = values
    with pytest.raises(ValueError):
        source_lut_catalog(recipe, paths)


def test_unused_color_defect_and_multiple_source_categories_are_explicit(lut_source):
    recipe, paths = lut_source
    paths["lut"].write_text(paths["lut"].read_text() + "835 unused_source_entry 40 320 180 0\n")
    groups = json.loads(paths["hierarchy"].read_text())
    groups.append({"label": "Another source group", "children": [{"label": "layer_of_rostral_ca1"}]})
    paths["hierarchy"].write_text(json.dumps(groups))
    assert source_lut_catalog(recipe, paths)[0]["category"] == "Synthetic Hippocampus / Another source group"
    recipe["label_table"]["values"].append(835)
    with pytest.raises(ValueError, match="invalid RGB"):
        source_lut_catalog(recipe, paths)


def test_oblique_block_and_larger_mri_keep_separate_native_grids(source, lut_source, monkeypatch):
    root, imported = source
    spec, paths = lut_source
    imported.recipe.update(adapter="source-lut-nifti", representation="mri-labels", require_same_grid=False,
                           require_full_label_inventory=True, label_table=spec["label_table"])
    imported.input_paths.update(paths)
    imported.recipe["inputs"].update({k: p.name for k, p in paths.items()})
    imported.structures = source_lut_catalog(imported.recipe, imported.input_paths)
    original = nib.load(imported.input_paths["labels"])
    labels = np.asanyarray(original.dataobj).copy()
    affine = original.affine.copy()
    affine[0, 1] = .15
    affine[2, 0] = -.07
    save_nifti(NativeVolume(labels, affine, {}), imported.input_paths["labels"])
    mri = np.arange(32 * 22 * 24, dtype=np.int16).reshape(32, 22, 24)
    save_nifti(NativeVolume(mri, original.affine, {}), imported.input_paths["t1"])
    path = build(source)
    manifest = pipeline.validate_package(path)
    label_volume = next(v for v in manifest.volumes if v.kind == "labels")
    restored = nib.load(path.parent / label_volume.file)
    assert np.array_equal(np.asanyarray(restored.dataobj), labels)
    assert np.allclose(restored.affine, affine, rtol=0, atol=1e-6)
    image = next(v for v in manifest.volumes if v.kind == "image")
    assert image.shape != label_volume.shape
    assert image.affine_ras_mm != label_volume.affine_ras_mm
    for structure in manifest.structures:
        point = np.rint(nib.affines.apply_affine(np.linalg.inv(affine), structure.target_ras_mm)).astype(int)
        assert labels[tuple(point)] == structure.label_value
    assert "source_lut.py" in manifest.build["implementation"]
    original_manifest = path.read_bytes()
    monkeypatch.setattr(pipeline, "read_volume", lambda *args, **kwargs: pytest.fail("Completed source work must be reused"))
    assert build(source) == path
    assert path.read_bytes() == original_manifest
