"""Run in pinned Blender to compare the retained package with its original source."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--manifest', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
manifest_path = Path(args.manifest)
manifest = json.loads(manifest_path.read_text())
assert bpy.context.preferences.filepaths.use_scripts_auto_execute is False
assert bpy.context.scene.unit_settings.system == 'METRIC'
assert bpy.context.scene.unit_settings.scale_length == 1.0
results = []
graph = bpy.context.evaluated_depsgraph_get() if any(s['geometry'].get('source_stage') == 'author-viewport' for s in manifest['structures']) else None
for structure in manifest['structures']:
    geometry = structure['geometry']
    original = bpy.data.objects[geometry['source_object']]
    evaluated = original.evaluated_get(graph) if geometry.get('source_stage') == 'author-viewport' else None
    converted = original.type == 'CURVE'
    mesh = evaluated.to_mesh() if evaluated else original.to_mesh() if converted else original.data
    try:
        mesh.calc_loop_triangles()
        vertices = np.asarray([list(vertex.co) for vertex in mesh.vertices], dtype=np.float32)
        triangles = np.asarray([list(triangle.vertices) for triangle in mesh.loop_triangles], dtype=np.int32)
        with np.load(manifest_path.parent / geometry['source_geometry_file'], allow_pickle=False) as retained:
            assert np.array_equal(vertices, retained['vertices'])
            assert np.array_equal(triangles, retained['triangles'])
            if evaluated:
                assert np.array_equal(np.asarray([list(v.co) for v in original.data.vertices],dtype=np.float32),retained['base_vertices'])
                assert np.array_equal([loop.vertex_index for loop in original.data.loops],retained['base_polygon_indices'])
                assert np.array_equal([p.loop_start for p in original.data.polygons]+[len(original.data.loops)],retained['base_polygon_offsets'])
            matrix = retained['transform_to_native_mm']
        # Blender's own three-component affine transform is an independent check
        # of near-affine last-row normalization and the declared metric scaling.
        world = np.asarray([list(original.matrix_world @ vertex.co) for vertex in mesh.vertices], dtype=np.float64) * 1000
        transformed = vertices.astype(np.float64) @ matrix[:3, :3].T + matrix[:3, 3]
        discrepancy = float(np.max(np.abs(world - transformed)))
        assert discrepancy < .001, (original.name, discrepancy)
        results.append({'id': structure['id'], 'source_object': original.name, 'vertices': len(vertices),
                        'triangles': len(triangles), 'source_stage':geometry.get('source_stage','base'), 'blender_affine_max_difference_mm': discrepancy})
    finally:
        if evaluated: evaluated.to_mesh_clear()
        elif converted: original.to_mesh_clear()
report = {'source_file_sha256': hashlib.sha256(Path(bpy.data.filepath).read_bytes()).hexdigest(),
          'manifest_sha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
          'blender_version': bpy.app.version_string, 'objects': results,
          'passed': len(results), 'scope': 'Source geometry, base topology and native metric object transforms; no anatomical direction or expert review claim'}
Path(args.output).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'verified_source_objects': len(results), 'maximum_difference_mm': max(item['blender_affine_max_difference_mm'] for item in results)}))
