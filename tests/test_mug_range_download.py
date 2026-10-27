"""HTTP ranges must preserve exact original bytes across transfer interruptions."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib
import json
from pathlib import Path
import re
import threading

import pytest


@pytest.fixture
def ranged_source(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).parents[1] / "scripts"))
    module = importlib.import_module("mug_range_download")
    payload = bytes(range(251)) * 37
    config = {"supported": True, "bad_range": False, "probe_only": False, "requests": []}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            match = re.fullmatch(r"bytes=(\d+)-(\d+)", self.headers.get("Range", ""))
            start, end = map(int, match.groups())
            config["requests"].append((start, end))
            supported = config["supported"] and (not config["probe_only"] or (start, end) == (0, 0))
            content = payload[start:end+1] if supported else payload
            self.send_response(206 if supported else 200)
            if supported:
                actual_start = start + int(config["bad_range"])
                self.send_header("Content-Range", f"bytes {actual_start}-{end}/{len(payload)}")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            try:
                self.wfile.write(content)
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    source = {"name": "A0001-A0001.zip", "size": len(payload),
              "computed_md5": hashlib.md5(payload).hexdigest(),
              "download_url": f"http://127.0.0.1:{server.server_port}/original.zip"}
    yield module, source, payload, config, tmp_path / source["name"]
    server.shutdown()
    server.server_close()
    thread.join()


def test_parallel_ranges_publish_only_exact_original_archive(ranged_source):
    module, source, payload, config, target = ranged_source
    assert module.download_ranges(source, target, target.parent, 0, connections=4, chunk_bytes=1024)
    assert target.read_bytes() == payload
    ledger = json.loads(target.with_name(target.name + ".ranges.json").read_text())
    assert ledger["status"] == "published"
    assert len(ledger["complete"]) == 10
    assert not target.with_name(target.name + ".ranges.partial").exists()


def test_non_206_probe_falls_back_without_creating_partial(ranged_source):
    module, source, payload, config, target = ranged_source
    config["supported"] = False
    assert not module.download_ranges(source, target, target.parent, 0, connections=4, chunk_bytes=1024)
    assert not target.exists()
    assert not target.with_name(target.name + ".ranges.partial").exists()


def test_wrong_content_range_is_rejected(ranged_source):
    module, source, payload, config, target = ranged_source
    config["bad_range"] = True
    with pytest.raises(ValueError, match="Content-Range"):
        module.download_ranges(source, target, target.parent, 0, connections=4, chunk_bytes=1024)
    assert not target.exists()


def test_interrupted_legacy_prefix_resumes_and_repairs_only_corrupt_chunks(ranged_source):
    module, source, payload, config, target = ranged_source
    target.with_name(target.name + ".partial").write_bytes(payload[:3*1024+123])
    stop = threading.Event()
    stop.set()
    with pytest.raises(InterruptedError):
        module.download_ranges(source, target, target.parent, 0, connections=4, stop=stop, chunk_bytes=1024)
    partial = target.with_name(target.name + ".ranges.partial")
    ledger = target.with_name(target.name + ".ranges.json")
    assert set(json.loads(ledger.read_text())["complete"]) == {"0", "1", "2"}
    with partial.open("r+b") as stream:
        stream.write(b"wrong")
    config["requests"].clear()
    assert module.download_ranges(source, target, target.parent, 0, connections=4, chunk_bytes=1024)
    assert target.read_bytes() == payload
    assert (0, 1023) in config["requests"]
    assert (1024, 2047) not in config["requests"]
    assert (2048, 3071) not in config["requests"]


def test_wrong_publisher_md5_never_publishes_and_preserves_partial(ranged_source):
    module, source, payload, config, target = ranged_source
    source["computed_md5"] = "0" * 32
    with pytest.raises(ValueError, match="Publisher MD5 mismatch"):
        module.download_ranges(source, target, target.parent, 0, connections=4, chunk_bytes=1024)
    assert not target.exists()
    assert target.with_name(target.name + ".ranges.partial").read_bytes() == payload


def test_server_switching_to_200_cannot_be_spliced_into_range_offsets(ranged_source):
    module, source, payload, config, target = ranged_source
    config["probe_only"] = True
    assert not module.download_ranges(source, target, target.parent, 0, connections=4, chunk_bytes=1024)
    assert not target.exists()
    assert target.with_name(target.name + ".ranges.partial").read_bytes() == b"\0" * len(payload)
