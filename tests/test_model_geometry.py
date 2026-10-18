"""Protect native source models against invented coordinates and changed topology."""
import hashlib
import json
from types import SimpleNamespace

import nibabel as nib
import numpy as np
import pytest

from neuroimage.contracts import ModelSpace, ModelGeometry
from neuroimage.model_geometry import read_source_geometry, save_model, validate_models


@pytest.fixture
def model(tmp_path):
    vertices = np.array([[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0]], np.float32)
    triangles = np.array([[0, 1, 2], [0, 2, 3]], np.int32)
    transform = np.array([[0, -1000, 0, 500], [1000, 0, 0, -200], [0, 0, 1000, 1600], [0, 0, 0, 1]], float)
    path = tmp_path / 'source.npz'
    np.savez_compressed(path, vertices=vertices, triangles=triangles, transform_to_native_mm=transform,
                        polygon_indices=np.array([0, 1, 2, 3], np.int32), polygon_offsets=np.array([0, 4], np.int32))
    _, _, _, points, _ = read_source_geometry(path)
    save_model(tmp_path / 'model.gii', points, triangles)
    provenance = {'source_sha256': 'a' * 64, 'source_geometry_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                  'source_object': 'Synthetic quadrilateral', 'source_type': 'MESH', 'embedded_script_execution': False,
                  'method': 'Synthetic polygon fixture, not anatomy'}
    (tmp_path / 'provenance.json').write_text(json.dumps(provenance))
    geometry = ModelGeometry(source_input='synthetic', source_object='Synthetic quadrilateral', source_type='MESH',
        source_geometry_file='source.npz', provenance_file='provenance.json', vertex_count=4, triangle_count=2,
        target_vertex_index=1, transform_to_native_mm=transform.tolist(), method='Synthetic polygon fixture, not anatomy')
    structure = SimpleNamespace(geometry=geometry, mesh_file='model.gii', target_native_mm=points[1].tolist(),
                                bounds_native_mm=[points.min(axis=0).tolist(), points.max(axis=0).tolist()])
    manifest = SimpleNamespace(structures=[structure], build={'inputs': [{'id': 'synthetic', 'sha256': 'a' * 64}]})
    return tmp_path, manifest


def test_native_transform_preserves_points_and_polygon_topology(model):
    root, manifest = model
    original, faces, transform, points, rounding = read_source_geometry(root / 'source.npz')
    assert np.array_equal(points, [[500, -200, 1600], [500, 1800, 1600], [-2500, 1800, 1600], [-2500, -200, 1600]])
    assert len(original) == 4 and rounding == 0
    validate_models(manifest, root)


@pytest.mark.parametrize('change', ['position', 'topology', 'coordinate_assignment', 'target', 'source_identity', 'source_stage', 'source_method'])
def test_changed_source_relationship_is_rejected(model, change):
    root, manifest = model
    image = nib.load(root / 'model.gii')
    if change == 'position': image.darrays[0].data[0, 0] += .5
    elif change == 'topology': image.darrays[1].data[0, 1] = 3
    elif change == 'coordinate_assignment': image.darrays[0].coordsys.xformspace = 1
    elif change == 'target': manifest.structures[0].target_native_mm[0] += .5
    elif change == 'source_stage': manifest.structures[0].geometry.source_stage = 'author-viewport'
    elif change == 'source_method': manifest.structures[0].geometry.method = 'Invented anatomical reconstruction'
    else: manifest.build['inputs'][0]['sha256'] = 'b' * 64
    nib.save(image, root / 'model.gii')
    with pytest.raises(ValueError, match='source|Source'):
        validate_models(manifest, root)


def test_unverified_model_axes_cannot_be_declared_ras():
    with pytest.raises(ValueError):
        ModelSpace(id='fixture', name='Synthetic model', reference='No image', correspondence='None',
                   coordinate_system='RAS', axis_status='source_axes_not_anatomically_verified', unit_basis='Metric source')
