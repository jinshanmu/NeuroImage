"""The ten-case family limit applies to discovery, operations and historical URLs."""
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace
import threading
import urllib.error
import urllib.request

import pytest

from neuroimage import case_selection, server as serving, workspace as workspace_module
from neuroimage.acquire import acquire
from neuroimage.adapters import load_recipe, recipe_names
from neuroimage.build import build_atlas, build_imported_atlas
from neuroimage.coverage import source_coverage, source_details
from neuroimage.dataset_policy import ExcludedDatasetError, dataset_is_excluded, require_supported_dataset
from neuroimage.library import library_records, locate_binding
from neuroimage.recipe_metadata import _metadata_json
from neuroimage.thu_cases import thu_recipe
from neuroimage.mug_cases import mug_recipe
from test_pipeline import source, build
from test_workspace import workspace


THU = {"001", "006", "007", "009", "010", "014", "015", "019", "021", "030"}
MUG = {f"A{number:04d}" for number in [31, 32, 33, 34, 35, 101, 102, 103, 104, 105]}


def _selection():
    return deepcopy(_metadata_json(case_selection._SELECTION))


def _inventories():
    return {family: _metadata_json(path) for family, path in case_selection._INVENTORIES.items()}


def test_current_case_limit_counts_independent_cases_and_keeps_native_representations():
    assert case_selection.selected_cases("thu_mra") == THU
    assert case_selection.selected_cases("mug500") == MUG
    names = recipe_names()
    cases = {family: set() for family in ["thu_mra", "mug500"]}
    for name in names:
        identity = case_selection.case_identity(name)
        if identity:
            cases[identity[0]].add(identity[1])
    assert cases == {"thu_mra": THU, "mug500": MUG}
    assert len([name for name in names if name.startswith("thu_mra_case")]) == 10
    assert len([name for name in names if name.startswith("mug500_")]) == 20
    assert all(name in names for name in ["spl_nac", "spl_nac_sulci", "brainstem_navigator_iit",
                                          "mida", "z_anatomy"])
    assert not {"spl_nac_complete", "mida_complete", "z_anatomy_complete"} & set(names)
    assert case_selection.case_identity("mug500_source_mesh_a0031-old-version") == ("mug500", "A0031")
    assert case_selection.case_identity("mug500_healthy-historical-version") == ("mug500", "A0101")
    for case in ["015", "019"]:
        recipe = load_recipe("thu_mra_case" + case)
        assert recipe["source_case"]["present_values"] == list(range(1, 21))
        assert recipe["source_case"]["landmarks_outside_image"] == []


@pytest.mark.parametrize("change", ["more_than_ten", "duplicate", "unknown", "bad_format", "raised_limit"])
def test_selection_rejects_invalid_or_unknown_source_ids(change):
    selection = _selection()
    cases = selection["families"]["thu_mra"]["case_ids"]
    if change == "more_than_ten":
        cases.append("002")
    elif change == "duplicate":
        cases[-1] = cases[0]
    elif change == "unknown":
        cases[-1] = "110"
    elif change == "bad_format":
        cases[-1] = "1"
    else:
        selection["maximum_cases_per_family"] = 11
    with pytest.raises(ValueError):
        case_selection._validate_selection(selection, _inventories())


@pytest.mark.parametrize("identity", ["thu_mra_case002", "thu_mra_case109-old-version",
                                     "mug500_healthy_a0001", "mug500_source_mesh_a0030-old-version"])
def test_unselected_cases_are_blocked_before_sources_or_jobs_are_touched(tmp_path, identity, workspace):
    assert dataset_is_excluded(identity)
    with pytest.raises(ExcludedDatasetError, match="temporarily not included"):
        require_supported_dataset("legacy-alias", iter([identity]))
    if "-old-version" not in identity:
        with pytest.raises(ExcludedDatasetError, match="temporarily not included"):
            load_recipe(identity)
        with pytest.raises(ExcludedDatasetError):
            acquire(identity, tmp_path, minimum_free_gib=0)
        with pytest.raises(ExcludedDatasetError):
            build_atlas(identity, tmp_path, minimum_free_gib=0)
        with pytest.raises(ExcludedDatasetError):
            workspace.start({"action": "build", "recipe": identity})
        assert workspace.jobs == {}
    assert source_coverage(identity) == [] and source_details(identity) == []
    with pytest.raises(ExcludedDatasetError):
        locate_binding({"package_id": identity}, [])


def test_archived_factories_keep_source_definitions_without_enabling_them():
    assert thu_recipe("thu_mra_case002")["id"] == "thu_mra_case002"
    assert mug_recipe("mug500_healthy_a0001")["id"] == "mug500_healthy_a0001"
    assert "thu_mra_case002" not in recipe_names()
    assert "mug500_healthy_a0001" not in recipe_names()


def test_imported_recipe_and_retained_package_cannot_bypass_case_policy(source, tmp_path):
    path = build(source)
    manifest = json.loads(path.read_text())
    manifest["dataset_id"] = manifest["package_id"] = "thu_mra_case002"
    path.write_text(json.dumps(manifest))
    assert library_records(source[0]) == []
    source[1].recipe["id"] = "mug500_healthy_a0001"
    with pytest.raises(ExcludedDatasetError):
        build_imported_atlas(source[1], source[0], minimum_free_gib=0)
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><title>Fixture</title>")
    with pytest.raises(ExcludedDatasetError):
        serving.create_server([path], web, 0)


def test_policy_change_invalidates_browse_cache_and_blocks_registered_old_urls(source, tmp_path, monkeypatch, workspace):
    policy = tmp_path / "case-selection.json"
    selection = _selection()
    policy.write_text(json.dumps(selection))
    monkeypatch.setattr(case_selection, "_SELECTION", policy)
    monkeypatch.setattr(workspace, "package_records", lambda **kwargs: [])
    monkeypatch.setattr(workspace_module, "destination", lambda *args: SimpleNamespace(is_file=lambda: False))
    assert "thu_mra_case001" in {item["id"] for item in workspace.browse()["sources"]}
    path = build(source)
    manifest = json.loads(path.read_text())
    manifest["dataset_id"] = "thu_mra_case001"
    manifest["package_id"] = "legacy-case-alias"
    path.write_text(json.dumps(manifest))
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><title>Fixture</title>")
    controller = SimpleNamespace(state_root=tmp_path / "controller", state_floor_gib=0)
    http = serving.create_server([path], web, 0, workspace=controller)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{http.server_port}"
    key = manifest["package_id"] + "-" + manifest["package_version"]
    try:
        with urllib.request.urlopen(base + "/api/atlases") as response:
            assert len(json.load(response)["atlases"]) == 1
        selection["families"]["thu_mra"]["case_ids"].remove("001")
        selection["families"]["thu_mra"]["case_ids"].append("002")
        replacement = tmp_path / "policy-update.json"
        replacement.write_text(json.dumps(selection))
        replacement.replace(policy)
        names = {item["id"] for item in workspace.browse()["sources"]}
        assert "thu_mra_case001" not in names and "thu_mra_case002" in names
        with urllib.request.urlopen(base + "/api/atlases") as response:
            assert json.load(response)["atlases"] == []
        for endpoint in [f"/atlas/{key}/manifest.json", f"/atlas/{key}/_render.json",
                         f"/api/workspace/atlases/{key}"]:
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base + endpoint)
            assert error.value.code == 400
            assert "temporarily not included" in json.load(error.value)["error"]
        with pytest.raises(ExcludedDatasetError):
            controller.register_package(path)
    finally:
        http.shutdown()
        http.server_close()
        thread.join()
