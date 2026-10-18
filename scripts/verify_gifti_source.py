"""Compare a built GIfTI source model directly with its acquired original files."""
import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np

from neuroimage.build import atomic_json, sha256, utc_now


def verify(manifest_path, data_root):
    manifest = json.loads(manifest_path.read_text())
    if manifest['build']['recipe']['adapter'] != 'gifti-source-surfaces':
        raise ValueError('Choose a GIfTI source surface package')
    root = manifest_path.parent
    inputs = {row['id']: row for row in manifest['build']['inputs']}
    records = []
    for structure in manifest['structures']:
        geometry = structure['geometry']
        source = inputs[geometry['source_input']]
        original_path = (data_root / source['path']).resolve()
        original_path.relative_to(data_root)
        if sha256(original_path) != source['sha256']:
            raise ValueError('Original source bytes changed: ' + source['path'])
        original = nib.load(original_path)
        points = original.get_arrays_from_intent('NIFTI_INTENT_POINTSET')[0]
        faces = original.get_arrays_from_intent('NIFTI_INTENT_TRIANGLE')[0].data
        with np.load(root / geometry['source_geometry_file'], allow_pickle=False) as cache:
            if not np.array_equal(cache['vertices'], points.data) or not np.array_equal(cache['triangles'], faces):
                raise ValueError('Retained geometry differs from the acquired source')
        delivered = nib.load(root / structure['mesh_file'])
        mesh = delivered.get_arrays_from_intent('NIFTI_INTENT_POINTSET')[0].data
        topology = delivered.get_arrays_from_intent('NIFTI_INTENT_TRIANGLE')[0].data
        scale = manifest['build']['recipe']['source_to_mm']
        expected = (points.data.astype(np.float64) * scale).astype(np.float32)
        if not np.array_equal(mesh, expected) or not np.array_equal(topology, faces):
            raise ValueError('Delivered source point order or topology changed')
        metadata = json.loads((root / geometry['provenance_file']).read_text())['source_metadata']
        if (metadata['points'] != dict(points.meta)
                or not np.array_equal(metadata['coordinate_system']['xform'], points.coordsys.xform)):
            raise ValueError('Original source coordinate metadata changed')
        records.append({'id': structure['id'], 'source': source['path'], 'sha256': source['sha256'],
                        'points': len(mesh), 'triangles': len(faces),
                        'original_points_and_topology': 'identical',
                        'source_anatomical_structure': points.meta.get('AnatomicalStructurePrimary'),
                        'source_coordinate_matrix': points.coordsys.xform.tolist(),
                        'source_bounds': [points.data.min(axis=0).tolist(), points.data.max(axis=0).tolist()]})
    return {'recorded_utc': utc_now(), 'status': 'passed', 'manifest': manifest_path.relative_to(data_root).as_posix(),
            'manifest_sha256': sha256(manifest_path), 'source_objects': len(records), 'objects': records,
            'expert_review': 'separate', 'comparison': 'Every original point and triangle compared; original source matrices and metadata retained'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--data-root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = verify(args.manifest.resolve(), args.data_root.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(args.output, result)
    print(json.dumps({key: result[key] for key in ['status', 'manifest', 'source_objects']}))


if __name__ == '__main__':
    main()
