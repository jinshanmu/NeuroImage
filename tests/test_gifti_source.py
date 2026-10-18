"""Protect supplied GIfTI indexing, coordinate metadata and metric conversion."""
import json

import nibabel as nib
import numpy as np
import pytest

from neuroimage.build import sha256
from neuroimage.gifti_extract import extract_source, read_source_gifti
from neuroimage.model_geometry import read_source_geometry


def source(path):
    points = np.array([[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, .000001]], dtype=np.float32)
    faces = np.array([[2, 1, 0], [3, 2, 0]], dtype=np.int32)
    image = nib.gifti.GiftiImage(darrays=[
        nib.gifti.GiftiDataArray(points, intent="NIFTI_INTENT_POINTSET"),
        nib.gifti.GiftiDataArray(faces, intent="NIFTI_INTENT_TRIANGLE")])
    image.darrays[0].meta["AnatomicalStructurePrimary"] = "SyntheticFixture"
    image.darrays[0].coordsys.xform[:3, 3] = [5, 6, 7]
    nib.save(image, path)
    return image


@pytest.mark.parametrize("suffix", [".gii", ".gii.gz"])
def test_raw_coordinates_winding_and_metadata_survive_without_registration(tmp_path, suffix):
    path = tmp_path / ("source" + suffix)
    image = source(path)
    item = {"key": "original", "source_name": path.name, "source_type": "MESH"}
    extract_source(path, tmp_path, item, sha256(path), 1000)
    original, triangles, transform, native, rounding = read_source_geometry(tmp_path / "original.npz")
    assert np.array_equal(original, image.darrays[0].data)
    assert np.array_equal(triangles, image.darrays[1].data)
    assert np.array_equal(transform, np.diag([1000, 1000, 1000, 1]))
    assert np.array_equal(native, (original.astype(float) * 1000).astype(np.float32))
    metadata = json.loads((tmp_path / "original.json").read_text())["source_metadata"]
    assert metadata["coordinate_system"]["xform"][0][3] == 5
    assert metadata["points"]["AnatomicalStructurePrimary"] == "SyntheticFixture"


@pytest.mark.parametrize("change", ["nonfinite", "bad_index", "missing_array", "duplicate_array", "external"])
def test_incomplete_or_unpinned_geometry_is_rejected(tmp_path, change):
    path = tmp_path / "source.gii"
    image = source(path)
    if change == "nonfinite": image.darrays[0].data[0, 0] = np.nan
    elif change == "bad_index": image.darrays[1].data[0, 0] = 4
    elif change == "missing_array": image.darrays.pop()
    elif change == "duplicate_array": image.darrays.append(image.darrays[0])
    nib.save(image, path)
    if change == "external":
        path.write_text(path.read_text().replace('ExternalFileName=""', 'ExternalFileName="unhashed.bin"', 1))
    with pytest.raises(ValueError): read_source_gifti(path)
