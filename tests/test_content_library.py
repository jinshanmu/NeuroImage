"""Exercise exact-source teaching discovery, explicit import and recovery."""
import copy
import json
from pathlib import Path

import pytest

from neuroimage.content_library import import_teaching, open_teaching, teaching_records
from neuroimage.teaching import prepare
from test_model_teaching import model_source


def test_model_scene_identity_survives_library_import_and_changes(model_source):
    root, manifest, recipe = model_source
    recipe_path = root / "recipe.json"
    recipe_path.write_text(json.dumps(recipe))
    prepared = Path(prepare(manifest, recipe_path, root, minimum_free_gib=0)["notebook"])
    book = json.loads(prepared.read_text())
    initial = teaching_records(root)
    assert len(initial["records"]) == 1
    record = initial["records"][0]
    assert record["status"] == "ready" and record["representation"] == "surface-model"
    assert record["views"] == 2
    registered = []
    def register(path):
        registered.append(path)
        return "exact-package"
    opened = open_teaching(root, record["key"], register)
    assert opened["content"] == book and registered == [str(manifest)]
    edited = copy.deepcopy(book)
    edited["title"] = "My teaching copy"
    imported = import_teaching(edited, root, minimum_free_gib=0)
    assert imported["status"] == "imported"
    assert import_teaching(edited, root, minimum_free_gib=0)["status"] == "reused"
    assert json.loads(prepared.read_text()) == book
    assert len(teaching_records(root)["records"]) == 2
    assert teaching_records(root, query="MY TEACHING")["records"][0]["key"] == imported["key"]
    # A scene is a first-class file in the same library, with identical binding checks.
    scene = import_teaching(book["scenes"][0]["scene"], root, minimum_free_gib=0)
    assert open_teaching(root, scene["key"], register)["content"]["state"]["coordinate_system"] == "SOURCE_XYZ"
    changed = root / imported["relative_path"]
    edited["title"] = "Intentionally edited on disk"
    changed.write_text(json.dumps(edited))
    with pytest.raises(ValueError, match="Refresh the teaching library"):
        open_teaching(root, imported["key"], register)
    assert any(r["title"] == edited["title"] for r in teaching_records(root)["records"])


def test_missing_historical_package_and_foreign_nested_binding_are_explicit(model_source):
    root, manifest, recipe = model_source
    recipe_path = root / "recipe.json"
    recipe_path.write_text(json.dumps(recipe))
    book = json.loads(Path(prepare(manifest, recipe_path, root, minimum_free_gib=0)["notebook"]).read_text())
    bad = copy.deepcopy(book)
    bad["scenes"][0]["scene"]["package_version"] = "foreign-version"
    with pytest.raises(ValueError, match="atlas version or native space"):
        import_teaching(bad, root, minimum_free_gib=0)
    missing = copy.deepcopy(book)
    missing["package_version"] = "historical-version"
    for entry in missing["scenes"]:
        entry["scene"]["package_version"] = "historical-version"
    with pytest.raises(ValueError, match="Matching package"):
        import_teaching(missing, root, minimum_free_gib=0)
    manifest.rename(manifest.with_name("retained-manifest.json"))
    record = teaching_records(root)["records"][0]
    assert record["status"] == "source_required"
    with pytest.raises(ValueError, match="Matching package"):
        open_teaching(root, record["key"], lambda _: pytest.fail("A different source must not be opened"))


def test_discovery_ignores_unrelated_or_escaping_files(model_source):
    root, _, _ = model_source
    outside = root.parent / "outside-teaching"
    outside.mkdir()
    (outside / "content.json").write_text('{"kind":"neuroimage-teaching-notebook"}')
    link = root / "exports/synthetic-model/teaching/outside"
    link.parent.mkdir(parents=True)
    link.symlink_to(outside, target_is_directory=True)
    unrelated = root / "exports/synthetic-model/other.json"
    unrelated.write_text('{"kind":"unrelated"}')
    assert teaching_records(root)["records"] == []
