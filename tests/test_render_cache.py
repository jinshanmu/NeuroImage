"""Browser caches preserve original membership and complete float32 geometry."""
import hashlib
import json
import struct
import gzip

import nibabel as nib
import numpy as np
import pytest

from neuroimage.render_cache import RenderCache
from neuroimage.validation import validate_package
from test_independent_regions import region_source, construct


def test_lossless_masks_meshes_reuse_and_corruption_repair(region_source, tmp_path, monkeypatch):
    path = construct(region_source)
    manifest = validate_package(path)
    cache = RenderCache(tmp_path / "cache")
    metadata, files = cache.prepare(path, manifest)
    original_hashes = {asset.path: hashlib.sha256((path.parent / asset.path).read_bytes()).hexdigest() for asset in manifest.assets}
    for item in manifest.structures:
        volume = next(v for v in manifest.volumes if v.id == item.mask.volume_id)
        sparse = files[metadata[volume.file]["file"]].read_bytes()
        assert struct.unpack("<4sI", sparse[:8]) == (b"NIM1", item.voxel_count)
        expected = np.flatnonzero(np.asanyarray(nib.load(path.parent / volume.file).dataobj).ravel(order="F"))
        np.testing.assert_array_equal(np.frombuffer(sparse, "<u4", offset=8), expected)
        binary = gzip.decompress(files[metadata[item.mesh_file]["file"]].read_bytes())
        source = nib.load(path.parent / item.mesh_file)
        points, triangles = source.agg_data("pointset"), source.agg_data("triangle")
        assert struct.unpack("<4sIII", binary[:16]) == (b"NGM2", len(triangles), len(points), 16)
        indices = np.cumsum(np.frombuffer(binary, "<u4", count=triangles.size, offset=16), dtype=np.uint32)
        np.testing.assert_array_equal(indices.reshape(-1, 3), triangles)
        words = np.frombuffer(binary, "<u4", offset=16 + triangles.size * 4).reshape(4, -1)
        vertices = np.ascontiguousarray(np.cumsum(words, axis=1, dtype=np.uint32).T).view("<f4")
        np.testing.assert_array_equal(vertices[:, :3], points)
    with monkeypatch.context() as patch:
        patch.setattr(nib.gifti.GiftiImage, "from_bytes", lambda *_a, **_k: pytest.fail("Reparsed cached geometry"))
        patch.setattr(nib.Nifti1Image, "from_bytes", lambda *_a, **_k: pytest.fail("Reparsed cached mask"))
        assert cache.prepare(path, manifest) == (metadata, files)
        assert RenderCache(tmp_path / "cache").prepare(path, manifest) == (metadata, files)
    damaged = next(file for file in files.values() if file.is_relative_to(cache.root))
    original = damaged.read_bytes()
    damaged.write_bytes(b"x" * len(original))
    assert cache.prepare(path, manifest) == (metadata, files)
    assert damaged.read_bytes() == original
    receipt = damaged.with_suffix(damaged.suffix + ".json")
    record = json.loads(receipt.read_text())
    record["source_sha256"] = "0" * 64
    receipt.write_text(json.dumps(record))
    cache.prepare(path, manifest)
    assert json.loads(receipt.read_text())["source_sha256"] != "0" * 64
    assert original_hashes == {asset.path: hashlib.sha256((path.parent / asset.path).read_bytes()).hexdigest() for asset in manifest.assets}


def test_cache_rejects_modified_source_and_nonbinary_masks(region_source, tmp_path):
    path = construct(region_source)
    manifest = json.loads(path.read_text())
    volume = next(v for v in manifest["volumes"] if v["kind"] == "mask")
    source = path.parent / volume["file"]
    image = nib.load(source)
    values = np.asanyarray(image.dataobj).copy()
    values[0, 0, 0] = 2
    nib.save(nib.Nifti1Image(values, image.affine), source)
    cache = RenderCache(tmp_path / "cache")
    with pytest.raises(ValueError, match="checksum"):
        cache.prepare(path, manifest)
    next(a for a in manifest["assets"] if a["path"] == volume["file"])["sha256"] = hashlib.sha256(source.read_bytes()).hexdigest()
    with pytest.raises(ValueError, match="binary"):
        cache.prepare(path, manifest)
