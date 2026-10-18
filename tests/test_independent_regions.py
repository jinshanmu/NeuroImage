"""Asymmetric overlapping scalar fields exercise independent region semantics."""
import json
from pathlib import Path
import nibabel as nib
import numpy as np
import pytest

from neuroimage import build as pipeline
from neuroimage.adapters import ImportedDataset, independent_catalog
from neuroimage.contracts import Manifest
from neuroimage.validation import validate_geometry, validate_package


@pytest.fixture
def region_source(tmp_path, monkeypatch):
    affine = np.array([[-1.5, 0, 0, 7], [0, 2, 0, -9], [0, 0, 2.5, -11], [0, 0, 0, 1]])
    shape = (9, 11, 13)
    paths = {}
    def write(ident, values):
        path = tmp_path / (ident + ".nii.gz")
        image = nib.Nifti1Image(values, affine); image.header.set_xyzt_units("mm"); nib.save(image, path)
        paths[ident] = path
    write("t2", np.arange(np.prod(shape), dtype=np.float32).reshape(shape))
    for ident, start in (("A", 2), ("B", 3)):
        p = np.zeros(shape, np.float64)
        p[start:start + 3, 3:6, 4:8] = .8
        p[start, 3, 4] = .35  # The threshold itself is a member, not background.
        p[start, 2, 4] = .2   # Retain support outside the navigation mask.
        write(ident + "_probability", p); write(ident + "_mask", (p >= .35).astype(np.uint8))
    paths["license"] = tmp_path / "license.txt"; paths["license"].write_text("Generated fixture. CC0.\n")
    recipe = {"id": "region_test", "version": "1", "title": "Generated independent regions", "representation": "mri-regions",
        "inputs": {key: path.name for key, path in paths.items()}, "images": [{"id": "t2", "name": "Generated context"}],
        "space": {"id": "test-native", "name": "Synthetic native", "reference": "Generated field", "correspondence": "Known test geometry"},
        "sources": [{"id": "test", "title": "Synthetic source", "version": "1", "url": "https://example.org/", "citation": "Generated tests",
                     "license_name": "CC0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/", "license_input": "license"}],
        "mask_rule": {"threshold": .35, "operator": ">=", "source": "Generated inclusive source mask"},
        "probability_interpretation": "Generated test scalar field; not anatomy", "probability_derivation": "Known fixture",
        "region_evidence": "Generated independent masks", "region_notes": [],
        "regions": [{"source_name": name, "name": name, "category": "Fixture regions", "laterality": "unspecified", "color": [100, 140, 200],
                     "mask_input": name + "_mask", "probability_input": name + "_probability"} for name in ("A", "B")]}
    imported = ImportedDataset(recipe, paths, independent_catalog(recipe))
    monkeypatch.setattr(pipeline, "import_dataset", lambda *args: imported)
    return tmp_path, imported


def construct(source):
    return pipeline.build_atlas("region_test", source[0], workers=2, minimum_free_gib=0)


def test_overlap_threshold_value_retention_and_resume(region_source, monkeypatch):
    path = construct(region_source); manifest = validate_package(path)
    assert manifest.schema_version == "1.4" and manifest.representation == "mri-regions"
    assert all(s.kind == "independent-region" and s.probability.source_channel is None for s in manifest.structures)
    assert not any(v.kind == "labels" for v in manifest.volumes)
    assert manifest.validation["membership_statistics"] == {"voxels_with_multiple_memberships": 24, "maximum_memberships": 2, "sum_memberships": 72, "union_voxels": 48}
    for volume in manifest.volumes:
        expected = np.asanyarray(nib.load(region_source[1].input_paths[volume.id]).dataobj)
        actual = np.asanyarray(nib.load(path.parent / volume.file).dataobj)
        np.testing.assert_array_equal(actual, expected)
    from neuroimage import region_build
    monkeypatch.setattr(region_build, "read_volume", lambda *_a, **_k: pytest.fail("Complete package must reuse verified assets"))
    assert construct(region_source) == path


def test_missing_region_asset_repair_preserves_others(region_source):
    path = construct(region_source); manifest = validate_package(path)
    stamps = {a.path: (path.parent / a.path).stat().st_mtime_ns for a in manifest.assets}
    lost = manifest.structures[0].mesh_file; (path.parent / lost).unlink()
    assert construct(region_source) == path
    restored = validate_package(path)
    assert {a.path: a.sha256 for a in restored.assets} == {a.path: a.sha256 for a in manifest.assets}
    assert all((path.parent / a.path).stat().st_mtime_ns == stamps[a.path] for a in manifest.assets if a.path != lost)


@pytest.mark.parametrize("change", ["exclusive", "wrong_schema", "unbound_probability"])
def test_region_contract_rejects_ambiguous_representation(region_source, change):
    path = construct(region_source); value = json.loads(path.read_text())
    if change == "exclusive": value["structures"][0]["label_value"] = 1
    if change == "wrong_schema": value["schema_version"] = "1.2"
    if change == "unbound_probability": value["structures"][0]["probability"]["volume_id"] = "missing"
    with pytest.raises(ValueError): Manifest.model_validate(value)


def test_threshold_shift_and_false_overlap_are_rejected(region_source):
    path = construct(region_source); value = json.loads(path.read_text())
    value["structures"][0]["mask"]["threshold"] = .350001
    with pytest.raises(ValueError, match="inclusive probability threshold"):
        validate_geometry(Manifest.model_validate(value), path.parent)
    value = json.loads(path.read_text()); value["validation"]["membership_statistics"]["voxels_with_multiple_memberships"] = 0
    with pytest.raises(ValueError, match="overlap statistics"):
        validate_geometry(Manifest.model_validate(value), path.parent)


def test_source_grid_mismatch_does_not_register(region_source):
    path = region_source[1].input_paths["A_mask"]; image = nib.load(path)
    affine = image.affine.copy(); affine[0, 3] += .25
    changed = nib.Nifti1Image(np.asanyarray(image.dataobj), affine); changed.header.set_xyzt_units("mm"); nib.save(changed, path)
    with pytest.raises(ValueError, match="declared reference grid"): construct(region_source)


def test_percent_source_values_and_derived_masks_are_not_rescaled(region_source):
    root, imported = region_source
    recipe = imported.recipe
    recipe["probability_units"] = "percent"
    recipe["mask_rule"].update(threshold=35, origin="derived-from-probability", source="Generated display threshold; not a supplied mask")
    expected = {}
    for region in recipe["regions"]:
        ident = region["probability_input"]
        path = imported.input_paths[ident]
        image = nib.load(path)
        values = np.asanyarray(image.dataobj) * 100
        values[0, 0, 0] = 100
        expected[ident] = values
        changed = nib.Nifti1Image(values, image.affine)
        changed.header.set_xyzt_units("mm"); nib.save(changed, path)
        mask_id = region.pop("mask_input")
        del recipe["inputs"][mask_id]
        del imported.input_paths[mask_id]
    imported.structures = independent_catalog(recipe)
    path = construct(region_source)
    manifest = validate_package(path)
    assert manifest.schema_version == "1.5"
    assert manifest.build["parameters"]["probability_units"] == "percent"
    for structure in manifest.structures:
        assert structure.probability.units == "percent"
        assert structure.mask.origin == "derived-from-probability"
        assert structure.mask.source_input == structure.probability.source_input
        probability = next(v for v in manifest.volumes if v.id == structure.probability.volume_id)
        mask = next(v for v in manifest.volumes if v.id == structure.mask.volume_id)
        assert (probability.cal_min, probability.cal_max) == (0, 100)
        assert (mask.cal_min, mask.cal_max) == (0, 1)
        values = expected[structure.probability.source_input]
        np.testing.assert_array_equal(nib.load(path.parent / probability.file).get_fdata(), values)
        np.testing.assert_array_equal(nib.load(path.parent / mask.file).get_fdata(), values >= 35)
    assert construct(region_source) == path
    value = json.loads(path.read_text())
    value["schema_version"] = "1.4"
    with pytest.raises(ValueError, match="schema 1.5"): Manifest.model_validate(value)
    value = json.loads(path.read_text())
    value["structures"][0]["probability"]["units"] = "fraction"
    with pytest.raises(ValueError, match="threshold exceeds"): Manifest.model_validate(value)
    value = json.loads(path.read_text())
    value["structures"][0]["mask"]["source_input"] = "wrong-probability"
    with pytest.raises(ValueError, match="original probability input"): Manifest.model_validate(value)


def test_mask_origin_and_probability_units_must_be_explicitly_supported(region_source):
    recipe = region_source[1].recipe
    recipe["probability_units"] = "percent"
    recipe["mask_rule"]["threshold"] = 101
    with pytest.raises(ValueError, match="inclusive"): independent_catalog(recipe)
    recipe["mask_rule"].update(threshold=25, origin="derived-from-probability")
    with pytest.raises(ValueError, match="also claim"): independent_catalog(recipe)
    recipe["probability_units"] = "unknown"
    with pytest.raises(ValueError, match="supported probability units"): independent_catalog(recipe)


def test_region_teaching_and_review_keep_independent_semantics(region_source):
    from neuroimage.review import prepare_review, read_plan
    from neuroimage.teaching import prepare
    path = construct(region_source)
    packet = prepare_review(path, region_source[0], limit=2, minimum_free_gib=0)
    root = Path(packet)
    plan = read_plan(root)
    assert len(plan["cases"]) == 2
    comparison = json.loads((root / plan["cases"][0]["categorical_scene_file"]).read_text())
    assert comparison["state"]["overlay"] == "mask"
    assert comparison["state"]["pan"] == [0, 0, 0, 1]
    recipe = {"schema_version": "1.0", "id": "region-teaching", "dataset_id": "region_test", "required_source": {"id": "test", "version": "1"},
              "title": "Independent source fixture", "author": "Generated test", "objective": "Test source memberships", "review_status": "draft_not_expert_reviewed",
              "scenes": [{"id": "source-mask", "title": "Source mask", "selected": "region_test:region:A", "visible": ["region_test:region:A", "region_test:region:B"],
                          "background": "t2", "prompt": "Generated fixture", "note": "Not anatomy", "display": {"overlay": "mask", "slice_zoom": 4.0, "label_opacity": .18}}]}
    recipe_path = region_source[0] / "teaching.json"; recipe_path.write_text(json.dumps(recipe))
    result = prepare(path, recipe_path, region_source[0], minimum_free_gib=0)
    scene = json.loads(Path(result["notebook"]).read_text())["scenes"][0]["scene"]["state"]
    assert scene["overlay"] == "mask" and scene["pan"][3] == 4
    assert scene["labelOpacity"] == .18
    reference = nib.load(region_source[1].input_paths["t2"])
    center = nib.affines.apply_affine(reference.affine, (np.array(reference.shape) - 1) / 2)
    np.testing.assert_allclose((center - scene["pan"][:3]) / scene["pan"][3], scene["position"])
    step = recipe["scenes"][0]
    step["display"]["overlay"] = "probability"
    step["source_voxel"] = {"volume_id": "A_probability", "index": [2, 2, 4]}
    recipe_path.write_text(json.dumps(recipe))
    sampled = prepare(path, recipe_path, region_source[0], minimum_free_gib=0)
    state = json.loads(Path(sampled["notebook"]).read_text())["scenes"][0]["scene"]["state"]
    np.testing.assert_array_equal(state["position"], nib.affines.apply_affine(reference.affine, [2, 2, 4]))
    assert state["focus3D"] == state["position"] == state["annotations"][0]["position_ras_mm"]
    assert "recorded value 0.2" in state["note"]
    assert state["selectionEvidence"] == {"kind": "independent-mask", "candidates": []}
    step["source_voxel"] = {"volume_id": "A_mask", "index": [3, 4, 5]}
    recipe_path.write_text(json.dumps(recipe))
    sampled = prepare(path, recipe_path, region_source[0], minimum_free_gib=0)
    state = json.loads(Path(sampled["notebook"]).read_text())["scenes"][0]["scene"]["state"]
    assert state["selectionEvidence"] == {"kind": "independent-mask", "candidates": ["region_test:region:A", "region_test:region:B"]}
    step["visible"] = ["region_test:region:A"]
    recipe_path.write_text(json.dumps(recipe))
    sampled = prepare(path, recipe_path, region_source[0], minimum_free_gib=0)
    state = json.loads(Path(sampled["notebook"]).read_text())["scenes"][0]["scene"]["state"]
    assert state["selectionEvidence"] == {"kind": "independent-mask", "candidates": ["region_test:region:A"]}
    step["display"]["slice_zoom"] = 1.0
    recipe_path.write_text(json.dumps(recipe))
    sampled = prepare(path, recipe_path, region_source[0], minimum_free_gib=0)
    state = json.loads(Path(sampled["notebook"]).read_text())["scenes"][0]["scene"]["state"]
    assert state["pan"] == [0, 0, 0, 1]
    np.testing.assert_array_equal(state["position"], nib.affines.apply_affine(reference.affine, [3, 4, 5]))
    for anchor, message in [({"volume_id": "B_probability", "index": [2, 2, 4]}, "selected structure"),
                            ({"volume_id": "A_probability", "index": [-1, 2, 4]}, "outside"),
                            ({"volume_id": "A_probability", "index": [0, 0, 0]}, "positive recorded")]:
        step["source_voxel"] = anchor; recipe_path.write_text(json.dumps(recipe))
        with pytest.raises(ValueError, match=message): prepare(path, recipe_path, region_source[0], minimum_free_gib=0)
