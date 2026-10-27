"""Large-cohort metadata discovery retains filesystem checks without repeated schema work."""
import json
from pathlib import Path

import pytest

from neuroimage import library
from neuroimage.contracts import Manifest
from test_pipeline import source, build
from test_workspace import workspace


def test_library_validates_each_manifest_schema_once_and_keeps_asset_checks(source, monkeypatch):
    manifest_path = build(source)
    original = Manifest.model_validate_json
    calls = []
    def counted(cls, data, *args, **kwargs):
        calls.append(data)
        return original(data, *args, **kwargs)
    monkeypatch.setattr(Manifest, "model_validate_json", classmethod(counted))
    records = library.library_records(source[0])
    assert len(records) == len(calls) == 1 and records[0]["status"] == "available"
    manifest = json.loads(manifest_path.read_text())
    (manifest_path.parent / manifest["assets"][0]["path"]).unlink()
    assert library.library_records(source[0])[0]["status"] == "unavailable"


def test_library_preserves_symlink_rejection_and_targeted_dataset_discovery(source, monkeypatch):
    manifest_path = build(source)
    alias = manifest_path.parent.with_name("symlink-package")
    alias.symlink_to(manifest_path.parent, target_is_directory=True)
    records = library.library_records(source[0])
    assert next(record for record in records if record["folder_version"] == alias.name)["status"] == "unavailable"
    unrelated = source[0] / "derivatives/unrelated"
    unrelated.mkdir()
    scandir = library.os.scandir
    def guarded(path):
        assert Path(path) != unrelated
        return scandir(path)
    monkeypatch.setattr(library.os, "scandir", guarded)
    assert library.library_records(source[0], dataset="synthetic")


def test_excluded_source_is_filtered_before_validation(source, monkeypatch):
    path = build(source)
    manifest = json.loads(path.read_text())
    manifest["dataset_id"] = manifest["package_id"] = "nextbrain_case1_block05"
    path.write_text(json.dumps(manifest))
    monkeypatch.setattr(library, "validate_package", lambda *args, **kwargs: pytest.fail("Excluded sources must not be inspected"))
    assert library.library_records(source[0]) == []


def test_browse_checks_shared_inputs_once_per_refresh_and_rechecks_deleted_files(workspace, monkeypatch):
    from neuroimage import workspace as module
    recipes = {name: {"id": name, "title": name, "sources": [],
                      "inputs": {"license": "shared.txt", "labels": name + ".dat"}}
               for name in ["one", "two"]}
    (workspace.data_root / "shared.txt").write_text("license")
    (workspace.data_root / "one.dat").write_text("labels")
    calls = []
    def destination(root, relative):
        calls.append(relative)
        return root / relative
    monkeypatch.setattr(module, "recipe_names", lambda: list(recipes))
    monkeypatch.setattr(module, "load_recipe", recipes.__getitem__)
    monkeypatch.setattr(module, "dataset_info", lambda _: {})
    monkeypatch.setattr(module, "destination", destination)
    monkeypatch.setattr(workspace, "package_records", lambda **kwargs: [])
    first = workspace.browse(refresh=True)
    assert [record["inputs_present"] for record in first["sources"]] == [2, 1]
    assert sorted(calls) == ["one.dat", "shared.txt", "two.dat"]
    calls.clear()
    (workspace.data_root / "shared.txt").unlink()
    fresh = workspace.browse(refresh=True)
    assert [record["inputs_present"] for record in fresh["sources"]] == [1, 0]
    assert sorted(calls) == ["one.dat", "shared.txt", "two.dat"]
