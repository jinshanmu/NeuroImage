"""Optional receipts for reusing geometry checks after fresh asset hashing."""
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
import hashlib
import json
import os
import platform
import sys
import tempfile

CACHE_NAME = ".geometry-validation-cache.json"
# Capture the loaded implementation identity once. Editing source files while an
# existing server runs must not label that server's old code as a new validator.
_CODE = {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
         for name in ("validation_cache.py", "validation.py", "geometry.py", "contracts.py", "streamlines.py", "streamline_validation.py", "region_validation.py")}
_LIBRARIES = {name: version(name) for name in ("numpy", "scipy", "nibabel", "pynrrd", "scikit-image", "pydantic")}
VALIDATOR_ID = hashlib.sha256(json.dumps({"code": _CODE, "libraries": _LIBRARIES,
                                        "python": sys.version, "architecture": platform.machine()}, sort_keys=True).encode()).hexdigest()


def read_receipt(root, manifest_sha256):
    path = Path(root) / CACHE_NAME
    try:
        if path.is_symlink() or path.stat().st_size > 16384:
            return False
        record = json.loads(path.read_text())
        return (record.get("kind") == "neuroimage-geometry-validation-cache" and record.get("schema_version") == "1.0"
                and record.get("status") == "passed" and record.get("manifest_sha256") == manifest_sha256
                and record.get("validator_id") == VALIDATOR_ID)
    except (OSError, ValueError, AttributeError):
        return False


def write_receipt(root, manifest_sha256):
    """A read-only package remains usable when optional caching cannot be written."""
    temporary = None
    try:
        record = {"kind": "neuroimage-geometry-validation-cache", "schema_version": "1.0", "status": "passed",
                  "manifest_sha256": manifest_sha256, "validator_id": VALIDATOR_ID,
                  "validated_utc": datetime.now(timezone.utc).isoformat(),
                  "scope": "Engineering geometry and lesson checks after SHA256 verification of every declared asset; no anatomical expert judgment"}
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", prefix=".validation-", suffix=".partial", dir=root, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(record, stream, indent=2); stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, Path(root) / CACHE_NAME)
        return True
    except OSError:
        return False
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
