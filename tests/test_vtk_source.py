"""Retain original binary VTK surfaces and reject unsupported source schemas."""
import hashlib
import json
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest

from neuroimage import adapters
from neuroimage.adapters import load_recipe
from neuroimage.build import build_atlas, sha256
from neuroimage.model_geometry import read_source_geometry
from neuroimage.validation import validate_package
from neuroimage.vtk_extract import extract_source, read_source_vtk


ROOT = Path(__file__).resolve().parents[1]


def _source(path, *, points=None, triangles=None, attributes=True):
    points = np.asarray(points if points is not None else
                        [[0., 0., 0.], [2., 0., 0.], [2., 3., 0.], [0., 3., .000001]], dtype=np.float32)
    triangles = np.asarray(triangles if triangles is not None else [[2, 1, 0], [3, 2, 0]], dtype=np.int32)
    cells = np.column_stack([np.full(len(triangles), 3), triangles]).astype(">i4")
    payload = (b"# vtk DataFile Version 4.1\nSynthetic fixture\nBINARY\nDATASET POLYDATA\n"
               + f"POINTS {len(points)} float\n".encode() + points.astype(">f4").tobytes() + b"\n"
               + f"POLYGONS {len(triangles)} {len(triangles) * 4}\n".encode() + cells.tobytes() + b"\n")
    if attributes:
        payload += (b"CELL_DATA 2\nFIELD FieldData 1\nvtkOriginalCellIds 1 2 vtkIdType\n"
                    + np.asarray([7, 8], dtype=">i4").tobytes() + b"\n"
                    + b"POINT_DATA 4\nSCALARS Labels int\nLOOKUP_TABLE default\n"
                    + np.asarray([1, 1, 2, 2], dtype=">i4").tobytes() + b"\n"
                    + b"METADATA\nINFORMATION 0\n\nNORMALS TubeNormals float\n"
                    + np.tile(np.asarray([0., 0., 1.], dtype=">f4"), (4, 1)).astype(">f4").tobytes() + b"\n"
                    + b"FIELD FieldData 1\nvtkOriginalPointIds 1 4 vtkIdType\n"
                    + np.asarray([23, 24, 25, 26], dtype=">i4").tobytes() + b"\n")
    path.write_bytes(payload)
    return points, triangles


@pytest.mark.parametrize("attributes", [False, True])
def test_binary_source_points_and_original_triangle_order_are_exact(tmp_path, attributes):
    path = tmp_path / "source.vtk"
    expected, faces = _source(path, attributes=attributes)
    points, triangles, metadata = read_source_vtk(path)
    assert points.dtype == np.float32 and triangles.dtype == np.int32
    assert np.array_equal(points, expected) and np.array_equal(triangles, faces)
    assert metadata["format"] == "legacy VTK 4.1 BINARY POLYDATA"
    assert metadata["source_point_order_and_triangle_winding_preserved"]
    assert len(metadata["source_attributes"]) == (4 if attributes else 0)


def test_source_attribute_arrays_and_geometry_survive_retention_without_surface_changes(tmp_path):
    path = tmp_path / "source.vtk"
    points, triangles = _source(path)
    extract_source(path, tmp_path, {"key": "retained", "source_name": path.name, "source_type": "MESH"}, sha256(path), 1.)
    original, faces, transform, native, rounding = read_source_geometry(tmp_path / "retained.npz")
    assert np.array_equal(original, points) and np.array_equal(native, points)
    assert np.array_equal(faces, triangles) and np.array_equal(transform, np.eye(4)) and rounding == 0
    with np.load(tmp_path / "retained.npz", allow_pickle=False) as retained:
        assert np.array_equal(retained["source_cell_vtkOriginalCellIds"].ravel(), [7, 8])
        assert np.array_equal(retained["source_point_vtkOriginalPointIds"].ravel(), [23, 24, 25, 26])
        assert np.array_equal(retained["source_point_Labels"].ravel(), [1, 1, 2, 2])
        assert np.array_equal(retained["source_point_TubeNormals"], np.tile([0., 0., 1.], (4, 1)))
    provenance = json.loads((tmp_path / "retained.json").read_text())
    assert provenance["source_sha256"] == sha256(path)
    assert provenance["source_geometry_sha256"] == sha256(tmp_path / "retained.npz")
    labels = next(item for item in provenance["source_metadata"]["source_attributes"] if item["name"] == "Labels")
    assert labels["source_binary_sha256"] == hashlib.sha256(np.asarray([1, 1, 2, 2], dtype=">i4").tobytes()).hexdigest()


@pytest.mark.parametrize("change", [
    "ascii", "version", "dataset", "double", "lines", "strip", "quad_count", "truncated",
    "bad_attribute_count", "unsupported_attribute_type", "metadata", "unknown_section",
])
def test_unsupported_or_incomplete_source_schema_is_rejected(tmp_path, change):
    path = tmp_path / "source.vtk"
    _source(path)
    payload = path.read_bytes()
    replacements = {
        "ascii": (b"BINARY", b"ASCII"), "version": (b"Version 4.1", b"Version 5.1"),
        "dataset": (b"DATASET POLYDATA", b"DATASET UNSTRUCTURED_GRID"),
        "double": (b"POINTS 4 float", b"POINTS 4 double"),
        "lines": (b"POLYGONS 2 8", b"LINES 2 8"), "strip": (b"POLYGONS 2 8", b"TRIANGLE_STRIPS 2 8"),
        "quad_count": (b"POLYGONS 2 8", b"POLYGONS 2 10"),
        "bad_attribute_count": (b"POINT_DATA 4", b"POINT_DATA 5"),
        "unsupported_attribute_type": (b"SCALARS Labels int", b"SCALARS Labels double"),
        "metadata": (b"INFORMATION 0", b"INFORMATION 1"),
    }
    if change == "truncated":
        payload = payload[:120]
    elif change == "unknown_section":
        payload += b"VERTICES 1 2\n"
    else:
        before, after = replacements[change]
        payload = payload.replace(before, after, 1)
    path.write_bytes(payload)
    with pytest.raises(ValueError):
        read_source_vtk(path)


@pytest.mark.parametrize("change", ["nonfinite", "bad_index", "degenerate"])
def test_invalid_original_geometry_is_rejected_without_repair(tmp_path, change):
    path = tmp_path / "source.vtk"
    points, triangles = _source(path)
    if change == "nonfinite":
        points[0, 0] = np.nan
    elif change == "bad_index":
        triangles[0, 0] = len(points)
    else:
        triangles[0, 0] = triangles[0, 1]
    _source(path, points=points, triangles=triangles)
    with pytest.raises(ValueError):
        read_source_vtk(path)


def test_spl_sulci_configuration_uses_all_canonical_source_models_once():
    recipe = load_recipe("spl_nac_sulci")
    audit = json.loads((ROOT / "config/spl-nac-sulci-source-inventory-2026-10-26.json").read_text())
    assert recipe["adapter"] == "vtk-source-surfaces" and recipe["representation"] == "surface-model"
    assert recipe["space"]["coordinate_system"] == "SOURCE_XYZ" and recipe["source_to_mm"] == 1
    assert recipe["space"]["units"] == "mm" and recipe["space"]["unit_basis"]
    assert len(recipe["objects"]) == len({item["input"] for item in recipe["objects"]}) == 22
    assert {item["id"] for item in recipe["objects"]} == {f"spl_nac_sulci:object:{value}" for value in range(5001, 5023)}
    assert all(item["source_name"].endswith("sulcus1.vtk") for item in recipe["objects"])
    assert all(Path(recipe["inputs"][item["input"]]).name == item["source_name"] for item in recipe["objects"])
    assert audit["source_point_count"] == 44760 and audit["source_triangle_count"] == 87888
    assert audit["source_line_count"] == audit["source_strip_count"] == 0
    assert all(item["independent_vtk_reader_points_and_topology_exact"] for item in audit["structures"])


def test_vtk_adapter_builds_an_independent_native_model_with_exact_geometry(tmp_path, monkeypatch):
    path = tmp_path / "source.vtk"
    points, triangles = _source(path)
    (tmp_path / "license.txt").write_text("Synthetic regression fixture; CC0.\n")
    recipe = {"id": "vtk_test", "adapter": "vtk-source-surfaces", "version": "1", "title": "Synthetic surface",
              "representation": "surface-model", "source_to_mm": 1.,
              "space": {"id": "synthetic", "name": "Synthetic source", "coordinate_system": "SOURCE_XYZ", "units": "mm",
                        "axis_status": "source_axes_not_anatomically_verified", "reference": "Generated fixture",
                        "correspondence": "No image correspondence", "unit_basis": "Generated millimeter coordinates"},
              "inputs": {"surface": "source.vtk", "license": "license.txt"},
              "sources": [{"id": "test", "title": "Synthetic", "version": "1", "url": "https://example.org/",
                           "citation": "Generated fixture", "license_name": "CC0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/", "license_input": "license"}],
              "model_evidence": "Synthetic source, not anatomy", "model_notes": [], "scope_notes": [],
              "objects": [{"id": "vtk_test:object:1", "input": "surface", "source_name": path.name,
                           "name": "Synthetic mesh", "source_type": "MESH", "category": "Synthetic",
                           "laterality": "unspecified", "color": [80, 160, 200]}]}
    monkeypatch.setattr(adapters, "load_recipe", lambda _: recipe)
    manifest_path = build_atlas("vtk_test", tmp_path, workers=1, minimum_free_gib=0)
    manifest = validate_package(manifest_path)
    assert manifest.representation == "surface-model" and manifest.volumes == []
    item = manifest.structures[0]
    assert np.array_equal(item.geometry.transform_to_native_mm, np.eye(4))
    mesh = nib.load(manifest_path.parent / item.mesh_file)
    assert np.array_equal(mesh.darrays[0].data, points) and np.array_equal(mesh.darrays[1].data, triangles)
    assert "vtk_extract.py" in manifest.build["implementation"]
