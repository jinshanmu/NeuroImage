"""Read selected source geometry using Blender's embedded runtime, without autoexec.

This file runs as a standalone Blender script. Never import it in project Python.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

import bpy
import numpy as np


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--request", type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
request = json.loads(args.request.read_text())
if bpy.context.preferences.filepaths.use_scripts_auto_execute:
    raise RuntimeError("Embedded source scripts must remain disabled")
if digest(Path(bpy.data.filepath)) != request["source_sha256"]:
    raise RuntimeError("The source Blender file changed before extraction")
units = bpy.context.scene.unit_settings
if units.system != "METRIC" or units.scale_length != request["source_scale_length"]:
    raise RuntimeError("The source model unit declaration differs from the recipe")
root = Path(request["output"])
root.mkdir(parents=True, exist_ok=True)
stage = request.get("mesh_geometry_stage", "base")
if stage not in {"base", "author-viewport"}:
    raise RuntimeError("Unknown source geometry stage")
graph = bpy.context.evaluated_depsgraph_get() if stage == "author-viewport" else None


def modifier_record(modifier):
    properties = {}
    for prop in modifier.bl_rna.properties:
        if prop.identifier == "rna_type" or prop.is_readonly or prop.type not in {"BOOLEAN", "INT", "FLOAT", "STRING", "ENUM", "POINTER"}:
            continue
        value = getattr(modifier, prop.identifier)
        if getattr(prop, "is_array", False):
            value = list(value)
        elif prop.type == "POINTER":
            value = getattr(value, "name", None)
        elif isinstance(value, set):
            value = sorted(value)
        properties[prop.identifier] = value
    return {"name": modifier.name, "type": modifier.type, "properties": properties}


for spec in request["objects"]:
    ident = spec["key"]
    if not ident.isalnum():
        raise RuntimeError("Invalid internal geometry key")
    obj = bpy.data.objects.get(spec["source_name"])
    if obj is None or obj.type != spec["source_type"]:
        raise RuntimeError("Selected source object is missing or has a different type")
    if obj.type not in {"MESH", "CURVE"}:
        raise RuntimeError("This adapter supports explicit source meshes and curves")
    if obj.data.shape_keys:
        raise RuntimeError("Source shape keys require a separately declared interpretation")
    if obj.type == "CURVE" and len(obj.modifiers):
        raise RuntimeError("Curve modifiers require a separately declared interpretation")
    evaluated = obj.evaluated_get(graph) if obj.type == "MESH" and graph is not None else None
    mesh = evaluated.to_mesh() if evaluated else obj.data if obj.type == "MESH" else obj.to_mesh()
    if mesh is None or len(mesh.vertices) < 3 or not mesh.polygons:
        raise RuntimeError("An annotation line or empty object is not an anatomical surface")
    try:
        mesh.calc_loop_triangles()
        points = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", points)
        points = points.reshape((-1, 3))
        faces = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int32)
        mesh.loop_triangles.foreach_get("vertices", faces)
        faces = faces.reshape((-1, 3))
        loops = np.empty(len(mesh.loops), dtype=np.int32)
        mesh.loops.foreach_get("vertex_index", loops)
        offsets = np.array([polygon.loop_start for polygon in mesh.polygons] + [len(mesh.loops)], dtype=np.int32)
        if not np.isfinite(points).all() or faces.size == 0 or faces.min() < 0 or faces.max() >= len(points):
            raise RuntimeError("Nonfinite or invalid source geometry")
        matrix = np.array(obj.matrix_world, dtype=np.float64)
        homogeneous_error = float(np.max(np.abs(matrix[3] - [0, 0, 0, 1])))
        if homogeneous_error > 1e-6:
            raise RuntimeError("Source object transform is not numerically affine")
        affine = matrix.copy()
        # Blender's object transform multiplies Vector(3) by the first three
        # affine rows. Preserve those rows exactly and retain original matrix
        # rounding in provenance instead of treating it as projective anatomy.
        affine[3] = [0, 0, 0, 1]
        transform = np.diag([request["source_scale_length"] * 1000] * 3 + [1.0]) @ affine
        original = root / (ident + ".npz")
        temporary = original.with_suffix(".partial")
        with temporary.open("wb") as stream:
            original_arrays = {}
            if evaluated:
                base = obj.data
                base_points = np.empty(len(base.vertices) * 3, dtype=np.float32)
                base.vertices.foreach_get("co", base_points)
                base_loops = np.empty(len(base.loops), dtype=np.int32)
                base.loops.foreach_get("vertex_index", base_loops)
                original_arrays = {"base_vertices":base_points.reshape((-1,3)),"base_polygon_indices":base_loops,
                    "base_polygon_offsets":np.array([p.loop_start for p in base.polygons]+[len(base.loops)],dtype=np.int32)}
            np.savez_compressed(stream, vertices=points, triangles=faces, polygon_indices=loops,
                                polygon_offsets=offsets, transform_to_native_mm=transform, **original_arrays)
        os.replace(temporary, original)
        controls = None
        if obj.type == "CURVE":
            controls = {"dimensions": obj.data.dimensions, "resolution_u": obj.data.resolution_u,
                        "bevel_depth": obj.data.bevel_depth, "bevel_resolution": obj.data.bevel_resolution,
                        "bevel_object": obj.data.bevel_object.name if obj.data.bevel_object else None,
                        "splines": [{"type": spline.type, "cyclic": spline.use_cyclic_u,
                          "resolution_u": spline.resolution_u,
                          "points": [{"co": list(point.co), "radius": point.radius} for point in spline.points],
                          "bezier_points": [{"co": list(point.co), "handle_left": list(point.handle_left),
                                             "handle_right": list(point.handle_right), "radius": point.radius,
                                             "handle_left_type": point.handle_left_type, "handle_right_type": point.handle_right_type}
                                            for point in spline.bezier_points]} for spline in obj.data.splines]}
        report = {"source_sha256": request["source_sha256"], "source_object": obj.name,
                  "source_data_name": obj.data.name, "source_type": obj.type,
                  "source_geometry_sha256": digest(original), "blender_version": bpy.app.version_string,
                  "embedded_script_execution": False, "source_world_matrix": matrix.tolist(),
                  "source_units": {"system": units.system, "scale_length": units.scale_length, "length_unit": units.length_unit},
                  "source_homogeneous_row_rounding": homogeneous_error,
                  "transform_to_native_mm": transform.tolist(),
                  "source_stage": "author-viewport" if evaluated else "base",
                  "source_modifiers": [modifier_record(item) for item in obj.modifiers],
                  "source_modifiers_not_applied": [] if evaluated else [{"name": item.name, "type": item.type} for item in obj.modifiers],
                  "method": "Original author viewport modifier evaluation by the pinned runtime; source base vertices and polygon loops also retained; no project-added modifier or geometry setting" if evaluated else "Original mesh vertices and polygons; source polygons triangulated without adding vertices" if obj.type == "MESH" else "Original author-defined curve, bevel and resolution converted by the pinned Blender runtime; no project-added subdivision or sampling settings",
                  "curve_controls": controls, "vertices": len(points), "triangles": len(faces),
                  "polygons": len(mesh.polygons), "coordinate_system": "SOURCE_XYZ", "units": "mm",
                  "anatomical_axes": "Not independently verified; no RAS or MRI correspondence asserted"}
        target = root / (ident + ".json")
        temporary = target.with_suffix(".partial")
        temporary.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
        os.replace(temporary, target)
        print(json.dumps({"event": "source-model-extracted", "object": obj.name,
                          "vertices": len(points), "triangles": len(faces)}), flush=True)
    finally:
        if evaluated:
            evaluated.to_mesh_clear()
        elif obj.type == "CURVE":
            obj.to_mesh_clear()
