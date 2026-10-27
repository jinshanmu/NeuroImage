"""The integrated setup preserves source access and storage requirements."""
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from neuroimage.setup import manual_requirements, quickstart, storage_settings


def test_manual_download_plan_is_read_only_and_describes_exact_destination(tmp_path):
    data, state = tmp_path / "data", tmp_path / "state"
    data.mkdir(); state.mkdir()
    plan = quickstart("mida", data, state, dry_run=True)
    required = plan["manual_downloads"]
    assert len(required) == 1
    assert required[0]["access_url"].startswith("https://doi.org/")
    assert Path(required[0]["save_as"]).is_relative_to(data)
    assert len(required[0]["sha256"]) == 64
    assert not list(data.iterdir()) and not list(state.iterdir())
    assert manual_requirements("cerebra", data) == []


def test_quickstart_rejects_nested_or_symbolic_storage_before_work(tmp_path):
    data = tmp_path / "data"; data.mkdir()
    state = data / "state"; state.mkdir()
    with pytest.raises(ValueError, match="separate physical"):
        quickstart("cerebra", data, state, dry_run=True)
    link = tmp_path / "alias"; link.symlink_to(data, target_is_directory=True)
    separate = tmp_path / "state"; separate.mkdir()
    with pytest.raises(ValueError, match="separate physical"):
        quickstart("cerebra", link, separate, dry_run=True)


@pytest.mark.parametrize("dry_run", [True, False])
@pytest.mark.parametrize("recipe", ["nextbrain_case1_block05", "nextbrain_case2_block07",
                                   "ixi_mra", "hba_native", "mesoveins", "venat", "mouches_arteries"])
def test_quickstart_rejects_excluded_sources_without_touching_existing_data(
        tmp_path, monkeypatch, recipe, dry_run):
    data, state = tmp_path / "data", tmp_path / "state"
    data.mkdir(); state.mkdir()
    original = data / "preserved-source-original.bin"
    original.write_bytes(b"Preserved original source bytes")
    events = []
    monkeypatch.setattr("neuroimage.setup.acquire", lambda *args, **kwargs: events.append("acquire"))
    monkeypatch.setattr("neuroimage.setup.build_atlas", lambda *args, **kwargs: events.append("build"))
    with pytest.raises(ValueError, match="excluded"):
        quickstart(recipe, data, state, dry_run=dry_run)
    assert events == []
    assert original.read_bytes() == b"Preserved original source bytes"
    assert sorted(data.iterdir()) == [original]
    assert not list(state.iterdir())


def test_quickstart_uses_shared_acquisition_construction_and_validation(tmp_path, monkeypatch):
    data, state = tmp_path / "data", tmp_path / "state"
    data.mkdir(); state.mkdir()
    policy = tmp_path / "policy.json"
    policy.write_text(json.dumps({"hdd_minimum_free_gib": 0, "ssd_minimum_free_gib": 0}))
    events = []
    manifest = data / "manifest.json"
    monkeypatch.setattr("neuroimage.setup.installation_report", lambda **kwargs: {"ready": True})
    monkeypatch.setattr("neuroimage.setup.acquire", lambda *args, **kwargs: events.append(("acquire", kwargs)))
    monkeypatch.setattr("neuroimage.setup.build_atlas", lambda *args, **kwargs: events.append(("build", kwargs)) or manifest)
    monkeypatch.setattr("neuroimage.validation.validate_package", lambda *args, **kwargs: events.append(("validate", kwargs)) or SimpleNamespace(dataset_id="cerebra", package_version="exact-version", structures=[1]))
    result = quickstart("cerebra", data, state, storage_policy=policy, workers=2)
    assert [event[0] for event in events] == ["acquire", "build", "validate"]
    assert events[0][1]["minimum_free_gib"] == 0
    assert events[1][1]["workers"] == 2
    assert result["manifest"] == str(manifest) and result["status"] == "ready"
    events.clear()
    with pytest.raises(ValueError, match="manual source download"):
        quickstart("mida", data, state, storage_policy=policy)
    assert events == []


@pytest.mark.parametrize("value", [-1, True, "0", float("inf"), float("nan")])
def test_storage_policy_rejects_invalid_reserves(tmp_path, value):
    path = tmp_path / "policy.json"; path.write_text(json.dumps({"hdd_minimum_free_gib": value}))
    with pytest.raises(ValueError, match="finite, nonnegative"):
        storage_settings(path)
