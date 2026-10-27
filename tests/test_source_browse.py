"""Retire duplicate discovery entries without retiring immutable package access."""
import json
import threading
import urllib.request

from neuroimage.adapters import load_recipe, recipe_names
from neuroimage.browse_policy import source_is_browsable
from neuroimage.dataset_policy import require_supported_dataset
from neuroimage.library import library_records, locate_binding
from neuroimage.server import create_server
from neuroimage.workspace import Workspace, package_key
from test_pipeline import source, build


def test_only_parallel_complete_recipes_are_hidden_from_enabled_discovery():
    names = set(recipe_names())
    for retired in ("mida_complete", "z_anatomy_complete", "spl_nac_complete"):
        assert retired not in names
        assert not source_is_browsable(retired)
        assert load_recipe(retired)["id"] == retired  # Explicit historical definitions remain readable.
        require_supported_dataset(retired)
    for current in ("mida", "z_anatomy", "spl_nac", "spl_nac_sulci",
                    "brainstem_navigator_mni", "brainstem_navigator_iit",
                    "hcp1065_tracts", "hcp1065_prob", "bigbrain_layers", "bigbrain_hippocampus",
                    "mug500_healthy", "mug500_source_mesh"):
        assert current in names and source_is_browsable(current)


def test_retired_package_is_hidden_from_browse_but_resolves_and_serves_exactly(source, monkeypatch):
    source[1].recipe["id"] = "mida_complete"
    path = build(source)
    original = path.read_bytes()
    manifest = json.loads(original)
    state = source[0].parent / (source[0].name + "-workspace")
    manager = Workspace(source[0], state, data_floor_gib=0, state_floor_gib=0)
    monkeypatch.setattr("neuroimage.workspace.recipe_names", lambda: ["mida"])
    web = state / "web"; web.mkdir(); (web / "index.html").write_text("<!doctype html><title>Fixture</title>")
    server = create_server([], web, 0, workspace=manager)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    try:
        records = library_records(source[0])
        record = next(item for item in records if item["dataset_id"] == "mida_complete")
        assert manager.package_records()[0]["manifest"] == str(path)
        assert manager.browse()["packages"] == []
        assert [item["id"] for item in manager.browse()["sources"]] == ["mida"]
        binding = {"package_id": manifest["package_id"], "package_version": manifest["package_version"],
                   "build_signature": manifest["build"]["signature"], "space_id": manifest["space"]["id"]}
        assert locate_binding(binding, records)["manifest"] == str(path)
        key = package_key(record)
        with urllib.request.urlopen(url + "/api/workspace/atlases/" + key) as response:
            assert json.load(response)["atlas_key"] == key
        with urllib.request.urlopen(url + "/api/atlases") as response:
            assert json.load(response)["atlases"][0]["dataset_id"] == "mida_complete"
        with urllib.request.urlopen(url + "/atlas/" + key + "/manifest.json") as response:
            assert response.read() == original
        assert path.read_bytes() == original
    finally:
        server.shutdown(); server.server_close(); thread.join(); manager.close()
