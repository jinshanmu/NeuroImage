"""Summary reuse preserves edits, file boundaries and bounded memory."""
import json
import os
import time

import pytest

from neuroimage.metadata_cache import SummaryCache


def test_summary_reuses_unchanged_files_and_detects_replacement(tmp_path):
    path = tmp_path / "record.json"; path.write_text('{"title":"one"}')
    cache = SummaryCache(); calls = []
    def load(file):
        calls.append(file)
        return json.loads(file.read_text())
    first = cache.read(path, load); first["title"] = "caller edit"
    assert cache.read(path, load) == {"title": "one"}
    assert len(calls) == 1
    original = path.stat()
    # Some filesystems update ctime once per clock tick.
    time.sleep(.01)
    path.write_text('{"title":"two"}')
    os.utime(path, ns=(original.st_atime_ns, original.st_mtime_ns))
    assert cache.read(path, load) == {"title": "two"}
    assert len(calls) == 2
    cache.max_age_seconds = 0
    cache.read(path, load)
    assert len(calls) == 3
    path.unlink(); path.symlink_to(tmp_path / "missing.json")
    with pytest.raises(ValueError, match="regular file"):
        cache.read(path, load)


def test_summary_cache_evicts_and_rejects_read_time_changes(tmp_path):
    cache = SummaryCache(max_entries=1); calls = []
    paths = [tmp_path / (name + ".json") for name in ["one", "two"]]
    for path in paths:
        path.write_text('{}')
    def load(file):
        calls.append(file)
        return {"title": file.stem}
    cache.read(paths[0], load); cache.read(paths[1], load); cache.read(paths[0], load)
    assert len(calls) == 3
    def changed(file):
        file.write_text('{"changed":true}')
        return {"title": "old"}
    with pytest.raises(ValueError, match="changed while being read"):
        SummaryCache().read(paths[0], changed)
