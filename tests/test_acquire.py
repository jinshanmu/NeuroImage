"""Check source reuse, interrupted transfers and bounded selective expansion."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
import zipfile
import pytest
from neuroimage import acquire as acquisition


def digest(data):
    return hashlib.sha256(data).hexdigest()


@contextmanager
def transfer_server(payload, requests, *, range_mode="valid"):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requested = self.headers.get("Range")
            requests.append(requested)
            offset = int(requested.split("=")[1].split("-")[0]) if requested else 0
            if requested and range_mode != "ignored":
                self.send_response(206)
                start = offset + 1 if range_mode == "invalid" else offset
                self.send_header("Content-Range", f"bytes {start}-{len(payload)-1}/{len(payload)}")
            else:
                self.send_response(200); offset = 0
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(payload) - offset))
            self.end_headers(); self.wfile.write(payload[offset:])
        def log_message(self, *args):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/source.zip"
    finally:
        server.shutdown(); server.server_close(); thread.join()


@pytest.mark.parametrize("range_mode", ["valid", "ignored"])
def test_resume_with_range_or_full_response(tmp_path, range_mode):
    payload = b"synthetic acquisition bytes" * 100
    target = tmp_path / "source.zip"
    target.with_suffix(".zip.partial").write_bytes(payload[:371])
    requests = []
    with transfer_server(payload, requests, range_mode=range_mode) as url:
        spec = {"url": url, "bytes": len(payload), "sha256": digest(payload)}
        result = acquisition.download(spec, target, tmp_path, 0)
        assert result["status"] == "downloaded"
        assert target.read_bytes() == payload
        assert requests == ["bytes=371-"]
        assert acquisition.download(spec, target, tmp_path, 0)["status"] == "reused"
        assert len(requests) == 1


def test_inconsistent_range_preserves_partial(tmp_path):
    payload = b"synthetic" * 100
    partial = tmp_path / "source.zip.partial"; partial.write_bytes(payload[:100])
    with transfer_server(payload, [], range_mode="invalid") as url:
        with pytest.raises(ValueError, match="Content-Range"):
            acquisition.download({"url": url, "bytes": len(payload), "sha256": digest(payload)}, tmp_path / "source.zip", tmp_path, 0)
    assert partial.read_bytes() == payload[:100]


def test_source_conflict_is_preserved_without_network(tmp_path):
    target = tmp_path / "source.zip"; target.write_bytes(b"user original")
    with pytest.raises(ValueError, match="preserved"):
        acquisition.download({"url": "https://example.invalid/source.zip", "bytes": 5, "sha256": digest(b"other")}, target, tmp_path, 0)
    assert target.read_bytes() == b"user original"


def test_direct_sources_are_reused_without_duplicate_expansion(tmp_path, monkeypatch):
    source = tmp_path / "downloads/synthetic/template.nii.gz"
    source.parent.mkdir(parents=True); source.write_bytes(b"synthetic direct source")
    recipe = {"archives": [], "license_downloads": [], "files": [{"target": "downloads/synthetic/template.nii.gz", "url": "https://example.invalid/template.nii.gz", "bytes": source.stat().st_size, "sha256": digest(source.read_bytes())}]}
    monkeypatch.setattr(acquisition, "load_recipe", lambda _: recipe)
    monkeypatch.setattr(acquisition, "urlopen", lambda *args, **kwargs: pytest.fail("Verified direct files must not be downloaded again"))
    receipt = acquisition.acquire("synthetic", tmp_path, minimum_free_gib=0)
    assert receipt["plan"]["peak_additional_bytes"] == 0
    assert receipt["files"][0]["status"] == "reused" and receipt["expanded"] == []
    assert not (tmp_path / "raw").exists()


def test_manually_obtained_archive_has_actionable_recovery_and_reuse(tmp_path, monkeypatch):
    monkeypatch.setattr(acquisition, "urlopen", lambda *args, **kwargs: pytest.fail("A manual source must not start a network request"))
    payload = b"synthetic local archive"
    spec = {"url": None, "access_url": "https://example.org/official-access", "bytes": len(payload), "sha256": digest(payload)}
    path = tmp_path / "downloads/source.zip"
    with pytest.raises(ValueError, match="official-access.*Save the unchanged archive"):
        acquisition.download(spec, path, tmp_path, 0)
    assert not path.parent.exists()
    path.parent.mkdir(); path.write_bytes(payload)
    assert acquisition.download(spec, path, tmp_path, 0)["status"] == "reused"


@pytest.fixture
def recipe(tmp_path, monkeypatch):
    payload = b"generated source bytes"
    path = tmp_path / "downloads/synthetic/source.zip"; path.parent.mkdir(parents=True)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("release/selected.bin", payload)
        archive.writestr("../not-selected.bin", b"unused unsafe archive name")
    spec = {"dataset_id": "synthetic", "filename": path.name, "url": "https://example.invalid/source.zip", "bytes": path.stat().st_size,
            "sha256": digest(path.read_bytes()), "members": [{"member": "release/selected.bin", "target": "raw/synthetic/source.bin", "bytes": len(payload), "sha256": digest(payload)}]}
    config = {"archives": [spec], "license_downloads": []}
    monkeypatch.setattr(acquisition, "load_recipe", lambda _: config)
    monkeypatch.setattr(acquisition, "urlopen", lambda *args, **kwargs: pytest.fail("Verified local sources must not cause a network transfer"))
    return config, path, payload


def test_reused_archive_selectively_extracts_and_records_receipt(tmp_path, recipe):
    first = acquisition.acquire("synthetic", tmp_path, minimum_free_gib=0)
    assert first["status"] == "complete"
    assert first["files"][0]["status"] == "reused"
    assert first["expanded"][0]["status"] == "extracted"
    assert (tmp_path / "raw/synthetic/source.bin").read_bytes() == recipe[2]
    assert not (tmp_path / "not-selected.bin").exists()
    second = acquisition.acquire("synthetic", tmp_path, minimum_free_gib=0)
    assert second["expanded"][0]["status"] == "reused"
    assert json.loads((tmp_path / "downloads/synthetic/neuroimage-acquisition.json").read_text())["status"] == "complete"


def test_selected_member_traversal_is_rejected(tmp_path, recipe):
    spec = recipe[0]["archives"][0]
    spec["members"][0]["member"] = "../not-selected.bin"
    with pytest.raises(ValueError, match="relative"):
        acquisition.extract_members(recipe[1], spec, tmp_path, 0)


def test_dry_run_and_capacity_failure_do_not_expand(tmp_path, recipe):
    plan = acquisition.acquire("synthetic", tmp_path, minimum_free_gib=0, dry_run=True)
    assert plan["additional_download_bytes"] == 0
    assert plan["additional_expansion_bytes"] == len(recipe[2])
    assert not (tmp_path / "raw").exists()
    with pytest.raises(ValueError, match="safety floor"):
        acquisition.acquire("synthetic", tmp_path, minimum_free_gib=1e9)
    assert not (tmp_path / "downloads/synthetic/neuroimage-acquisition.json").exists()


def test_partial_symlink_is_not_overwritten(tmp_path, recipe):
    # This tiny text-only check needs symlinks; some data drives do not support them.
    with TemporaryDirectory(prefix="neuroimage-acquire-link-") as directory:
        root = Path(directory)
        original = root / "original.txt"; original.write_text("preserve")
        output = root / "raw/synthetic"; output.mkdir(parents=True)
        (output / "source.bin.extracting").symlink_to(original)
        with pytest.raises(ValueError, match="symbolic link"):
            acquisition.extract_members(recipe[1], recipe[0]["archives"][0], root, 0)
        assert original.read_text() == "preserve"


def test_extraction_conflict_records_failure_without_replacing_original(tmp_path, recipe):
    target = tmp_path / "raw/synthetic/source.bin"; target.parent.mkdir(parents=True)
    target.write_bytes(b"user original")
    with pytest.raises(ValueError, match="preserved"):
        acquisition.acquire("synthetic", tmp_path, minimum_free_gib=0)
    assert target.read_bytes() == b"user original"
    receipt = json.loads((tmp_path / "downloads/synthetic/neuroimage-acquisition.json").read_text())
    assert receipt["status"] == "failed" and receipt["error_type"] == "ValueError"


def test_verified_extracted_inputs_do_not_require_or_read_an_unused_archive(tmp_path, recipe, monkeypatch):
    config, archive, payload = recipe
    output = tmp_path / 'raw/synthetic/source.bin'
    output.parent.mkdir(parents=True); output.write_bytes(payload)
    archive.unlink()
    monkeypatch.setattr(acquisition, 'download', lambda *args: pytest.fail('The absent archive is unnecessary'))
    result = acquisition.acquire('synthetic', tmp_path, minimum_free_gib=0)
    assert result['plan']['peak_additional_bytes'] == 0
    assert result['files'][0]['status'] == 'not_needed'
    assert result['files'][0]['archive_verification'] == 'not_performed_this_run'
    assert result['expanded'][0]['status'] == 'reused'


@pytest.mark.parametrize('kind', ['regular', 'symlink', 'hardlink', 'duplicate'])
def test_selective_tar_member_safety_and_reuse(tmp_path, kind):
    import io
    import tarfile
    payload = b'generated native image fixture'
    path = tmp_path / 'source.tar'
    with tarfile.open(path, 'w') as archive:
        info = tarfile.TarInfo('selected.nii.gz')
        info.size = len(payload)
        if kind in {'symlink', 'hardlink'}:
            info.type = tarfile.SYMTYPE if kind == 'symlink' else tarfile.LNKTYPE
            info.linkname = '../original'
            info.size = 0
        archive.addfile(info, io.BytesIO(payload) if kind not in {'symlink', 'hardlink'} else None)
        if kind == 'duplicate':
            archive.addfile(info, io.BytesIO(payload))
        other = tarfile.TarInfo('../unselected'); other.size = 3
        archive.addfile(other, io.BytesIO(b'no!'))
    spec = {'format': 'tar', 'members': [{'member': 'selected.nii.gz', 'target': 'raw/selected.nii.gz',
                                        'bytes': len(payload), 'sha256': digest(payload)}]}
    if kind != 'regular':
        with pytest.raises(ValueError, match='Unsafe|Duplicate'):
            acquisition.extract_members(path, spec, tmp_path, 0)
        assert not (tmp_path / 'raw/selected.nii.gz').exists()
    else:
        assert acquisition.extract_members(path, spec, tmp_path, 0)[0]['status'] == 'extracted'
        assert acquisition.extract_members(path, spec, tmp_path, 0)[0]['status'] == 'reused'
        assert (tmp_path / 'raw/selected.nii.gz').read_bytes() == payload
        assert not (tmp_path / 'unselected').exists()
