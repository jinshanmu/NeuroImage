"""Local job ownership, source bindings and mutation boundaries."""
import hashlib
import json
from pathlib import Path
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

import pytest

from neuroimage.build import atomic_json
from neuroimage.server import create_server
from neuroimage.workspace import Workspace, package_key
from test_pipeline import source, build


@pytest.fixture
def workspace(tmp_path):
    data = tmp_path / "data"; data.mkdir()
    manager = Workspace(data, tmp_path / "state", data_floor_gib=0, state_floor_gib=0)
    yield manager
    manager.close()


def finish(manager, ident, timeout=5):
    deadline = time.monotonic() + timeout
    while manager._active_id and time.monotonic() < deadline:
        time.sleep(.02)
    assert manager._active_id is None
    return manager.jobs[ident]


def test_job_completion_and_state_recovery_keep_originals(workspace, monkeypatch):
    original = workspace.data_root / "original.txt"; original.write_text("Unchanged source fixture")
    monkeypatch.setattr(workspace, "_command", lambda _: [sys.executable, "-u", "-c",
        'import json; print(json.dumps({"event":"workspace-result","result":{"reused":3,"downloads":0}}))'])
    ident = workspace.start({"action": "acquire", "recipe": "brainstem_navigator_mni"})["id"]
    assert finish(workspace, ident)["status"] == "complete"
    assert original.read_text() == "Unchanged source fixture"
    record = workspace.jobs_root / ident / "status.json"
    saved = json.loads(record.read_text()); saved["status"] = "running"; atomic_json(record, saved)
    workspace.close()
    resumed = Workspace(workspace.data_root, workspace.state_root, data_floor_gib=0, state_floor_gib=0)
    try:
        assert resumed.jobs[ident]["status"] == "interrupted"
        assert "checkpoints" in resumed.jobs[ident]["detail"]
        assert (record.parent / "operation.log").is_file()
    finally:
        resumed.close()


def test_cancel_owns_one_process_and_reuses_completed_checkpoint(workspace, monkeypatch):
    checkpoint = workspace.data_root / "generated-checkpoint.txt"
    script = ("from pathlib import Path; import time; "
              f"p=Path({str(checkpoint)!r}); p.write_text('retained') if not p.exists() else None; "
              "print('{\"event\":\"fixture-ready\"}',flush=True); time.sleep(20)")
    monkeypatch.setattr(workspace, "_command", lambda _: [sys.executable, "-u", "-c", script])
    ident = workspace.start({"action": "build", "recipe": "brainstem_navigator_mni"})["id"]
    until = time.monotonic() + 3
    while not checkpoint.exists() and time.monotonic() < until:
        time.sleep(.02)
    assert checkpoint.exists()
    with pytest.raises(ValueError, match="current operation"):
        workspace.start({"action": "build", "recipe": "brainstem_navigator_mni"})
    with pytest.raises(ValueError, match="Another workspace"):
        Workspace(workspace.data_root, workspace.state_root, data_floor_gib=0, state_floor_gib=0)
    workspace.cancel(ident)
    assert finish(workspace, ident)["status"] == "cancelled"
    assert checkpoint.read_text() == "retained"
    assert workspace._process is None
    stamp = checkpoint.stat().st_mtime_ns
    resume = ("from pathlib import Path; import json; "
              f"p=Path({str(checkpoint)!r}); assert p.read_text() == 'retained'; "
              "print(json.dumps({'event':'workspace-result','result':{'reused':1,'built':0}}))")
    monkeypatch.setattr(workspace, "_command", lambda _: [sys.executable, "-u", "-c", resume])
    resumed = workspace.start({"action": "build", "recipe": "brainstem_navigator_mni"})["id"]
    assert finish(workspace, resumed)["result"] == {"reused": 1, "built": 0}
    assert checkpoint.stat().st_mtime_ns == stamp


def test_request_schema_rejects_commands_paths_and_mismatched_actions(workspace):
    for value in ({"action": "acquire", "recipe": "unknown"},
                  {"action": "build", "recipe": "brainstem_navigator_mni", "command": "anything"},
                  {"action": "activate", "manifest": "/unselected/file"},
                  {"action": "prepare", "package_key": "unavailable", "curriculum": "brainstem-source-regions"},
                  {"action": "activate", "package_key": "unavailable", "recipe": "brainstem_navigator_mni"}):
        with pytest.raises(ValueError):
            workspace.start(value)
    assert not list(workspace.jobs_root.iterdir())


def test_history_pages_preserve_every_completed_record_and_stable_order(workspace):
    workspace.jobs = {f"{index:032x}": {"id": f"{index:032x}", "started_utc": "2026-10-13T00:00:00Z", "status": "complete",
                                      "request": {"action": "activate", "package_key": "synthetic"}}
                      for index in range(65)}
    original = json.dumps(workspace.jobs, sort_keys=True)
    pages = [workspace.catalog(jobs_offset=offset) for offset in (0, 30, 60)]
    assert [len(page["jobs"]) for page in pages] == [30, 30, 5]
    assert all(page["jobs_total"] == 65 and page["jobs_limit"] == 30 for page in pages)
    assert [page["jobs_offset"] for page in pages] == [0, 30, 60]
    recovered = [job["id"] for page in pages for job in page["jobs"]]
    assert recovered == sorted(workspace.jobs, reverse=True)
    assert json.dumps(workspace.jobs, sort_keys=True) == original
    assert workspace.catalog(jobs_offset=90)["jobs"] == []
    for offset in (-1, True, 1.5):
        with pytest.raises(ValueError, match="history offset"):
            workspace.catalog(jobs_offset=offset)


def test_workspace_api_requires_local_origin_and_token(workspace, monkeypatch):
    web = workspace.state_root / "web"; web.mkdir(); (web / "index.html").write_text("<!doctype html><title>Workspace fixture</title>")
    monkeypatch.setattr(workspace, "_command", lambda _: [sys.executable, "-c",
        'print(\'{"event":"workspace-result","result":{"downloads":0}}\')'])
    server = create_server([], web, 0, workspace=workspace)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(url + "/api/atlases") as response:
            assert json.load(response)["workspace"] is True
        with urllib.request.urlopen(url + "/api/workspace") as response:
            token = json.load(response)["session_token"]
        with urllib.request.urlopen(url + "/api/workspace/session") as response:
            assert json.load(response) == {"session_token": token}
        with urllib.request.urlopen(url + "/api/workspace?jobs_offset=30") as response:
            history = json.load(response)
            assert history["jobs"] == [] and history["jobs_total"] == 0 and history["jobs_offset"] == 30
        for query in ("jobs_offset=-1", "jobs_offset=invalid", "jobs_offset=0&jobs_offset=30", "path=outside"):
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(url + "/api/workspace?" + query)
            assert error.value.code == 400
        with urllib.request.urlopen(url + "/api/workspace/structures?q=left&dataset=&module=&offset=0") as response:
            search = json.load(response)
            assert search["total"] == 0 and search["matches"] == [] and search["indexed_packages"] == 0
        for query in ("q=x", "q=left&q=right", "q=left&offset=-1", "q=left&offset=invalid", "q=left&path=outside"):
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(url + "/api/workspace/structures?" + query)
            assert error.value.code == 400
        body = json.dumps({"action": "acquire", "recipe": "brainstem_navigator_mni"}).encode()
        for origin, supplied in (("http://foreign.example", token), (url, "wrong"), ("", token)):
            request = urllib.request.Request(url + "/api/workspace/jobs", body,
                {"Content-Type": "application/json", "Origin": origin, "X-NeuroImage-Token": supplied})
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            assert error.value.code == 403
        assert workspace.jobs == {}
        request = urllib.request.Request(url + "/api/workspace/jobs", body,
            {"Content-Type": "application/json", "Origin": url, "X-NeuroImage-Token": token})
        with urllib.request.urlopen(request) as response:
            assert response.status == 202
            ident = json.load(response)["id"]
        assert finish(workspace, ident)["status"] == "complete"
        with urllib.request.urlopen(url + "/api/workspace/jobs/" + ident) as response:
            assert json.load(response)["status"] == "complete"
        copy = workspace.job_status(ident); copy["status"] = "changed outside the workspace"
        assert workspace.jobs[ident]["status"] == "complete"
        with pytest.raises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(url + "/api/workspace/jobs/missing")
        assert error.value.code == 400
        with pytest.raises(urllib.error.HTTPError):
            urllib.request.urlopen(url + "/api/workspace/content/../../workspace.json")
    finally:
        server.shutdown(); server.server_close(); thread.join()
