"""Retain self-contained GIfTI source surfaces in their original coordinates."""
import gzip
from pathlib import Path
from xml.etree import ElementTree

import nibabel as nib
import numpy as np

from .build import atomic_json, sha256


def read_source_gifti(path):
    """Read one point/triangle pair without applying an embedded space transform."""
    path = Path(path)
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rb") as stream:
        payload = stream.read(512 * 1024 ** 2 + 1)
    if len(payload) > 512 * 1024 ** 2:
        raise ValueError("Source GIfTI exceeds the supported expanded metadata/array size")
    xml = ElementTree.fromstring(payload)
    for node in xml.iter("DataArray"):
        if node.get("ExternalFileName") or node.get("Encoding") == "ExternalFileBinary":
            raise ValueError("Source GIfTI arrays must be self-contained for pinned acquisition")
    image = nib.gifti.GiftiImage.from_bytes(payload)
    points = image.get_arrays_from_intent("NIFTI_INTENT_POINTSET")
    faces = image.get_arrays_from_intent("NIFTI_INTENT_TRIANGLE")
    if len(image.darrays) != 2 or len(points) != 1 or len(faces) != 1:
        raise ValueError("Source GIfTI requires exactly one point and triangle array")
    vertices, triangles = points[0].data, faces[0].data
    if (vertices.ndim != 2 or vertices.shape[1] != 3 or len(vertices) < 3
            or not np.isfinite(vertices).all() or not np.issubdtype(vertices.dtype, np.floating)
            or triangles.ndim != 2 or triangles.shape[1] != 3 or triangles.size == 0
            or not np.issubdtype(triangles.dtype, np.integer)
            or triangles.min() < 0 or triangles.max() >= len(vertices)):
        raise ValueError("Invalid original GIfTI point or triangle array")
    coordinate = points[0].coordsys
    metadata = {"image": dict(image.meta), "points": dict(points[0].meta), "triangles": dict(faces[0].meta),
                "coordinate_system": {"dataspace": int(coordinate.dataspace), "xformspace": int(coordinate.xformspace),
                                      "xform": coordinate.xform.tolist()},
                "coordinate_use": "Original point array; embedded coordinate transform retained as metadata, not applied"}
    if not np.isfinite(coordinate.xform).all():
        raise ValueError("Source GIfTI coordinate metadata must be finite")
    return vertices, triangles, metadata


def extract_source(path, output, item, source_hash, source_to_mm):
    scale = float(source_to_mm)
    if not np.isfinite(scale) or scale <= 0 or item["source_type"] != "MESH":
        raise ValueError("GIfTI geometry requires positive declared metric scaling and a mesh source")
    vertices, triangles, metadata = read_source_gifti(path)
    raw = Path(output) / (item["key"] + ".npz")
    temporary = raw.with_name(".partial-" + raw.name)
    with temporary.open("wb") as stream:
        np.savez_compressed(stream, vertices=vertices, triangles=triangles,
            polygon_indices=triangles.ravel(), polygon_offsets=np.arange(0, triangles.size + 1, 3, dtype=np.int64),
            transform_to_native_mm=np.diag([scale, scale, scale, 1.0]))
    temporary.replace(raw)
    atomic_json(raw.with_suffix(".json"), {
        "source_sha256": source_hash, "source_geometry_sha256": sha256(raw),
        "source_object": item["source_name"], "source_type": "MESH", "source_stage": "base",
        "embedded_script_execution": False,
        "method": "Original GIfTI vertices, triangle indices and winding with declared metric scaling; source metadata retained. No project smoothing, decimation, registration, mirroring or rasterization.",
        "source_metadata": metadata, "source_to_mm": scale,
        "vertices": len(vertices), "triangles": len(triangles),
        "source_point_order_and_topology_preserved": True})
