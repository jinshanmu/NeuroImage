"""Verify physical coordinates and exact paired source labels in MetaImage."""
import json

import nibabel as nib
import numpy as np
import pytest
import SimpleITK as sitk

from neuroimage import adapters
from neuroimage.build import build_atlas
from neuroimage.geometry import read_volume, save_nifti
from neuroimage.validation import validate_package


def write_source(path, values, direction):
    image = sitk.GetImageFromArray(values.transpose(2, 1, 0))
    image.SetSpacing((.51, .63, .8))
    image.SetOrigin((17., -28., 39.))
    image.SetDirection(tuple(np.asarray(direction, dtype=float).ravel()))
    sitk.WriteImage(image, str(path), useCompression=True)
    return image


@pytest.mark.parametrize('direction', [np.eye(3), [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
                                      [[-1, 0, 0], [0, 1, 0], [0, 0, 1]]])
def test_metaimage_exact_voxels_and_independent_physical_point_conversion(tmp_path, direction):
    values = np.arange(7 * 9 * 11, dtype=np.float64).reshape(7, 9, 11) / 3
    path = tmp_path / 'original.mha'
    image = write_source(path, values, direction)
    loaded = read_volume(path, declared_metaimage_units='mm')
    assert np.array_equal(loaded.data, values)
    for index in [(0, 0, 0), (1, 6, 8), (6, 8, 10)]:
        expected = np.asarray(image.TransformIndexToPhysicalPoint(index)) * [-1, -1, 1]
        assert np.allclose(nib.affines.apply_affine(loaded.affine, index), expected, atol=1e-12)
    save_nifti(loaded, tmp_path / 'portable.nii.gz')
    restored = read_volume(tmp_path / 'portable.nii.gz')
    assert np.array_equal(restored.data, values)
    assert np.allclose(restored.affine, loaded.affine, rtol=0, atol=1e-6)
    assert loaded.source_geometry['space'] == 'LPS'
    with pytest.raises(ValueError, match='unit'):
        read_volume(path)
    with pytest.raises(ValueError, match='channel'):
        read_volume(path, declared_metaimage_units='mm', frame=0)


def test_metaimage_rejects_implicit_grid_and_external_payload(tmp_path):
    path = tmp_path / 'external.mha'
    path.write_text('NDims = 3\nElementDataFile = original.raw\n')
    with pytest.raises(ValueError, match='local voxel'):
        read_volume(path, declared_metaimage_units='mm')
    path.write_text('NDims = 3\nElementDataFile = LOCAL\n')
    with pytest.raises(ValueError, match='complete 3D'):
        read_volume(path, declared_metaimage_units='mm')


def test_source_mri_labels_retain_all_values_and_resume(tmp_path, monkeypatch, capsys):
    labels = np.zeros((13, 15, 17), dtype=np.float64)
    labels[2:6, 3:9, 4:13] = 3
    labels[8:11, 6:12, 2:9] = 17
    image = np.arange(labels.size, dtype=float).reshape(labels.shape)
    write_source(tmp_path / 'labels.mha', labels, np.eye(3))
    write_source(tmp_path / 'image.mha', image, np.eye(3))
    (tmp_path / 'license.txt').write_text('Synthetic test fixture, CC0.\n')
    recipe = {'id': 'meta_fixture', 'adapter': 'source-mri-label-volume', 'version': '1',
        'title': 'Synthetic paired image and source labels', 'representation': 'mri-labels',
        'metaimage_units': 'mm', 'require_same_grid': True, 'require_full_label_inventory': True,
        'images': [{'id': 'mra', 'name': 'Synthetic source image'}],
        'inputs': {'mra': 'image.mha', 'labels': 'labels.mha', 'license': 'license.txt'},
        'space': {'id': 'synthetic-lps', 'name': 'Generated paired grid', 'reference': 'Fixture',
                  'correspondence': 'Original paired physical grid'},
        'sources': [{'id': 'fixture', 'title': 'Fixture', 'version': '1', 'url': 'https://example.org/',
                     'citation': 'Synthetic fixture', 'license_name': 'CC0',
                     'license_url': 'https://creativecommons.org/publicdomain/zero/1.0/', 'license_input': 'license'}],
        'selection': [{'value': value, 'source_name': f'Original segment {value}', 'name': f'Segment {value}',
                       'category': 'Fixture', 'color': [200, 170, 120], 'evidence': 'Generated source.'}
                      for value in [3, 17]]}
    monkeypatch.setattr(adapters, 'load_recipe', lambda _: recipe)
    path = build_atlas('meta_fixture', tmp_path, minimum_free_gib=0)
    manifest = validate_package(path)
    for volume in manifest.volumes:
        actual = nib.load(path.parent / volume.file)
        assert np.array_equal(actual.dataobj, labels if volume.kind == 'labels' else image)
    assert manifest.build['libraries']['SimpleITK'] == sitk.Version_VersionString()
    signature = manifest.build['signature']
    capsys.readouterr()
    assert build_atlas('meta_fixture', tmp_path, minimum_free_gib=0) == path
    event = json.loads(capsys.readouterr().out.strip())
    assert event['geometry_recomputed'] is False and event['built'] == 0
    assert validate_package(path).build['signature'] == signature
    recipe['images'] = []
    with pytest.raises(ValueError, match='matching images'):
        adapters.import_dataset('meta_fixture', tmp_path)
