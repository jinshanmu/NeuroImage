"""Asymmetric trajectory fixtures exercise formats, provenance and recovery."""
import json
from pathlib import Path
import struct
import nibabel as nib
import numpy as np
import pytest

from neuroimage import build as pipeline
from neuroimage.adapters import ImportedDataset
from neuroimage.contracts import Manifest
from neuroimage.streamlines import read_trackvis, subset_indices, tck_arrays, write_tck


def write_source(path, points):
    # Anisotropic, reflected TrackVis header with nonzero translation. Input
    # trajectories are known RAS-mm coordinates, not already encoded voxel-mm.
    header = nib.streamlines.TrkFile.create_empty_header()
    header.update(dimensions=np.array([32, 24, 20]), voxel_sizes=np.array([2., 1.5, 3.]),
                  voxel_to_rasmm=np.array([[-2., 0, 0, 24], [0, 1.5, 0, -18], [0, 0, 3., -20], [0, 0, 0, 1]]),
                  voxel_order=b"LAS")
    nib.streamlines.TrkFile(nib.streamlines.Tractogram(points, affine_to_rasmm=np.eye(4)), header=header).save(path)


@pytest.fixture
def tract_source(tmp_path, monkeypatch):
    paths, structures = {}, []
    expected = {}
    for ident, side, sign in (("L", "left", -1), ("R", "right", 1)):
        points = [np.array([[sign * (7 + i % 4 / 4), -5., -3.], [sign * 6., 0., 0.], [sign * 4., 6., 5.]], dtype=np.float32) for i in range(300)]
        path = tmp_path / (ident + ".trk"); write_source(path, points)
        paths[ident] = path; expected[ident] = points
        structures.append({"kind": "streamline-bundle", "id": "test:bundle:" + ident, "source_input": ident,
            "name": side.title() + " synthetic trajectories", "source_name": ident, "laterality": side,
            "category": "Synthetic trajectories", "color": [100, 150, 200], "evidence": "Generated test trajectories; not anatomy", "source_notes": []})
    image = nib.Nifti1Image(np.arange(32 * 24 * 20, dtype=np.float32).reshape(32, 24, 20),
                           np.array([[1., 0, 0, -16], [0, 1.5, 0, -18], [0, 0, 2., -20], [0, 0, 0, 1]]))
    image.header.set_xyzt_units("mm")
    paths["t1"] = tmp_path / "t1.nii.gz"; nib.save(image, paths["t1"])
    paths["license"] = tmp_path / "license.txt"; paths["license"].write_text("Generated test source. CC0.\n")
    recipe = {"id": "tract_test", "version": "1", "source_version": "1", "title": "Synthetic trajectory fixture", "representation": "mri-streamlines",
              "inputs": {key: path.name for key, path in paths.items()}, "images": [{"id": "t1", "name": "Generated reference"}],
              "space": {"id": "test-ras", "name": "Test RAS", "reference": "Generated trajectories", "correspondence": "Known synthetic coordinates"},
              "sources": [{"id": "test", "title": "Synthetic source", "version": "1", "url": "https://example.org/test", "citation": "Generated tests",
                           "license_name": "CC0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/", "license_input": "license"}]}
    imported = ImportedDataset(recipe, paths, structures)
    monkeypatch.setattr(pipeline, "import_dataset", lambda *args: imported)
    return tmp_path, imported, expected


def construct(source):
    return pipeline.build_atlas("tract_test", source[0], workers=2, minimum_free_gib=0)


def test_independent_trackvis_affine_and_canonical_tck(tract_source):
    root, imported, expected = tract_source
    for ident in ("L", "R"):
        tracts, record = read_trackvis(imported.input_paths[ident])
        assert record["voxel_order"] == "LAS"
        assert record["independent_decoder_max_error_mm"] < 1e-4
        np.testing.assert_allclose(tracts.get_data(), np.concatenate(expected[ident]), atol=1e-5)
        path = root / (ident + ".tck"); write_tck(path, tracts)
        independent = nib.streamlines.TckFile.load(path).streamlines
        np.testing.assert_array_equal(independent.get_data(), tracts.get_data())
        with tck_arrays(path) as (data, starts, ends):
            assert len(starts) == 300
            np.testing.assert_array_equal(data[starts[-1]:ends[-1]], expected[ident][-1])


@pytest.mark.parametrize("count", [1, 250, 300, 2397, 34156])
def test_nested_subset_indices_retain_complete_trajectories(count):
    preview, standard, detail = [subset_indices(count, n) for n in (256, 1024, 4096)]
    assert set(preview) <= set(standard) <= set(detail) <= set(range(count))
    assert all(len(set(values)) == len(values) for values in (preview, standard, detail))
    assert preview[0] == standard[0] == detail[0] == 0


def test_trackvis_rejects_conflicting_header_and_nonfinite_points(tract_source):
    root, imported, _ = tract_source
    original = imported.input_paths["L"].read_bytes()
    path = root / "bad.trk"
    for offset, replacement, message in [(948, b"RAS\0", "voxel order"), (36, struct.pack("<h", 1), "scalars"),
                                          (1004, struct.pack("<f", float("nan")), "Nonfinite")]:
        content = bytearray(original); content[offset:offset + len(replacement)] = replacement; path.write_bytes(content)
        with pytest.raises(ValueError, match=message): read_trackvis(path)
    path.write_bytes(original[:-3])
    with pytest.raises((ValueError, OSError)): read_trackvis(path)


def test_streamline_build_geometry_subsets_and_resume(tract_source, monkeypatch):
    path = construct(tract_source)
    manifest = pipeline.validate_package(path)
    assert manifest.representation == "mri-streamlines" and manifest.schema_version == "1.3"
    assert all(volume.kind == "image" for volume in manifest.volumes)
    assert not any(asset.role in ("mesh", "labels") for asset in manifest.assets)
    assert all(s.streamlines.source_streamline_count == 300 and s.streamlines.source_point_count == 900 for s in manifest.structures)
    assert manifest.structures[0].target_ras_mm[0] < 0 < manifest.structures[1].target_ras_mm[0]
    assets = {a.path: a.sha256 for a in manifest.assets}
    from neuroimage import streamline_build
    monkeypatch.setattr(streamline_build, "read_trackvis", lambda *_: pytest.fail("Complete package must not decode the source again"))
    assert construct(tract_source) == path
    assert {a.path: a.sha256 for a in pipeline.validate_package(path).assets} == assets


def test_streamline_resume_repairs_only_missing_assets(tract_source):
    path = construct(tract_source)
    manifest = pipeline.validate_package(path)
    stamps = {a.path: (path.parent / a.path).stat().st_mtime_ns for a in manifest.assets}
    missing = next(a for a in manifest.assets if a.path.endswith("L-standard.tck"))
    (path.parent / missing.path).unlink()
    assert construct(tract_source) == path
    restored = pipeline.validate_package(path)
    assert {a.path: a.sha256 for a in restored.assets} == {a.path: a.sha256 for a in manifest.assets}
    assert all((path.parent / a.path).stat().st_mtime_ns == stamps[a.path] for a in manifest.assets if a.path != missing.path)


def test_geometry_rejects_changed_indices_target_or_evidence(tract_source):
    path = construct(tract_source)
    original = json.loads(path.read_text())
    changed = json.loads(path.read_text()); changed["structures"][0]["target_ras_mm"][0] += 1
    path.write_text(json.dumps(changed))
    with pytest.raises(ValueError, match="target"): pipeline.validate_package(path)
    changed = json.loads(json.dumps(original)); changed["structures"][0]["streamlines"]["decoded_ras_sha256"] = "0" * 64
    path.write_text(json.dumps(changed))
    with pytest.raises(ValueError, match="coordinates or ordering"): pipeline.validate_package(path)
    path.write_text(json.dumps(original))
    level = original["structures"][0]["streamlines"]["levels"][0]
    index_path = path.parent / level["indices_file"]
    record = json.loads(index_path.read_text()); record["indices"].reverse(); index_path.write_text(json.dumps(record))
    from neuroimage.validation import validate_geometry
    with pytest.raises(ValueError, match="display subset"): validate_geometry(Manifest.model_validate(original), path.parent)


def test_streamline_contract_rejects_fake_labels_and_old_schema(tract_source):
    path = construct(tract_source)
    value = json.loads(path.read_text()); value["structures"][0]["label_value"] = 1
    with pytest.raises(ValueError): Manifest.model_validate(value)
    value = json.loads(path.read_text()); value["schema_version"] = "1.2"
    with pytest.raises(ValueError, match="schema 1.3"): Manifest.model_validate(value)


def test_tck_reader_rejects_invalid_delimiters(tmp_path):
    path = tmp_path / "invalid.tck"
    write_tck(path, [np.array([[1., 2., 3.], [4., 5., 6.]])])
    data = bytearray(path.read_bytes()); data[-4:] = struct.pack("<f", 0.); path.write_bytes(data)
    with pytest.raises(ValueError, match="termination"):
        with tck_arrays(path): pass
