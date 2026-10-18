"""Synthetic checks for errors that would change side, units or correspondence."""
import nibabel as nib
import nrrd
import numpy as np
import pytest
from neuroimage.geometry import NativeVolume, NiftiFrameReader, read_volume, save_nifti, surface_from_mask, save_surface
from neuroimage.contracts import Asset


@pytest.mark.parametrize("matrix", [np.diag([1.2, 1.5, 2., 1.]), np.array([[0., 0., -1.4, 40.], [-.8, 0., 0., 60.], [0., -1.2, 0., 80.], [0., 0., 0., 1.]]), np.array([[1., .15, 0., -18.], [0., 1.3, .2, -20.], [0., 0., 1.7, -30.], [0., 0., 0., 1.]])])
def test_nrrd_lps_to_ras_without_reordering(tmp_path, matrix):
    data = np.arange(7 * 9 * 11, dtype=np.int16).reshape(7, 9, 11)
    lps = np.diag([-1., -1., 1., 1.]) @ matrix
    path = tmp_path / "source.nrrd"
    nrrd.write(str(path), data, header={"space": "left-posterior-superior", "space directions": lps[:3, :3].T, "space origin": lps[:3, 3], "space units": ["mm"] * 3}, index_order="F")
    loaded = read_volume(path)
    assert np.array_equal(loaded.data, data)
    assert np.allclose(loaded.affine, matrix)
    target = tmp_path / "volume.nii.gz"
    save_nifti(loaded, target)
    roundtrip = read_volume(target)
    assert np.array_equal(roundtrip.data, data)
    assert np.allclose(roundtrip.affine, matrix, atol=1e-6)


@pytest.mark.parametrize("scale,unit", [(1000., "meter"), (.001, "micron"), (1., "mm")])
def test_nifti_units_are_converted_in_affine(tmp_path, scale, unit):
    a = np.diag([1.5, 2., 3., 1.]); a[:3, 3] = [-20, 10, 30]
    img = nib.Nifti1Image(np.ones((5, 6, 7), dtype=np.uint8), a)
    img.header.set_xyzt_units(unit)
    path = tmp_path / "units.nii"; nib.save(img, path)
    result = read_volume(path)
    assert np.allclose(result.affine[:3], a[:3] * scale)


def test_unknown_units_and_conflicting_forms_are_rejected(tmp_path):
    img = nib.Nifti1Image(np.ones((5, 6, 7), dtype=np.uint8), np.eye(4))
    path = tmp_path / "source.nii"; nib.save(img, path)
    with pytest.raises(ValueError, match="unit"):
        read_volume(path)
    assert read_volume(path, declared_nifti_units="mm").source_geometry["unit_basis"] == "recipe source documentation"
    img.header.set_xyzt_units("mm")
    other = np.eye(4); other[0, 3] = 25
    img.set_qform(other, code=1); nib.save(img, path)
    with pytest.raises(ValueError, match="Conflicting"):
        read_volume(path)


def test_streamed_channels_preserve_scaled_values_units_and_original_indices(tmp_path):
    data = np.arange(3 * 4 * 5 * 3, dtype=np.int16).reshape(3, 4, 5, 3)
    affine = np.diag([-700., 850., 1000., 1.]); affine[:3, 3] = [23000, -15000, 9000]
    image = nib.Nifti1Image(data, affine)
    image.header.set_xyzt_units("micron"); image.header.set_slope_inter(2., -3.)
    path = tmp_path / "scaled-channels.nii.gz"; nib.save(image, path)
    with NiftiFrameReader(path) as reader:
        for channel in (0, 1, 2, 0):
            native = reader.read(channel)
            assert np.array_equal(native.data, data[..., channel] * 2. - 3.)
            assert np.allclose(native.affine[:3], affine[:3] * .001)
            assert native.source_geometry["source_shape"] == [3, 4, 5, 3]
            assert native.source_geometry["source_channel"] == channel
            assert native.source_geometry == read_volume(path, frame=channel).source_geometry
    # Materialized channel data remain usable after the compressed stream closes.
    assert np.array_equal(native.data, data[..., 0] * 2. - 3.)
    with pytest.raises(ValueError, match="closed"):
        reader.read(0)


def test_streamed_channels_reject_unavailable_or_nonfinite_data(tmp_path):
    data = np.ones((3, 4, 5, 3), dtype=np.float32); data[1, 2, 3, 2] = np.nan
    image = nib.Nifti1Image(data, np.eye(4)); image.header.set_xyzt_units("mm")
    path = tmp_path / "invalid-channel.nii.gz"; nib.save(image, path)
    with NiftiFrameReader(path) as reader:
        assert np.array_equal(reader.read(0).data, data[..., 0])
        for unavailable in (-1, 3, None, True):
            with pytest.raises(ValueError, match="channel"):
                reader.read(unavailable)
        with pytest.raises(ValueError, match="finite"):
            reader.read(2)
        assert np.array_equal(reader.read(1).data, data[..., 1])


def test_asymmetric_mesh_and_focus_preserve_source_side(tmp_path):
    mask = np.zeros((12, 14, 16), dtype=bool); mask[1:4, 3:8, 4:12] = 1
    a = np.diag([-2., 1.5, 1., 1.]); a[:3, 3] = [7, -10, -15]
    vertices, faces, stats, qc = surface_from_mask(mask, a)
    expected_voxel = np.array([[.5, 2.5, 3.5], [3.5, 7.5, 11.5]])
    expected_ras = nib.affines.apply_affine(a, expected_voxel)
    assert np.allclose(vertices.min(axis=0), expected_ras.min(axis=0))
    assert np.allclose(vertices.max(axis=0), expected_ras.max(axis=0))
    target = np.rint(nib.affines.apply_affine(np.linalg.inv(a), stats["target_ras_mm"])).astype(int)
    assert mask[tuple(target)]
    assert stats["voxel_count"] == 120
    assert stats["volume_mm3"] == pytest.approx(360)
    assert qc["level_set_max_error"] == 0
    triangles = vertices[faces]
    assert np.einsum("ij,ij->i", triangles[:, 0], np.cross(triangles[:, 1], triangles[:, 2])).sum() > 0
    path = tmp_path / "surface.gii"; save_surface(vertices, faces, path)
    assert np.array_equal(nib.load(path).darrays[0].data, vertices)


def test_grid_edge_mask_is_padded_and_closed():
    mask = np.zeros((5, 6, 7), dtype=bool); mask[:2, :3, :4] = True
    vertices, faces, _, _ = surface_from_mask(mask, np.eye(4))
    assert vertices.min() == -.5
    edges = np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    assert np.all(counts == 2)


@pytest.mark.parametrize("reflection", [1., -1.])
def test_small_surface_volume_and_winding_survive_large_translation(reflection):
    from neuroimage.geometry import signed_surface_volume
    mask = np.zeros((20, 24, 28), dtype=bool)
    mask[3:14, 5:19, 4:23] = True
    affine = np.diag([reflection * .125, .125, .125, 1.])
    baseline_vertices, baseline_faces, _, baseline = surface_from_mask(mask, affine)
    affine[:3, 3] = [128., -256., 192.]
    vertices, faces, _, translated = surface_from_mask(mask, affine)
    np.testing.assert_array_equal(vertices - affine[:3, 3], baseline_vertices)
    np.testing.assert_array_equal(faces, baseline_faces)
    assert translated["surface_volume_mm3"] == pytest.approx(baseline["surface_volume_mm3"], abs=1e-12)
    assert signed_surface_volume(vertices, faces) > 0


@pytest.mark.parametrize("path", ["../raw/data.nii", "/etc/passwd", "foo/../../x", "foo\\x", "https://example.org/x", "a//b"])
def test_manifest_paths_cannot_escape(path):
    with pytest.raises(ValueError):
        Asset(path=path, role="image", bytes=1, sha256="0" * 64)
