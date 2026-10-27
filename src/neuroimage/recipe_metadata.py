"""Small file-identity cache for shared recipe metadata, never source arrays or file presence."""
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path
import stat


def _stamp(path):
    value = path.stat()
    if not stat.S_ISREG(value.st_mode):
        raise ValueError("Recipe metadata must be a regular file")
    return (str(path.resolve()), value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


@lru_cache(maxsize=16)
def _read_json(path, stamp):
    path = Path(path)
    if _stamp(path) != stamp:
        raise ValueError("Recipe metadata changed while being read; refresh the source library")
    result = json.loads(path.read_text())
    if _stamp(path) != stamp:
        raise ValueError("Recipe metadata changed while being read; refresh the source library")
    return result


def _metadata_json(path):
    """Private shared snapshot: consumers must copy any values returned to callers."""
    path = Path(path)
    return _read_json(str(path.absolute()), _stamp(path))


def recipe_metadata(path):
    """A fresh mutable template; changed, replaced and deleted files are rechecked on every call."""
    return deepcopy(_metadata_json(path))
