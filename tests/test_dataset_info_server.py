"""A standalone atlas exposes the same source explanation as the dataset library."""
import json
import threading
import urllib.request

from neuroimage.server import create_server
from test_pipeline import source, build


def test_standalone_catalog_includes_attribution_space_and_source_limits(source):
    root, imported = source
    imported.recipe["description"] = "An introduction available before opening the atlas."
    imported.recipe["scope_notes"] = ["Only the supplied source definitions are represented."]
    path = build(source)
    original_manifest = path.read_bytes()
    manifest = json.loads(original_manifest)
    web = root / "web"
    web.mkdir()
    (web / "index.html").write_text("<!doctype html><title>Dataset details fixture</title>")
    server = create_server([path], web, 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}/api/atlases") as response:
            catalog = json.load(response)
        assert catalog["workspace"] is False
        atlas = catalog["atlases"][0]
        info = atlas["dataset_info"]
        assert imported.recipe["description"] in info["description"]
        assert set(imported.recipe["scope_notes"]) <= set(info["scope_notes"])
        assert info["space"]["name"] == manifest["space"]["name"]
        assert info["space"]["correspondence"] == manifest["space"]["correspondence"]
        assert atlas["package_version"] == manifest["package_version"]
        assert atlas["sources"] == manifest["sources"]
        for source in atlas["sources"]:
            with urllib.request.urlopen(f"http://127.0.0.1:{server.server_port}" + atlas["base_url"] + source["license_file"]) as response:
                assert response.read() == (path.parent / source["license_file"]).read_bytes()
        assert path.read_bytes() == original_manifest
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
