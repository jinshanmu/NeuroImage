"""Retired sources cannot re-enter discovery or viewing through retained local files."""
import hashlib
import json
from pathlib import Path
import threading
import urllib.error
import urllib.request

import pytest

from neuroimage.adapters import load_recipe, recipe_names
from neuroimage.build import build_imported_atlas
from neuroimage.dataset_policy import (ExcludedDatasetError, dataset_exclusion_reason,
                                      dataset_is_excluded, require_supported_dataset)
from neuroimage.library import library_records, locate_content
from neuroimage.server import create_server
from neuroimage.structure_search import search_structures
from neuroimage.workspace import Workspace
from test_pipeline import source, build


EXCLUDED_CASES = [
    ("nextbrain_case1_block41", "nextbrain_core"),
    ("ixi_mra", "ixi_mra"),
    ("hba_native", "hba_native"),
    ("mesoveins", "mesoveins"),
    ("venat", "venat"),
    ("mouches_arteries", "mouches_tof"),
    ("inner_ear_ct_specimen1", "inner_ear_ct"),
    ("topcow2024", "topcow"),
    ("topbrain_v3", "topbrain"),
    ("tcia_cases", "ucsf_pdgm"),
    ("msd_brain_tumour", "msd_brain_tumour"),
]


@pytest.fixture(params=EXCLUDED_CASES, ids=[item[0] for item in EXCLUDED_CASES])
def excluded_identity(request):
    return request.param


def snapshot(root):
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.rglob("*") if path.is_file()}


def exclude_fixture(path, identity, *, source_alias=False):
    manifest = json.loads(path.read_text())
    if source_alias:
        manifest["sources"][0]["id"] = identity[1]
    else:
        manifest["dataset_id"] = manifest["package_id"] = identity[0]
    path.write_text(json.dumps(manifest))
    return manifest


def test_retained_recipe_metadata_is_not_available_for_acquisition_or_construction():
    definitions = sorted(Path("src/neuroimage/recipes").glob("*.json"))
    archived = [path for path in definitions if dataset_is_excluded(path.stem)]
    assert len(archived) == 17
    assert len([path for path in archived if path.stem.startswith("nextbrain")]) == 11
    assert "inner_ear_ct_specimen1" in {path.stem for path in archived}
    assert not any(name.startswith("nextbrain") for name in recipe_names())
    assert {name for name, _ in EXCLUDED_CASES}.isdisjoint(recipe_names())
    for path in archived:
        before = path.read_bytes()
        with pytest.raises(ExcludedDatasetError, match="may have been cleaned up"):
            load_recipe(path.stem)
        assert path.read_bytes() == before
    assert load_recipe("cerebra")["id"] == "cerebra"


@pytest.mark.parametrize("dataset", ["cerebra", "spl_nac", "mida", "hcp1065_prob", "suit_cerebellum",
                                    "z_anatomy", "mug500_healthy", "mug500_source_mesh", "synthetic"])
def test_exclusion_keeps_other_source_definitions_available(dataset):
    assert not dataset_is_excluded(dataset)
    if dataset != "synthetic":
        assert load_recipe(dataset)["id"] == dataset


@pytest.mark.parametrize("identity", [
    "ixi_mra-old-version", "hba_native-old-version", "mesoveins-old-version",
    "venat-old-version", "mouches_arteries-old-version", "mouches_tof",
    "inner_ear_ct_specimen1-8505a304d1cd522a", "inner_ear_ct", "inner-ear-ct-specimen2-v1",
    "topcow_2024-old-version", "TOPCOW2024-v1", "topcow2023",
    "topbrain_v3-old-version", "topbrain2025-annotations",
    "tcia_cases-old-version", "UCSF-PDGM-v1", "ucsf_pdgm_case001",
    "msd_brain_tumour-old-version", "msd_brain_tumor_case1",
])
def test_exclusion_covers_saved_package_versions_and_secondary_source_ids(identity):
    assert dataset_is_excluded(identity)


@pytest.mark.parametrize("identity", [
    "tcia_normal_volunteer", "tcia", "mri", "eye", "ear", "cranial_nerves",
    "spl_nac", "mida", "z_anatomy", "mug500_healthy", "mug500_source_mesh",
    "topcowshed", "topbrainstorm", "inner_ear_ctography",
])
def test_source_boundaries_do_not_exclude_generic_modalities_or_other_anatomy(identity):
    assert not dataset_is_excluded(identity)


def test_exclusion_notice_preserves_records_without_promising_local_source_files():
    with pytest.raises(ExcludedDatasetError) as error:
        require_supported_dataset("inner_ear_ct_specimen1")
    message = str(error.value)
    assert "Human Inner Ear CT" in message
    assert "Specialist ear anatomy is deferred" in message
    assert "Source definitions, exclusion records and saved scenes are retained" in message
    assert "local data and built packages may have been cleaned up" in message
    assert "original data, built packages and saved scenes are retained" not in message


@pytest.mark.parametrize("identity,meaning", [
    ("nextbrain_case1_block41", "selected local tissue blocks"),
    ("ixi_mra", "no anatomical segmentation labels"),
    ("hba_native", "no anatomical segmentation labels"),
    ("mesoveins", "no anatomical segmentation labels"),
    ("venat", "statistical fields"),
    ("mouches_arteries", "named arterial branch segmentations"),
    ("inner_ear_ct_specimen1", "ear anatomy is deferred"),
    ("topcow2024", "clinical patient cohort"),
    ("topbrain2025", "clinical TopCoW cohort"),
    ("tcia_cases", "histopathologically confirmed diffuse gliomas"),
    ("msd_brain_tumour", "glioma, tumour and oedema"),
])
def test_excluded_identity_and_source_alias_explain_the_recorded_scope_reason(identity, meaning):
    reason = dataset_exclusion_reason(identity)
    assert meaning in reason
    assert dataset_exclusion_reason("historical_alias", [identity]) == reason
    with pytest.raises(ExcludedDatasetError) as error:
        require_supported_dataset("historical_alias", [identity])
    assert reason in str(error.value)
    assert dataset_exclusion_reason("spl_nac") is None


@pytest.mark.parametrize("source_alias", [False, True])
def test_imported_recipe_cannot_bypass_exclusion_or_touch_sources(source, excluded_identity, source_alias, monkeypatch):
    root, imported = source
    if source_alias:
        imported.recipe["sources"][0]["id"] = excluded_identity[1]
    else:
        imported.recipe["id"] = excluded_identity[0]
    original = snapshot(root)
    monkeypatch.setattr("neuroimage.build.fingerprint", lambda *args: pytest.fail("An excluded source must not start a build"))
    with pytest.raises(ExcludedDatasetError):
        build_imported_atlas(imported, root, workers=1, minimum_free_gib=0)
    assert snapshot(root) == original


@pytest.mark.parametrize("source_alias", [False, True])
def test_retained_packages_are_absent_from_library_search_and_serving(source, excluded_identity, source_alias, monkeypatch):
    root, _ = source
    path = build(source)
    exclude_fixture(path, excluded_identity, source_alias=source_alias)
    original = snapshot(root)
    assert library_records(root) == []
    assert search_structures(root, "caudate")["total"] == 0
    web = root / "fixture-web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><title>Exclusion test</title>")
    monkeypatch.setattr("neuroimage.server.validate_package", lambda *args, **kwargs: pytest.fail("Do not load excluded package assets"))
    with pytest.raises(ExcludedDatasetError):
        create_server([path], web, 0)
    assert {key: value for key, value in snapshot(root).items() if not key.startswith("fixture-web/")} == original


def test_saved_excluded_scene_is_preserved_and_explains_exclusion(source, excluded_identity):
    root, _ = source
    path = build(source)
    manifest = exclude_fixture(path, excluded_identity)
    scene = {"kind": "neuroimage-scene", "schema_version": "1.0",
             "package_id": manifest["package_id"], "package_version": manifest["package_version"],
             "build_signature": manifest["build"]["signature"], "space_id": manifest["space"]["id"]}
    content = root / "preserved-scene.json"
    content.write_text(json.dumps(scene))
    original = snapshot(root)
    with pytest.raises(ExcludedDatasetError, match="saved scenes are retained"):
        locate_content(content, root)
    assert snapshot(root) == original


def test_damaged_retired_package_in_alias_directory_is_excluded_before_asset_checks(source, excluded_identity, monkeypatch):
    root, _ = source
    path = build(source)
    manifest = exclude_fixture(path, excluded_identity, source_alias=True)
    (path.parent / manifest["assets"][0]["path"]).write_bytes(b"damaged retained fixture")
    original = snapshot(root)
    monkeypatch.setattr("neuroimage.library.validate_package", lambda *args, **kwargs: pytest.fail("Excluded assets must not be inspected"))
    assert library_records(root) == []
    assert snapshot(root) == original


def test_retired_package_cannot_create_a_new_review_packet(source, excluded_identity, monkeypatch):
    from neuroimage.review import prepare_review
    root, _ = source
    path = build(source)
    exclude_fixture(path, excluded_identity)
    original = snapshot(root)
    monkeypatch.setattr("neuroimage.review.validate_package", lambda *args, **kwargs: pytest.fail("Do not inspect excluded package assets"))
    with pytest.raises(ExcludedDatasetError):
        prepare_review(path, root, minimum_free_gib=0)
    assert snapshot(root) == original


def test_workspace_and_bookmark_api_reject_retained_excluded_versions(source, excluded_identity):
    root, _ = source
    path = build(source)
    manifest = exclude_fixture(path, excluded_identity)
    original = snapshot(root)
    state = root.with_name(root.name + "-state")
    manager = Workspace(root, state, data_floor_gib=0, state_floor_gib=0)
    web = state / "fixture-web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><title>Exclusion test</title>")
    server = create_server([], web, 0, workspace=manager)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    key = manifest["package_id"] + "-" + manifest["package_version"]
    try:
        assert manager.package_records(refresh=True) == []
        assert manager.browse(refresh=True)["packages"] == []
        assert {name for name, _ in EXCLUDED_CASES}.isdisjoint(source["id"] for source in manager.catalog()["sources"])
        for action in ("acquire", "build", "activate"):
            request = {"action": action, **({"package_key": key} if action == "activate" else {"recipe": manifest["dataset_id"]})}
            with pytest.raises(ExcludedDatasetError):
                manager.start(request)
        with urllib.request.urlopen(url + "/api/atlases") as response:
            assert json.load(response)["atlases"] == []
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(url + "/api/workspace/atlases/" + key)
        assert error.value.code == 400
        result = json.load(error.value)
        assert result["code"] == "dataset_excluded" and "retained" in result["error"]
        assert manager.jobs == {}
        assert snapshot(root) == original
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        manager.close()
