"""Verify exact source STL preservation and invalid-input rejection."""
import json
from pathlib import Path

import numpy as np
import pytest

from neuroimage.build import sha256
from neuroimage.model_geometry import read_source_geometry
from neuroimage.stl_extract import extract_source, read_binary_stl


def fixture(path):
    dtype = np.dtype([("normal", "<f4", (3,)), ("vertices", "<f4", (3, 3)), ("attribute", "<u2")])
    facets = np.zeros(2, dtype=dtype)
    facets["vertices"] = [[[0, 0, 0], [2, 0, 0], [2, 3, 0]], [[0, 0, 0], [2, 3, 0], [0, 3, .000001]]]
    path.write_bytes(b"Synthetic geometry, not anatomy".ljust(80, b" ") + (2).to_bytes(4, "little") + facets.tobytes())
    return facets


def test_source_facets_winding_and_small_features_survive_indexing(tmp_path):
    path = tmp_path / "source.stl"
    facets = fixture(path)
    points, faces, _ = read_binary_stl(path)
    assert len(points) == 4
    assert np.array_equal(points[faces], facets["vertices"])
    item = {"key": "original", "source_name": "source.stl", "source_type": "MESH"}
    extract_source(path, tmp_path, item, sha256(path), 1)
    original, triangles, transform, native, rounding = read_source_geometry(tmp_path / "original.npz")
    assert np.array_equal(native[triangles], facets["vertices"])
    assert np.array_equal(transform, np.eye(4)) and rounding == 0
    provenance = json.loads((tmp_path / "original.json").read_text())
    assert provenance["source_facet_coordinates_preserved"]
    assert provenance["source_sha256"] == sha256(path)


@pytest.mark.parametrize("change", ["truncated", "trailing", "nonfinite", "empty"])
def test_invalid_source_stl_is_rejected(tmp_path, change):
    path = tmp_path / "source.stl"
    facets = fixture(path)
    data = path.read_bytes()
    if change == "truncated": data = data[:-1]
    elif change == "trailing": data += b"unexpected"
    elif change == "empty": data = data[:80] + (0).to_bytes(4, "little")
    else:
        facets["vertices"][0, 0, 0] = np.nan
        data = data[:84] + facets.tobytes()
    path.write_bytes(data)
    with pytest.raises(ValueError): read_binary_stl(path)
