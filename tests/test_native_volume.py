"""Verify image-only construction without inferred segmentation or altered samples."""
import json
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest

from neuroimage import build as pipeline
from neuroimage.adapters import ImportedDataset
from neuroimage.contracts import Manifest
from neuroimage.teaching import prepare, curriculum_matches
from neuroimage.validation import validate_package


@pytest.fixture
def native_image(tmp_path, monkeypatch):
    values = np.arange(9 * 11 * 13, dtype=np.int16).reshape(9, 11, 13)
    affine = np.array([[-.8, .2, 0, 8], [0, 1.1, .1, -9], [0, 0, 1.5, -10], [0, 0, 0, 1]])
    image = nib.Nifti1Image(values, affine); image.header.set_xyzt_units('mm')
    image.set_sform(affine, code=1); image.set_qform(affine, code=0)
    source = tmp_path / 'source.nii.gz'; nib.save(image, source)
    license_path = tmp_path / 'license.txt'; license_path.write_text('Generated fixture. CC0.\n')
    paths = {'mra': source, 'license': license_path}
    recipe = {'id': 'native_test', 'version': '1', 'title': 'Generated native image', 'representation': 'mri-volume',
              'inputs': {key: path.name for key, path in paths.items()}, 'images': [{'id': 'mra', 'name': 'Generated image'}],
              'space': {'id': 'native-image-test', 'name': 'Synthetic native grid', 'reference': 'Generated affine', 'correspondence': 'No external correspondence'},
              'sources': [{'id': 'test', 'title': 'Generated image', 'version': '1', 'url': 'https://example.org/', 'citation': 'Synthetic tests',
                           'license_name': 'CC0', 'license_url': 'https://creativecommons.org/publicdomain/zero/1.0/', 'license_input': 'license'}],
              'scope_notes': ['Synthetic engineering fixture, not anatomy.']}
    monkeypatch.setattr(pipeline, 'import_dataset', lambda *_: ImportedDataset(recipe, paths, []))
    return tmp_path, source, values, affine


def test_native_image_bytes_grid_empty_catalog_and_checkpoint_recovery(native_image, capsys):
    root, source, values, affine = native_image
    path = pipeline.build_atlas('native_test', root, minimum_free_gib=0)
    manifest = validate_package(path)
    assert manifest.schema_version == '1.6' and manifest.representation == 'mri-volume'
    assert manifest.structures == [] and len(manifest.volumes) == 1
    image = path.parent / manifest.volumes[0].file
    assert image.read_bytes() == source.read_bytes()
    assert np.array_equal(nib.load(image).dataobj, values)
    assert np.allclose(nib.load(image).affine, affine)
    assert json.loads((path.parent / 'lessons.json').read_text())['lessons'] == []
    assert pipeline.build_atlas('native_test', root, minimum_free_gib=0) == path
    final = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert final['built'] == 0 and final['reused'] == 4 and not final['geometry_recomputed']
    changed = manifest.model_dump(); changed['representation'] = 'mri-labels'
    with pytest.raises(ValueError, match='requires source structures'):
        Manifest.model_validate(changed)
    changed = manifest.model_dump(); changed['volumes'][0]['kind'] = 'labels'
    with pytest.raises(ValueError):
        Manifest.model_validate(changed)


def test_image_anchored_teaching_retains_native_sample_and_contrast(native_image):
    root, _, values, affine = native_image
    path = pipeline.build_atlas('native_test', root, minimum_free_gib=0)
    recipe = {'schema_version': '1.0', 'id': 'image-observation', 'dataset_id': 'native_test',
              'required_source': {'id': 'test', 'version': '1'}, 'title': 'Native image observation', 'author': 'Test',
              'objective': 'Observe unchanged image samples.', 'review_status': 'draft_not_expert_reviewed',
              'scenes': [{'id': 'oblique-point', 'title': 'One source point', 'selected': None, 'visible': [], 'background': 'mra',
                          'prompt': 'Observe source intensity.', 'note': 'Generated fixture.',
                          'image_anchor': {'volume_id': 'mra', 'index': [2, 4, 6], 'label': 'Source sample', 'reference': 'Generated voxel'},
                          'display': {'window': [100, 700], 'image_context': True, 'slice_zoom': 1.0}}]}
    filename = root / 'teaching.json'; filename.write_text(json.dumps(recipe))
    assert curriculum_matches(recipe, json.loads(path.read_text()))
    result = prepare(path, filename, root, minimum_free_gib=0)
    state = json.loads(Path(result['notebook']).read_text())['scenes'][0]['scene']['state']
    assert np.allclose(state['position'], nib.affines.apply_affine(affine, [2, 4, 6]))
    assert state['selected'] is None and state['visible'] == [] and state['overlay'] == 'none'
    assert state['window'] == [100, 700] and state['imageContext'] is True and state['pan'] == [0, 0, 0, 1]
    assert state['annotations'][0]['structure_id'] is None
    assert f'recorded value {values[2, 4, 6]}' in state['note']
