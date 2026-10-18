"""Preserve source-model vertices, topology and declared native unit transforms."""
import json
from pathlib import Path
import hashlib

import nibabel as nib
import numpy as np


def read_source_geometry(path):
    with np.load(path, allow_pickle=False) as archive:
        vertices = archive["vertices"]
        faces = archive["triangles"]
        transform = archive["transform_to_native_mm"]
        polygons = archive["polygon_indices"]
        offsets = archive["polygon_offsets"]
    if (vertices.ndim != 2 or vertices.shape[1] != 3 or len(vertices) < 3 or not np.isfinite(vertices).all()
            or faces.ndim != 2 or faces.shape[1] != 3 or faces.size == 0 or not np.issubdtype(faces.dtype, np.integer)
            or faces.min() < 0 or faces.max() >= len(vertices)
            or transform.shape != (4, 4) or not np.isfinite(transform).all()
            or not np.array_equal(transform[3], [0, 0, 0, 1]) or abs(np.linalg.det(transform[:3, :3])) < 1e-12
            or polygons.ndim != 1 or not np.issubdtype(polygons.dtype, np.integer)
            or len(polygons) < 3 or polygons.min() < 0 or polygons.max() >= len(vertices)
            or offsets.ndim != 1 or len(offsets) < 2 or offsets[0] != 0 or offsets[-1] != len(polygons)
            or (np.diff(offsets) < 3).any()):
        raise ValueError("Invalid retained source model vertices, polygons or transform")
    transformed = vertices.astype(np.float64) @ transform[:3, :3].T + transform[:3, 3]
    return vertices, faces, transform, transformed.astype(np.float32), float(np.max(np.abs(transformed - transformed.astype(np.float32))))


def save_model(path, points, triangles):
    image = nib.gifti.GiftiImage(darrays=[
        nib.gifti.GiftiDataArray(np.asarray(points, dtype=np.float32), intent="NIFTI_INTENT_POINTSET"),
        nib.gifti.GiftiDataArray(np.asarray(triangles, dtype=np.int32), intent="NIFTI_INTENT_TRIANGLE")])
    image.meta = nib.gifti.GiftiMetaData({"CoordinateSystem": "SOURCE_XYZ", "Units": "mm",
                                       "Evidence": "Independent author-defined anatomical model; no image correspondence"})
    image.darrays[0].coordsys = nib.gifti.GiftiCoordSystem(dataspace=0, xformspace=0, xform=np.eye(4))
    nib.save(image, path)


def validate_models(manifest, root):
    for structure in manifest.structures:
        geometry = structure.geometry
        source_path = root / geometry.source_geometry_file
        original, faces, transform, expected, rounding = read_source_geometry(source_path)
        provenance = json.loads((root / geometry.provenance_file).read_text())
        with source_path.open("rb") as stream:
            source_hash = hashlib.file_digest(stream, "sha256").hexdigest()
        source_input = next((item for item in manifest.build["inputs"] if item["id"] == geometry.source_input), None)
        expected_stage = manifest.build.get("recipe", {}).get("mesh_geometry_stage", "base") if geometry.source_type == "MESH" else "base"
        if (source_input is None or provenance["source_sha256"] != source_input["sha256"]
                or provenance["source_geometry_sha256"] != source_hash
                or provenance["source_object"] != geometry.source_object
                or provenance["source_type"] != geometry.source_type
                or provenance["embedded_script_execution"] is not False
                or provenance.get("source_stage", "base") != geometry.source_stage
                or geometry.source_stage != expected_stage
                or provenance.get("method") != geometry.method
                or not np.array_equal(transform, geometry.transform_to_native_mm)):
            raise ValueError("Model geometry does not match its recorded original source")
        mesh = nib.load(root / structure.mesh_file)
        arrays = mesh.get_arrays_from_intent("NIFTI_INTENT_POINTSET")
        face_arrays = mesh.get_arrays_from_intent("NIFTI_INTENT_TRIANGLE")
        if len(arrays) != 1 or len(face_arrays) != 1:
            raise ValueError("Model surface must contain one point and triangle array")
        if (mesh.meta.get("CoordinateSystem") != "SOURCE_XYZ" or mesh.meta.get("Units") != "mm"
                or not np.array_equal(arrays[0].coordsys.xform, np.eye(4))
                or arrays[0].coordsys.dataspace != 0 or arrays[0].coordsys.xformspace != 0
                or not np.array_equal(arrays[0].data, expected) or not np.array_equal(face_arrays[0].data, faces)
                or len(expected) != geometry.vertex_count or len(faces) != geometry.triangle_count
                or not np.array_equal(expected[geometry.target_vertex_index], structure.target_native_mm)
                or not np.allclose([expected.min(axis=0), expected.max(axis=0)], structure.bounds_native_mm, rtol=0, atol=1e-6)):
            raise ValueError("Model surface changed source geometry, topology, native coordinates or target")
