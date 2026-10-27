"""Shared recipe templates stay current without sharing caller-owned mutable values."""
import json
import os
from pathlib import Path

import pytest

from neuroimage import adapters, mug_cases, thu_cases
from neuroimage.recipe_metadata import _read_json, recipe_metadata


def test_template_cache_reuses_parsing_and_returns_independent_nested_values(tmp_path, monkeypatch):
    path = tmp_path / "template.json"
    path.write_text('{"nested":{"members":[{"sha256":"original"}]}}')
    read = Path.read_text
    calls = []
    def spy(self, *args, **kwargs):
        if self == path:
            calls.append(self)
        return read(self, *args, **kwargs)
    monkeypatch.setattr(Path, "read_text", spy)
    first = recipe_metadata(path)
    first["nested"]["members"][0]["sha256"] = "changed"
    assert recipe_metadata(path)["nested"]["members"][0]["sha256"] == "original"
    assert calls == [path]


def test_same_size_and_mtime_replacement_and_deletion_invalidate_metadata(tmp_path):
    path = tmp_path / "template.json"
    path.write_text('{"value":"first"}')
    original = path.stat()
    assert recipe_metadata(path) == {"value": "first"}
    replacement = tmp_path / "replacement.json"
    replacement.write_text('{"value":"other"}')
    os.utime(replacement, ns=(original.st_atime_ns, original.st_mtime_ns))
    replacement.replace(path)
    assert path.stat().st_size == original.st_size and path.stat().st_mtime_ns == original.st_mtime_ns
    assert recipe_metadata(path) == {"value": "other"}
    path.unlink()
    with pytest.raises(FileNotFoundError):
        recipe_metadata(path)


def test_source_metadata_changed_during_read_is_not_cached(tmp_path, monkeypatch):
    path = tmp_path / "changing.json"
    path.write_text('{"value":"first"}')
    read = Path.read_text
    def changing(self, *args, **kwargs):
        value = read(self, *args, **kwargs)
        if self == path:
            path.write_text('{"value":"later-value"}')
        return value
    with monkeypatch.context() as patch:
        patch.setattr(Path, "read_text", changing)
        with pytest.raises(ValueError, match="changed while being read"):
            recipe_metadata(path)
    assert recipe_metadata(path) == {"value": "later-value"}


def test_valid_static_and_virtual_lookup_does_not_rebuild_the_whole_registry(monkeypatch):
    monkeypatch.setattr(adapters, "recipe_names", lambda: pytest.fail("Known recipe lookup must not enumerate the cohort"))
    assert adapters.load_recipe("cerebra")["id"] == "cerebra"
    assert adapters.load_recipe("thu_mra_case015")["id"] == "thu_mra_case015"
    names = mug_cases.mug_recipe_names()
    if names:
        assert adapters.load_recipe(names[0])["id"] == names[0]


@pytest.mark.parametrize("name", ["../cerebra", "cerebra/../../x", "cerebra\\x", "cerebra.json", "", None])
def test_recipe_lookup_rejects_unsafe_or_non_basename_names(name):
    with pytest.raises(ValueError, match="safe installed"):
        adapters.load_recipe(name)


def test_thu_shared_templates_and_segments_are_parsed_once(monkeypatch):
    _read_json.cache_clear()
    read = Path.read_text
    calls = []
    def spy(self, *args, **kwargs):
        calls.append(self.name)
        return read(self, *args, **kwargs)
    monkeypatch.setattr(Path, "read_text", spy)
    first = thu_cases.thu_recipe("thu_mra_case002")
    first["selection"][0]["color"][0] = -1
    assert thu_cases.thu_recipe("thu_mra_case003")["selection"][0]["color"][0] != -1
    assert calls.count("thu_mra_case001.json") == 1
    assert calls.count("thu-cerebral-mra-segments.json") == 1
    assert calls.count("thu-cerebral-mra-cases.json") == 1


def test_mug_inventory_external_replacement_updates_source_members(tmp_path, monkeypatch):
    inventory = json.loads(json.dumps(mug_cases.case_inventory()))
    if not inventory:
        pytest.skip("No verified healthy inventory")
    case, entry = next((key, value) for key, value in inventory.items() if key != "A0101")
    path = tmp_path / "inventory.json"
    path.write_text(json.dumps({"cases": {case: entry}}))
    monkeypatch.setattr(mug_cases, "_CATALOG", path)
    name = "mug500_healthy_" + case.lower()
    before = mug_cases.mug_recipe(name)
    entry["labels"]["sha256"] = "f" * 64
    replacement = tmp_path / "new.json"
    replacement.write_text(json.dumps({"cases": {case: entry}}))
    replacement.replace(path)
    assert mug_cases.mug_recipe(name)["archives"][0]["members"][0]["sha256"] == "f" * 64
    assert before["archives"][0]["members"][0]["sha256"] != "f" * 64
    path.unlink()
    assert mug_cases.mug_recipe(name) is None
