"""Retired teaching interfaces cannot start work or alter preserved user records."""
import json
from pathlib import Path
import threading
import urllib.error
import urllib.request

import pytest

from neuroimage.cli import main
from neuroimage.server import create_server
from neuroimage.workspace import JobRequest, Workspace


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
        assert len(catalog["sources"]) == 39
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
