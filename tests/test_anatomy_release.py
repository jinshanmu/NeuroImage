"""Retired teaching interfaces cannot start work or alter preserved user records."""
import json
from pathlib import Path
import threading
import urllib.error
import urllib.request

import pytest

from neuroimage.cli import main
from neuroimage.adapters import recipe_names
from neuroimage.server import create_server
from neuroimage.workspace import JobRequest, Workspace


def test_release_inventory_contains_only_enabled_sources_and_preserves_archives():
    root = Path(__file__).resolve().parents[1]
    release = json.loads((root / "config/anatomy-release-1.0.0.json").read_text())
    sources = release["sources"]
    datasets = {source["dataset_id"] for source in sources}
    assert release["source_count"] == len(sources) == len(datasets) == 22
    assert release["upstream_source_families"] == 12
    assert release["source_specific_structures"] == sum(source["structures"] for source in sources) == 1390
    assert release["detailed_topics"] == 52
    assert release["available_detailed_topics"] == 46
    assert release["detailed_topic_bindings"] == 136
    assert release["excluded_source_families"] == [
        "NextBrain", "IXI", "HumanBrainAtlas", "Meso-vein MRI", "VENAT", "Arterial occurrence atlas",
        "Human Inner Ear CT", "TopCoW", "TopBrain", "UCSF-PDGM", "MSD BrainTumour"
    ]
    # The pinned release inventory remains a historical compatibility baseline;
    # additional verified source cases/configurations extend the current registry.
    assert datasets <= set(recipe_names())
    assert not any(dataset.startswith("nextbrain_") for dataset in datasets)
    assert not datasets & {"ixi_mra", "hba_native", "mesoveins", "venat", "mouches_arteries", "inner_ear_ct_specimen1"}

    # Source exclusion changes the current release, not its dated provenance.
    archive = json.loads((root / "config/anatomy-detail-inventory-2026-10-15.json").read_text())
    assert archive["source_count"] == 39
    recipes = root / "src/neuroimage/recipes"
    assert len(list(recipes.glob("nextbrain_*.json"))) == 11
    assert all((recipes / (name + ".json")).is_file() for name in
               ("ixi_mra", "hba_native", "mesoveins", "venat", "mouches_arteries"))


@pytest.mark.parametrize("action", ["prepare", "prepare-course"])
def test_teaching_jobs_are_rejected_before_any_work(action):
    with pytest.raises(ValueError):
        JobRequest.model_validate({"action": action, "package_key": "retained-package"})


def test_teaching_command_is_removed(capsys):
    with pytest.raises(SystemExit) as error:
        main(["teaching", "recipes"])
    assert error.value.code == 2
    assert "invalid choice" in capsys.readouterr().err


@pytest.mark.parametrize("status", ["complete", "running", "stopping"])
def test_retired_routes_and_history_preserve_files(tmp_path, status):
    data, state, web = (tmp_path / name for name in ("data", "state", "web"))
    data.mkdir(); web.mkdir()
    (web / "index.html").write_text("Synthetic anatomy viewer")
    ident = "a" * 32
    folder = state / "jobs" / ident
    folder.mkdir(parents=True)
    notebook = data / "original-notebook.json"
    notebook.write_text('{"kind":"neuroimage-teaching-notebook","title":"Retained original"}')
    job_path = folder / "status.json"
    job_path.write_text(json.dumps({
        "id": ident, "status": status, "started_utc": "2026-10-19T00:00:00Z",
        "request": {"action": "prepare", "package_key": "original"},
        "result": {"notebook": str(notebook), "open_url": "/?workspace-content=" + ident},
    }))
    originals = {path: path.read_bytes() for path in (notebook, job_path)}
    with_workspace = Workspace(data, state, data_floor_gib=0, state_floor_gib=0)
    server = create_server([], web, 0, workspace=with_workspace)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(url + "/api/workspace") as response:
            catalog = json.load(response)
        assert "curricula" not in catalog and "course_plans" not in catalog
        assert catalog["jobs"] == [] and catalog["jobs_total"] == 0
        assert {source["id"] for source in catalog["sources"]} == set(recipe_names())
        assert not any(source["id"].startswith("nextbrain_") for source in catalog["sources"])
        headers = {"Content-Type": "application/json", "Origin": url, "X-NeuroImage-Token": catalog["session_token"]}
        for route in ("/teaching", "/teaching/old", "/courses", "/courses/old",
                      "/courses/old/open", "/courses/old/preview", "/content/" + ident):
            for method in ("GET", "POST"):
                request = urllib.request.Request(url + "/api/workspace" + route,
                    data=b"{}" if method == "POST" else None, headers=headers, method=method)
                with pytest.raises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request)
                assert error.value.code == 404
        for action in ("prepare", "prepare-course"):
            request = urllib.request.Request(url + "/api/workspace/jobs",
                json.dumps({"action": action}).encode(), headers)
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            assert error.value.code == 400
        assert with_workspace._active_id is None
        assert len(with_workspace.jobs) == 1
        for path, content in originals.items():
            assert path.read_bytes() == content
    finally:
        server.shutdown(); server.server_close(); thread.join()
        with_workspace.close()
