"""Bounded in-process summaries for browsing unchanged local teaching files."""
from collections import OrderedDict
import json
from pathlib import Path
import threading
import time


class SummaryCache:
    """Cache summaries only; opening a teaching file still reads its full content."""

    def __init__(self, *, max_entries=1024, max_bytes=16 * 1024**2, max_age_seconds=30):
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.max_age_seconds = max_age_seconds
        self._values = OrderedDict()
        self._bytes = 0
        self._lock = threading.Lock()

    @staticmethod
    def stamp(path):
        if path.is_symlink() or not path.is_file():
            raise ValueError("Teaching metadata must be a regular file")
        stat = path.stat()
        return (str(path.resolve()), stat.st_dev, stat.st_ino, stat.st_size,
                stat.st_mtime_ns, stat.st_ctime_ns)

    def read(self, path, loader):
        path = Path(path)
        with self._lock:
            key = str(path.absolute())
            stamp = self.stamp(path)
            previous = self._values.pop(key, None)
            if previous:
                self._bytes -= len(previous[1])
                if previous[0] == stamp and time.monotonic() - previous[2] < self.max_age_seconds:
                    self._values[key] = previous
                    self._bytes += len(previous[1])
                    return json.loads(previous[1])
            summary = loader(path)
            if self.stamp(path) != stamp:
                raise ValueError("Teaching metadata changed while being read; refresh the library")
            encoded = json.dumps(summary, allow_nan=False).encode()
            if len(encoded) <= self.max_bytes:
                self._values[key] = (stamp, encoded, time.monotonic())
                self._bytes += len(encoded)
                while len(self._values) > self.max_entries or self._bytes > self.max_bytes:
                    _, removed = self._values.popitem(last=False)
                    self._bytes -= len(removed[1])
            return summary
