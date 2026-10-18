"""Keep prepared model notebooks bound to native source geometry and versions."""
import copy
import json
from pathlib import Path

import pytest

from neuroimage import build as pipeline
from neuroimage.adapters import ImportedDataset, load_recipe
from neuroimage.library import locate_content
from neuroimage.model_build import model_catalog
from neuroimage.teaching import curriculum_matches, parse_teaching_recipe, prepare
from test_stl_geometry import fixture as write_stl


@pytest.fixture
def model_source(tmp_path, monkeypatch):
    recipe = load_recipe("mug500_source_mesh")
    recipe.update(id="synthetic-model", title="Synthetic source model", source_version="synthetic-1",
                  sources=[{**recipe["sources"][0], "id": "synthetic-model", "version": "synthetic-1",
                            "citation": "Generated test geometry", "license_name": "CC0"}],
                  inputs={"stl": "source.stl", "license": "license.txt"}, teaching_sequences=[])
    recipe["space"].update(id="synthetic-xyz", name="Synthetic native XYZ", reference="Generated test geometry")
    recipe["objects"][0].update(id="synthetic-model:object:one", source_name="source.stl", name="Synthetic object")
    write_stl(tmp_path / "source.stl")
    (tmp_path / "license.txt").write_text("Generated test geometry. CC0.\n")
    imported = ImportedDataset(recipe, {key: tmp_path / value for key, value in recipe["inputs"].items()}, model_catalog(recipe))
    monkeypatch.setattr(pipeline, "import_dataset", lambda *args: imported)
    path = pipeline.build_atlas(recipe["id"], tmp_path, workers=1, minimum_free_gib=0)
    value = json.loads(Path("src/neuroimage/curricula/mug500-source-skull-context.json").read_text())
    value.update(dataset_id=recipe["id"], required_source={"id": recipe["id"], "version": "synthetic-1"})
    for step in value["scenes"]:
        step.update(selected="synthetic-model:object:one", visible=["synthetic-model:object:one"])
        if "surface_cutaway" in step["display"]:
            step["display"]["surface_cutaway"]["structures"] = step["visible"]
    return tmp_path, path, value


def test_model_preparation_preserves_targets_attribution_and_noop_recovery(model_source):
    root, path, recipe = model_source
    recipe_path = root / "teaching.json"
    recipe_path.write_text(json.dumps(recipe))
    result = prepare(path, recipe_path, root, minimum_free_gib=0)
    notebook_path = Path(result["notebook"])
    original = notebook_path.read_bytes()
    book = json.loads(original)
    manifest = json.loads(path.read_text())
    assert curriculum_matches(recipe, manifest)
    for entry in book["scenes"]:
        scene = entry["scene"]
        assert scene["state"]["coordinate_system"] == "SOURCE_XYZ"
        assert scene["state"]["position_native_mm"] == manifest["structures"][0]["target_native_mm"]
        assert not {"position", "position_ras_mm", "background", "radiological"} & scene["state"].keys()
        assert scene["provenance"]["sources"] == manifest["sources"]
        assert scene["provenance"]["anatomical_review"] == "not_performed"
    assert book["scenes"][1]["scene"]["state"]["surfaceCutaway"]["axis"] == 2
    assert locate_content(notebook_path, root)["manifest"] == str(path)
    assert prepare(path, recipe_path, root, minimum_free_gib=0)["status"] == "reused"
    assert notebook_path.read_bytes() == original
    changed = json.loads(original)
    changed["scenes"][1]["scene"]["space_id"] = "invented-ras"
    notebook_path.write_text(json.dumps(changed))
    with pytest.raises(ValueError, match="atlas version or native space"):
        locate_content(notebook_path, root)
    with pytest.raises(ValueError, match="prepared content changed"):
        prepare(path, recipe_path, root, minimum_free_gib=0)


def test_model_curriculum_rejects_missing_targets_and_invented_image_fields(model_source):
    root, path, recipe = model_source
    manifest = json.loads(path.read_text())
    for change in ({"selected": "unknown"}, {"visible": ["unknown"]}, {"background": "invented-mri"},
                   {"display": {"camera": [0, 0, 100]}}, {"display": {"surface_opacity": {"unknown": 0.2}}}):
        bad = copy.deepcopy(recipe)
        bad["scenes"][0].update(change)
        assert not curriculum_matches(bad, manifest)
        recipe_path = root / "bad.json"
        recipe_path.write_text(json.dumps(bad))
        with pytest.raises(ValueError):
            prepare(path, recipe_path, root, minimum_free_gib=0)
    assert not curriculum_matches(recipe, {**manifest, "representation": "mri-labels"})


def test_all_installed_teaching_recipes_use_the_shared_parser():
    for path in Path("src/neuroimage/curricula").glob("*.json"):
        parse_teaching_recipe(path.read_text())
