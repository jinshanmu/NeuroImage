"""HTTP revalidation and lightweight discovery preserve local file boundaries."""
import json
import threading
import urllib.error
import urllib.request

import pytest

from neuroimage.server import create_server
from neuroimage.workspace import Workspace


@pytest.fixture
def local_service(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    manager = Workspace(data, tmp_path / "state", data_floor_gib=0, state_floor_gib=0)
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<title>Local cache fixture</title>")
    (web / "assets/view-abc123.js").write_text("const revision = 1;")
    server = create_server([], web, 0, workspace=manager)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}", web, manager
    server.shutdown()
    server.server_close()
    thread.join()
    manager.close()


def test_cached_response_revalidates_replaced_file_and_has_no_body(local_service):
    url, web, _ = local_service
    with urllib.request.urlopen(url + "/") as response:
        etag = response.headers["ETag"]
        assert response.headers["Cache-Control"] == "private, no-cache"
        original = response.read()
    request = urllib.request.Request(url + "/", headers={"If-None-Match": f'"other", W/{etag}'})
    with pytest.raises(urllib.error.HTTPError) as result:
        urllib.request.urlopen(request)
    assert result.value.code == 304
    assert result.value.read() == b""
    (web / "index.html").write_text("<title>Changed cache fixture</title>")
    with urllib.request.urlopen(request) as response:
        assert response.status == 200
        assert response.headers["ETag"] != etag
        assert response.read() != original
    with urllib.request.urlopen(urllib.request.Request(url + "/", method="HEAD")) as response:
        assert int(response.headers["Content-Length"]) == (web / "index.html").stat().st_size
        assert response.read() == b""


def test_static_cache_does_not_cache_session_or_expose_paths(local_service):
    url, _, _ = local_service
    with urllib.request.urlopen(url + "/assets/view-abc123.js") as response:
        assert "immutable" in response.headers["Cache-Control"]
    with urllib.request.urlopen(url + "/api/workspace/session") as response:
        assert response.headers["Cache-Control"] == "no-store"
    with pytest.raises(urllib.error.HTTPError) as result:
        urllib.request.urlopen(url + "/assets/../../outside.js")
    assert result.value.code == 404


def test_browse_cache_is_bounded_refreshable_and_keeps_callers_independent(local_service, monkeypatch):
    url, _, manager = local_service
    calls = []
    monkeypatch.setattr("neuroimage.workspace.library_records", lambda root: calls.append(root) or [])
    for suffix in ("", ""):
        with urllib.request.urlopen(url + "/api/workspace/browse" + suffix) as response:
            value = json.load(response)
            assert value["sources"] and value["packages"] == []
            assert "curricula" not in value
    assert len(calls) == 1
    manager.browse()["sources"].clear()
    assert manager.browse()["sources"]
    with urllib.request.urlopen(url + "/api/workspace/browse?refresh=1") as response:
        assert json.load(response)["sources"]
    assert len(calls) == 2
    manager.jobs["new-job"] = {"status": "complete"}
    manager.browse()
    assert len(calls) == 3
    with pytest.raises(urllib.error.HTTPError) as result:
        urllib.request.urlopen(url + "/api/workspace/browse?refresh=invalid")
    assert result.value.code == 400
