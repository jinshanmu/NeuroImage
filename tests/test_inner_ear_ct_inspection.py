"""Check source metadata interpretation without distributing acquired anatomy."""
import numpy as np
import pytest

h5py = pytest.importorskip("h5py")
from scripts.inspect_inner_ear_ct import describe, spatial_evidence


def create_source(path):
    source = h5py.File(path, "w")
    image = source.create_dataset("raw", shape=(8, 10, 12), dtype="i4")
    labels = source.create_dataset("labels", shape=image.shape, dtype="u1")
    directions = np.array([[0., .1, 0.], [-.2, 0., 0.], [0., 0., .3]])
    origin = np.array([20., -10., 5.])
    image.attrs.update({"space": "left-posterior-superior", "sizes": image.shape,
                        "space directions": directions, "space origin": origin})
    point = source.create_dataset("point", dtype="f8")
    index = np.array([2, 3, 4])
    point.attrs.update({"coordsys": "LPS", "ijk_position": index,
                        "xyz_position": origin + directions.T @ index, "label": "Test point"})
    return source, image, labels, point


def test_attribute_only_landmark_keeps_original_metadata(tmp_path):
    source, _, _, point = create_source(tmp_path / "source.hdf5")
    with source:
        description = describe(point)
        assert description["shape"] is None
        assert description["uncompressed_bytes"] == 0
        assert description["attributes"]["ijk_position"] == [2, 3, 4]


def test_rotated_anisotropic_grid_uses_axis_vectors_as_columns(tmp_path):
    source, image, labels, point = create_source(tmp_path / "source.hdf5")
    with source:
        report = spatial_evidence(image, labels, {"point": describe(point)})
        comparison = report["landmark_comparisons"][0]
        assert comparison["distance_mm"] == pytest.approx(0., abs=1e-12)
        assert comparison["within_half_voxel_diagonal"] is True
        np.testing.assert_allclose(comparison["xyz_to_continuous_ijk"], [2, 3, 4])
        np.testing.assert_allclose(report["spacing_mm"], [.1, .2, .3])


def test_original_disagreement_is_reported_without_moving_point(tmp_path):
    source, image, labels, point = create_source(tmp_path / "source.hdf5")
    with source:
        shifted = point.attrs["xyz_position"] + [1., 0., 0.]
        point.attrs.modify("xyz_position", shifted)
        report = spatial_evidence(image, labels, {"point": describe(point)})
        comparison = report["landmark_comparisons"][0]
        assert comparison["distance_mm"] == pytest.approx(1.)
        assert comparison["within_half_voxel_diagonal"] is False
        np.testing.assert_array_equal(point.attrs["xyz_position"], shifted)
        np.testing.assert_array_equal(point.attrs["ijk_position"], [2, 3, 4])


def test_unresolved_grid_or_coordinate_basis_requires_interpretation(tmp_path):
    source, image, labels, point = create_source(tmp_path / "source.hdf5")
    with source:
        image.attrs.modify("sizes", [10, 8, 12])
        with pytest.raises(ValueError, match="match the stored array"):
            spatial_evidence(image, labels, {"point": describe(point)})
        image.attrs.modify("sizes", image.shape)
        point.attrs.modify("coordsys", "RAS")
        with pytest.raises(ValueError, match="interpreted explicitly"):
            spatial_evidence(image, labels, {"point": describe(point)})
