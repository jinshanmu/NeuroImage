"""Read declared author label tips in pinned Blender with embedded scripts disabled."""
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


def transform(obj, scale):
    matrix = np.asarray(obj.matrix_world, dtype=np.float64)
    if not np.isfinite(matrix).all() or np.max(np.abs(matrix[3] - [0, 0, 0, 1])) > 1e-6:
        raise ValueError("The original annotation transform must be numerically affine")
    matrix[3] = [0, 0, 0, 1]
    return np.diag([scale * 1000] * 3 + [1.0]) @ matrix


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--request", type=Path, required=True)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
request = json.loads(args.request.read_text())
units = bpy.context.scene.unit_settings
if (bpy.context.preferences.filepaths.use_scripts_auto_execute or digest(Path(bpy.data.filepath)) != request["source_sha256"]
        or units.system != "METRIC" or units.scale_length != request["source_scale_length"]):
    raise ValueError("Source annotation input, native units or disabled-script runtime changed")
root = Path(request["output"])
graph = bpy.context.evaluated_depsgraph_get()
for item in request["annotations"]:
    spec = item["spec"]; key = item["key"]
    if not key.isalnum() or spec["mapping"] != "blender-hooked-label-tip-v1" or spec["source_vertex_index"] != 1:
        raise ValueError("Unsupported source annotation mapping")
    obj = bpy.data.objects.get(spec["source_object"])
    if obj is None or obj.type != "MESH" or obj.data.shape_keys:
        raise ValueError("Source annotation requires its original two-vertex label object")
    hooks = [m for m in obj.modifiers if m.type == "HOOK" and m.show_viewport]
    if (len(hooks) != 1 or hooks[0].object is None or hooks[0].object.name != item["context_object"]
            or list(hooks[0].vertex_indices) != [1] or any(m.type != "HOOK" for m in obj.modifiers)):
        raise ValueError("Source annotation hook differs from its explicit context")
    parent = obj.parent
    if parent is None or parent.type != "FONT" or parent.parent != hooks[0].object:
        raise ValueError("Source annotation parent hierarchy differs from the author label convention")
    evaluated = obj.evaluated_get(graph); mesh = evaluated.to_mesh()
    try:
        edges = [list(edge.vertices) for edge in mesh.edges]
        if len(mesh.vertices) != 2 or mesh.polygons or edges != [[0, 1]]:
            raise ValueError("The declared annotation must retain exactly its original label line")
        points = np.asarray([list(v.co) for v in mesh.vertices], dtype=np.float64)
        matrix = transform(obj, units.scale_length)
        native = points @ matrix[:3, :3].T + matrix[:3, 3]
        if not np.isfinite(native).all():
            raise ValueError("Source annotation contains a nonfinite native point")
        record = {"signature": request["signature"], "source_sha256": request["source_sha256"], "spec": spec,
            "coordinate_system": "SOURCE_XYZ", "units": "mm", "source_stage": "author-viewport",
            "embedded_script_execution": False, "blender_version": bpy.app.version_string,
            "source_scale_length": units.scale_length, "source_world_matrix": [list(row) for row in obj.matrix_world],
            "homogeneous_row_rounding": float(np.max(np.abs(np.asarray(obj.matrix_world)[3] - [0, 0, 0, 1]))),
            "context_object": item["context_object"], "context_transform_to_native_mm": transform(hooks[0].object, units.scale_length).tolist(),
            "source_vertices": points.tolist(), "base_source_vertices": [list(v.co) for v in obj.data.vertices],
            "transform_to_native_mm": matrix.tolist(), "points_native_mm": native.tolist(),
            "edge_indices": edges, "polygon_count": 0, "hook_vertex_indices": list(hooks[0].vertex_indices),
            "hook": {"name": hooks[0].name, "object": hooks[0].object.name, "matrix_inverse": [list(row) for row in hooks[0].matrix_inverse],
                     "strength": hooks[0].strength, "falloff_type": hooks[0].falloff_type, "falloff_radius": hooks[0].falloff_radius,
                     "center": list(hooks[0].center), "show_viewport": hooks[0].show_viewport},
            "source_text_object": parent.name, "source_text": parent.data.body,
            "method": "Original author label-line endpoint 1 after original viewport Hook evaluation; original context and metric world transform retained"}
        target = root / (key + ".json"); temporary = root / (key + ".partial")
        if any(path.is_symlink() for path in (target, temporary, target.with_suffix(".sha256"))):
            raise ValueError("Annotation output must stay in regular cache files")
        temporary.write_text(json.dumps(record, indent=2, allow_nan=False) + "\n")
        os.replace(temporary, target)
        stamp = target.with_suffix(".sha256"); temporary = stamp.with_suffix(".partial")
        if temporary.is_symlink():
            raise ValueError("Annotation checksum output must be a regular cache file")
        temporary.write_text(digest(target) + "\n"); os.replace(temporary, stamp)
        print(json.dumps({"event": "source-annotation-extracted", "id": spec["id"], "source_object": obj.name}), flush=True)
    finally:
        evaluated.to_mesh_clear()
