"""Retain the pinned SPL/NAC legacy VTK triangle surfaces without modifying geometry."""
import hashlib
from pathlib import Path
import re

import numpy as np

from .build import atomic_json, sha256


_MAX_BYTES = 512 * 1024 ** 2
_TYPES = {"float": ">f4", "int": ">i4", "vtkIdType": ">i4"}


def _line(stream, *, eof=False):
    while True:
        value = stream.readline(4097)
        if value == b"" and eof:
            return None
        if not value or len(value) > 4096 or not value.endswith(b"\n"):
            raise ValueError("Incomplete or oversized legacy VTK header")
        try:
            text = value.decode("ascii").strip()
        except UnicodeDecodeError as error:
            raise ValueError("Invalid legacy VTK header encoding") from error
        if text:
            return text


def _number(value):
    if not re.fullmatch(r"[0-9]+", value):
        raise ValueError("Legacy VTK counts must be nonnegative integers")
    result = int(value)
    if result > _MAX_BYTES // 4:
        raise ValueError("Legacy VTK array count exceeds the supported source size")
    return result


def _array(stream, count, dtype):
    if dtype not in _TYPES:
        raise ValueError("Unsupported legacy VTK source array type")
    size = count * 4
    # A bounded read also rejects truncated arrays before NumPy interprets them.
    position = stream.tell()
    stream.seek(0, 2)
    end = stream.tell()
    stream.seek(position)
    if size > _MAX_BYTES or size > end - position:
        raise ValueError("Truncated or oversized legacy VTK source array")
    payload = stream.read(size)
    if stream.read(1) != b"\n":
        raise ValueError("Invalid legacy VTK binary array delimiter")
    values = np.frombuffer(payload, dtype=_TYPES[dtype]).astype(np.float32 if dtype == "float" else np.int32)
    if dtype == "float" and not np.isfinite(values).all():
        raise ValueError("Legacy VTK source arrays must be finite")
    return values, hashlib.sha256(payload).hexdigest()


def _parse_source_vtk(path):
    path = Path(path)
    if path.stat().st_size > _MAX_BYTES:
        raise ValueError("Legacy VTK source exceeds the supported file size")
    attributes, descriptions = {}, []
    with path.open("rb") as stream:
        if _line(stream) != "# vtk DataFile Version 4.1":
            raise ValueError("Require the pinned legacy VTK 4.1 source schema")
        title = _line(stream)
        if _line(stream) != "BINARY" or _line(stream) != "DATASET POLYDATA":
            raise ValueError("Require binary legacy VTK POLYDATA source geometry")
        points = _line(stream).split()
        if len(points) != 3 or points[0] != "POINTS" or points[2] != "float":
            raise ValueError("Require original float32 legacy VTK points")
        point_count = _number(points[1])
        if point_count < 3:
            raise ValueError("Legacy VTK surfaces require at least three points")
        vertices, _ = _array(stream, point_count * 3, "float")
        vertices = vertices.reshape(-1, 3)
        polygons = _line(stream).split()
        if len(polygons) != 3 or polygons[0] != "POLYGONS":
            raise ValueError("Require original triangle polygons, without lines or strips")
        triangle_count, connectivity_count = map(_number, polygons[1:])
        if triangle_count < 1 or connectivity_count != triangle_count * 4:
            raise ValueError("Legacy VTK polygons must already be triangles")
        cells, _ = _array(stream, connectivity_count, "int")
        cells = cells.reshape(-1, 4)
        if not np.all(cells[:, 0] == 3):
            raise ValueError("Legacy VTK polygons must already be triangles")
        triangles = cells[:, 1:].copy()
        if triangles.min() < 0 or triangles.max() >= point_count:
            raise ValueError("Legacy VTK triangle index is outside the source points")
        edges_a = vertices[triangles[:, 1]].astype(np.float64) - vertices[triangles[:, 0]]
        edges_b = vertices[triangles[:, 2]].astype(np.float64) - vertices[triangles[:, 0]]
        if np.any(np.linalg.norm(np.cross(edges_a, edges_b), axis=1) == 0):
            raise ValueError("Legacy VTK source contains degenerate triangles")
        context, tuples, seen_contexts = None, None, set()

        def retain(name, components, count, dtype):
            if (context is None or not re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", name)
                    or not 1 <= components <= 4 or count != tuples):
                raise ValueError("Unsupported legacy VTK attribute schema")
            key = "source_" + context + "_" + name
            if key in attributes:
                raise ValueError("Duplicate legacy VTK source attribute")
            values, digest = _array(stream, components * count, dtype)
            attributes[key] = values.reshape(count, components)
            descriptions.append({"association": context, "name": name, "components": components,
                                 "tuples": count, "source_type": dtype, "source_binary_sha256": digest,
                                 "retained_npz_key": key})

        while (line := _line(stream, eof=True)) is not None:
            fields = line.split()
            if len(fields) == 2 and fields[0] in {"POINT_DATA", "CELL_DATA"}:
                context = "point" if fields[0] == "POINT_DATA" else "cell"
                tuples = _number(fields[1])
                if context in seen_contexts or tuples != (point_count if context == "point" else triangle_count):
                    raise ValueError("Legacy VTK attribute counts differ from the source geometry")
                seen_contexts.add(context)
            elif len(fields) == 3 and fields[0] == "FIELD" and fields[1] == "FieldData":
                count = _number(fields[2])
                if count > 32:
                    raise ValueError("Unsupported legacy VTK field count")
                for _ in range(count):
                    spec = _line(stream).split()
                    if len(spec) != 4:
                        raise ValueError("Unsupported legacy VTK field declaration")
                    retain(spec[0], _number(spec[1]), _number(spec[2]), spec[3])
            elif len(fields) in {3, 4} and fields[0] == "SCALARS":
                if _line(stream) != "LOOKUP_TABLE default":
                    raise ValueError("Unsupported legacy VTK lookup table")
                retain(fields[1], _number(fields[3]) if len(fields) == 4 else 1, tuples, fields[2])
            elif len(fields) == 3 and fields[0] == "NORMALS":
                retain(fields[1], 3, tuples, fields[2])
            elif line == "METADATA":
                if _line(stream) != "INFORMATION 0":
                    raise ValueError("Unsupported legacy VTK information metadata")
            else:
                raise ValueError("Unsupported legacy VTK source section")
    metadata = {"format": "legacy VTK 4.1 BINARY POLYDATA", "title": title,
                "source_point_type": "float32", "source_connectivity_type": "int32",
                "source_point_order_and_triangle_winding_preserved": True,
                "source_lines": 0, "source_strips": 0, "source_vertices_cells": 0,
                "source_attributes": descriptions,
                "coordinate_use": "Original model coordinates with declared metric scaling; no MRI registration or axis conversion"}
    return vertices, triangles, metadata, attributes


def read_source_vtk(path):
    """Read only the supported pinned source schema, preserving original point and face order."""
    vertices, triangles, metadata, _ = _parse_source_vtk(path)
    return vertices, triangles, metadata


def extract_source(path, output, item, source_hash, source_to_mm):
    scale = float(source_to_mm)
    if not np.isfinite(scale) or scale <= 0 or item["source_type"] != "MESH":
        raise ValueError("VTK geometry requires positive declared metric scaling and a mesh source")
    vertices, triangles, metadata, attributes = _parse_source_vtk(path)
    raw = Path(output) / (item["key"] + ".npz")
    temporary = raw.with_name(".partial-" + raw.name)
    with temporary.open("wb") as stream:
        np.savez_compressed(stream, vertices=vertices, triangles=triangles,
                            polygon_indices=triangles.ravel(),
                            polygon_offsets=np.arange(0, triangles.size + 1, 3, dtype=np.int64),
                            transform_to_native_mm=np.diag([scale, scale, scale, 1.]), **attributes)
    temporary.replace(raw)
    atomic_json(raw.with_suffix(".json"), {
        "source_sha256": source_hash, "source_geometry_sha256": sha256(raw),
        "source_object": item["source_name"], "source_type": "MESH", "source_stage": "base",
        "embedded_script_execution": False,
        "method": "Original binary legacy VTK float32 points, triangle indices, winding and source attributes with declared metric scaling. No project rasterization, thickness, triangulation, smoothing, decimation, reflection or registration.",
        "source_metadata": metadata, "source_to_mm": scale,
        "vertices": len(vertices), "triangles": len(triangles),
        "source_point_order_and_topology_preserved": True})
