"""Exercise an explicit source label recipe in its original LPS grid."""
import json

import nibabel as nib
import nrrd
import numpy as np
import pytest

from neuroimage import adapters
from neuroimage.build import build_atlas
from neuroimage.validation import validate_package


def test_source_mask_keeps_values_and_exact_lps_to_ras_coordinates(tmp_path, monkeypatch):
    mask = np.zeros((13, 15, 17), dtype=np.int16)
    mask[2:10, 3:11, 4:13] = 1
    nrrd.write(str(tmp_path / 'mask.nrrd'), mask, {'space': 'left-posterior-superior',
        'space directions': np.diag([.5, .6, .75]), 'space origin': [-7, -8, -9]})
    (tmp_path / 'license.txt').write_text('Synthetic fixture. CC0.\n')
    recipe = {'id': 'source_test', 'adapter': 'source-label-volume', 'version': '1', 'title': 'Generated mask',
        'representation': 'label-model', 'nrrd_units': 'mm', 'images': [],
        'inputs': {'labels': 'mask.nrrd', 'license': 'license.txt'},
        'space': {'id': 'test-grid', 'name': 'Generated grid', 'reference': 'Synthetic fixture', 'correspondence': 'None'},
        'sources': [{'id': 'test', 'title': 'Synthetic', 'version': '1', 'url': 'https://example.org/', 'citation': 'Test',
            'license_name': 'CC0', 'license_url': 'https://creativecommons.org/publicdomain/zero/1.0/', 'license_input': 'license'}],
        'selection': [{'value': 1, 'source_name': 'Synthetic foreground', 'name': 'Test mask', 'category': 'Test',
            'color': [230, 210, 180], 'evidence': 'Generated categorical field.'}]}
    monkeypatch.setattr(adapters, 'load_recipe', lambda _: recipe)
    path = build_atlas('source_test', tmp_path, minimum_free_gib=0)
    manifest = validate_package(path)
    assert manifest.representation == 'label-model' and len(manifest.structures) == 1
    assert manifest.structures[0].laterality == 'unspecified'
    volume = nib.load(path.parent / manifest.volumes[0].file)
    assert np.array_equal(volume.dataobj, mask)
    expected = np.diag([-.5, -.6, .75, 1.]); expected[:3, 3] = [7, 8, -9]
    assert np.allclose(volume.affine, expected, rtol=0, atol=1e-6)
    assert json.loads((path.parent / 'validation.json').read_text())['engineering_status'] == 'passed'
    recipe['selection'].append(dict(recipe['selection'][0]))
    with pytest.raises(ValueError, match='duplicate output label'):
        adapters.import_dataset('source_test', tmp_path)


def test_source_label_selection_requires_published_definition():
    with pytest.raises(ValueError, match='definition and evidence'):
        adapters.source_label_catalog({'id': 'test', 'selection': [{'value': 1}]})
    with pytest.raises(ValueError, match='positive categorical'):
        adapters.source_label_catalog({'id': 'test', 'selection': [{'value': 0}]})
