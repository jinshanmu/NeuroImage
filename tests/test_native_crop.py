"""Exact source-index cropping preserves samples and physical positions."""
import json
import nibabel as nib
import numpy as np
import pytest

from neuroimage.geometry import NativeVolume, crop_native_volume


def test_native_crop_preserves_asymmetric_rotated_grid():
    data = np.arange(11 * 13 * 17, dtype=np.float32).reshape(11, 13, 17)
    affine = np.array([[0, -2, 0, 18], [-1.5, 0, 0, 9], [0, 0, 3, -32], [0, 0, 0, 1.]])
    original = NativeVolume(data, affine, {"format": "generated"})
    result = crop_native_volume(original, {"start": [2, 3, 4], "shape": [6, 7, 8], "evidence": "Known fixture subarray"})
    np.testing.assert_array_equal(result.data, data[2:8, 3:10, 4:12])
    for point in ([0, 0, 0], [5, 6, 7], [2, 4, 3]):
        np.testing.assert_array_equal(result.affine @ [*point, 1], affine @ [*(np.array(point) + [2, 3, 4]), 1])
    assert np.shares_memory(data, result.data)
    assert result.source_geometry["native_crop"]["source_shape"] == [11, 13, 17]
    assert original.source_geometry == {"format": "generated"}
    np.testing.assert_array_equal(original.affine, affine)


@pytest.mark.parametrize("change", [
    {"start": [-1, 2, 3]}, {"start": [True, 2, 3]}, {"start": [1.5, 2, 3]},
    {"shape": [100, 4, 5]}, {"shape": [4, 1, 5]}, {"shape": [4, 5]}, {"evidence": ""},
])
def test_native_crop_rejects_implicit_or_invalid_indices(change):
    volume = NativeVolume(np.ones((11, 13, 17)), np.eye(4), {})
    spec = {"start": [1, 2, 3], "shape": [4, 5, 6], "evidence": "Known source correspondence", **change}
    with pytest.raises(ValueError, match="Native crop"):
        crop_native_volume(volume, spec)


from test_independent_regions import region_source, construct
from neuroimage.validation import validate_package

def test_explicit_reference_crop_matches_original_source_fields(region_source):
    root, imported = region_source
    original_path = imported.input_paths["t2"]
    original = nib.load(original_path)
    values = np.asanyarray(original.dataobj).copy()
    start = np.array([2, 3, 4])
    full = np.zeros((13, 17, 21), dtype=values.dtype)
    full[2:11, 3:14, 4:17] = values
    full_affine = original.affine.copy()
    full_affine[:3, 3] -= full_affine[:3, :3] @ start
    reference = nib.Nifti1Image(full, full_affine)
    reference.header.set_xyzt_units("mm")
    nib.save(reference, original_path)
    source_bytes = original_path.read_bytes()
    imported.recipe["images"][0]["native_crop"] = {
        "start": start.tolist(), "shape": list(values.shape), "evidence": "Explicit generated common source frame"}
    path = construct(region_source)
    manifest = validate_package(path)
    output = next(v for v in manifest.volumes if v.id == "t2")
    restored = nib.load(path.parent / output.file)
    np.testing.assert_array_equal(restored.dataobj, values)
    np.testing.assert_array_equal(restored.affine, original.affine)
    assert original_path.read_bytes() == source_bytes
    assert manifest.build["parameters"]["resampling"] == "none"
    report = json.loads((path.parent / "validation.json").read_text())
    assert report["reference_geometry"]["native_crop"]["start"] == [2, 3, 4]

