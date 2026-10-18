"""Retain binary STL triangle coordinates with lossless vertex indexing."""
import hashlib
from pathlib import Path

import numpy as np

from .build import atomic_json, sha256


def read_binary_stl(path):
    path = Path(path)
    with path.open("rb") as stream:
        header = stream.read(80)
        count = int.from_bytes(stream.read(4), "little")
    if len(header) != 80 or count < 1 or path.stat().st_size != 84 + count * 50:
        raise ValueError("Require a complete binary STL with its exact declared facet count")
    dtype = np.dtype([("normal", "<f4", (3,)), ("vertices", "<f4", (3, 3)), ("attribute", "<u2")])
    facets = np.memmap(path, dtype=dtype, mode="r", offset=84, shape=(count,))
    coordinates = np.asarray(facets["vertices"]).reshape(-1, 3)
    if not np.isfinite(coordinates).all():
        raise ValueError("STL source coordinates must be finite")
    # Exact coordinate equality only: no tolerance, merging by distance or repair.
    vertices, inverse = np.unique(coordinates, axis=0, return_inverse=True)
    triangles = inverse.reshape(-1, 3).astype(np.int32)
    if not np.array_equal(vertices[triangles], facets["vertices"]):
        raise ValueError("STL indexing changed source facet coordinates")
    return vertices, triangles, header


def extract_source(path, output, item, source_hash, source_to_mm):
    scale = float(source_to_mm)
    if not np.isfinite(scale) or scale <= 0 or item["source_type"] != "MESH":
        raise ValueError("STL geometry requires positive declared metric scaling and a mesh source")
    vertices, triangles, header = read_binary_stl(path)
    transform = np.diag([scale, scale, scale, 1.0])
    raw = Path(output) / (item["key"] + ".npz")
    temporary = raw.with_name(".partial-" + raw.name)
    with temporary.open("wb") as stream:
        np.savez_compressed(stream, vertices=vertices, triangles=triangles,
            polygon_indices=triangles.ravel(), polygon_offsets=np.arange(0, triangles.size + 1, 3, dtype=np.int64),
            transform_to_native_mm=transform)
    temporary.replace(raw)
    atomic_json(raw.with_suffix(".json"), {
        "source_sha256": source_hash, "source_geometry_sha256": sha256(raw),
        "source_object": item["source_name"], "source_type": "MESH", "source_stage": "base",
        "embedded_script_execution": False,
        "method": "Original binary STL facets with exact duplicate-coordinate indexing and declared metric scaling; no project smoothing, filtering, hole filling, decimation, registration or mirroring.",
        "source_header_hex": header.hex(), "source_to_mm": scale,
        "vertices": len(vertices), "triangles": len(triangles),
        "source_facet_coordinates_preserved": True})
