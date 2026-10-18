"""Check exact CT sampling, explicit modality and independently known HDF5 axes."""
import copy
import json
import nibabel as nib
import numpy as np
import pytest

h5py = pytest.importorskip("h5py")
from neuroimage import adapters
from neuroimage.build import build_atlas
from neuroimage.contracts import Manifest
from neuroimage.hdf5_source import read_hdf5_volume, validate_hdf5_labels
from neuroimage.validation import validate_package


@pytest.fixture
def source(tmp_path):
    shape = (13, 15, 17)
    image = (np.arange(np.prod(shape), dtype=np.int32).reshape(shape) - 1000)
    labels = np.zeros(shape, dtype=np.uint8)
    labels[2:6, 3:9, 4:13] = 1
    labels[8:11, 6:12, 2:9] = 2
    # Independent non-axial, anisotropic source coordinates.
    directions = np.array([[0, .4, 0], [-.6, 0, 0], [.01, .02, .8]])
    origin = np.array([17., -28., 39.])
    path = tmp_path / "original.hdf5"
    with h5py.File(path, "w") as handle:
        raw = handle.create_dataset("raw/raw-0", data=image)
        raw.attrs.update({"space": "left-posterior-superior", "sizes": shape,
                          "space directions": directions, "space origin": origin})
        segmentation = handle.create_dataset("label/label-0", data=labels)
        for value, name in enumerate(["Background", "First", "Second"]):
            segmentation.attrs.update({f"Segment{value}_LabelValue": value,
                f"Segment{value}_Name": name, f"Segment{value}_Color": [1., .4, .2]})
    spec = {"dataset": "raw/raw-0", "geometry_dataset": "raw/raw-0", "array_axis_order": "IJK",
            "units": "mm", "unit_basis": "Known fixture units", "grid_correspondence": "Explicit paired fixture grid"}
    return path, image, labels, spec, directions, origin


def test_hdf5_independent_world_coordinates_and_original_samples(source):
    path, image, labels, spec, directions, origin = source
    for node, values in [("raw/raw-0", image), ("label/label-0", labels)]:
        volume = read_hdf5_volume(path, {**spec, "dataset": node})
        assert np.array_equal(volume.data, values)
        assert volume.data.dtype == values.dtype
        for index in [(0, 0, 0), (1, 6, 8), (12, 14, 16)]:
            expected_lps = origin + sum(index[axis] * directions[axis] for axis in range(3))
            assert np.allclose(nib.affines.apply_affine(volume.affine, index), expected_lps * [-1, -1, 1], rtol=0, atol=1e-12)
    with pytest.raises(ValueError, match="millimeter evidence"):
        read_hdf5_volume(path, {**spec, "unit_basis": ""})
    with h5py.File(path, "a") as handle:
        handle["raw/raw-0"].attrs["sizes"] = [15, 13, 17]
    with pytest.raises(ValueError, match="paired source grid"):
        read_hdf5_volume(path, spec)


@pytest.mark.parametrize("kind", ["soft", "external", "virtual"])
def test_hdf5_rejects_indirect_samples(source, kind):
    path, _, _, spec, _, _ = source
    with h5py.File(path, "a") as handle:
        if kind == "soft":
            handle["alias"] = h5py.SoftLink("/raw/raw-0")
        elif kind == "external":
            handle["alias"] = h5py.ExternalLink("unrelated.hdf5", "/image")
        else:
            layout = h5py.VirtualLayout(shape=(13, 15, 17), dtype=np.int32)
            layout[:] = h5py.VirtualSource(str(path), "/raw/raw-0", shape=layout.shape)
            handle.create_virtual_dataset("alias", layout)
    with pytest.raises(ValueError, match="internal"):
        read_hdf5_volume(path, {**spec, "dataset": "alias"})


@pytest.mark.parametrize("small_grid", [False, True])
def test_complete_ct_pipeline_contract_and_resume(source, monkeypatch, capsys, small_grid):
    path, image, labels, spec, _, _ = source
    if small_grid:
        with h5py.File(path, "a") as handle:
            handle["raw/raw-0"].attrs["space origin"] = [-103.86569055122003, -181.7808760636599, -171.62070375918998]
            handle["raw/raw-0"].attrs["space directions"] = [[.09863264321741368, .00000031943540637181053, -.00018273889707509845],
                [.000000008053342411132755, .09863265411241273, .00017676085887395528],
                [.00018273917609080796, -.00017676057042150876, .09863248483007425]]
    root = path.parent
    (root / "license.txt").write_text("Generated code-only test fixture, CC0.\n")
    recipe = copy.deepcopy(adapters.load_recipe("inner_ear_ct_specimen1"))
    recipe.update(id="ct_fixture", title="Generated CT pipeline fixture", teaching_sequences=[],
                  inputs={"ct": path.name, "labels": path.name, "license": "license.txt"},
                  hdf5_volumes={"ct": spec, "labels": {**spec, "dataset": "label/label-0"}},
                  selection=[{"value": value, "source_name": name, "name": name,
                              "category": "Fixture", "color": [255, 102, 51], "evidence": "Generated fixture"}
                             for value, name in [(1, "First"), (2, "Second")]])
    monkeypatch.setattr(adapters, "load_recipe", lambda _: recipe)
    manifest_path = build_atlas("ct_fixture", root, minimum_free_gib=0)
    manifest = validate_package(manifest_path)
    assert manifest.schema_version == "1.10" and manifest.representation == "ct-labels"
    for volume in manifest.volumes:
        actual = nib.load(manifest_path.parent / volume.file)
        assert np.array_equal(actual.dataobj, labels if volume.kind == "labels" else image)
    assert manifest.volumes[0].image_evidence.modality == "CT"
    from neuroimage.validation import validate_geometry
    invalid = manifest.model_copy(deep=True)
    invalid.volumes[0].image_evidence.intensity_units = "Invented calibrated units"
    with pytest.raises(ValueError, match="declared original source"):
        validate_geometry(invalid, manifest_path.parent)
    for change in ["implicit_modality", "mri_claim", "mismatched_grid", "old_schema"]:
        invalid = manifest.model_dump()
        if change == "implicit_modality": invalid["volumes"][0]["image_evidence"] = None
        if change == "mri_claim": invalid["representation"] = "mri-labels"
        if change == "mismatched_grid": invalid["volumes"][0]["affine_ras_mm"][0][3] += .1
        if change == "old_schema": invalid["schema_version"] = "1.2"
        with pytest.raises(ValueError, match="CT"):
            Manifest.model_validate(invalid)
    capsys.readouterr()
    assert build_atlas("ct_fixture", root, minimum_free_gib=0) == manifest_path
    event = json.loads(capsys.readouterr().out.strip())
    assert event["geometry_recomputed"] is False
    recipe["selection"][0]["source_name"] = "Invented subdivision"
    with pytest.raises(ValueError, match="original name"):
        validate_hdf5_labels(path, recipe["hdf5_volumes"]["labels"], recipe["selection"])
