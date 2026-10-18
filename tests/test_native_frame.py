"""Check exact extraction of a stored 4D frame without synthetic image detail."""
import json

import nibabel as nib
import numpy as np
import pytest

from neuroimage import build as pipeline
from neuroimage.adapters import ImportedDataset
from neuroimage.validation import validate_geometry, validate_package


@pytest.fixture
def native_series(tmp_path, monkeypatch):
    values = np.arange(9 * 11 * 13 * 3, dtype=np.int16).reshape(9, 11, 13, 3)
    affine = np.array([[-.35, 0, 0, 8], [0, .31, -.15, -9], [0, .15, .31, -10], [0, 0, 0, 1]])
    image = nib.Nifti1Image(values, affine)
    image.header.set_xyzt_units('mm', 'sec')
    image.set_sform(affine, code=1)
    image.set_qform(affine, code=0)
    source = tmp_path / 'series.nii.gz'
    nib.save(image, source)
    license_path = tmp_path / 'license.txt'
    license_path.write_text('Generated engineering fixture. CC0.\n')
    paths = {'series': source, 'license': license_path}
    recipe = {'id': 'frame_test', 'version': '1', 'title': 'Generated oblique series',
        'representation': 'mri-volume', 'adapter': 'native-nifti-frame',
        'inputs': {key: path.name for key, path in paths.items()},
        'images': [{'id': 'echo', 'name': 'Stored frame 3', 'source_input': 'series', 'source_frame': 2}],
        'space': {'id': 'native-test', 'name': 'Synthetic native grid', 'reference': 'Generated', 'correspondence': 'None'},
        'sources': [{'id': 'test', 'title': 'Generated', 'version': '1', 'url': 'https://example.org/',
            'citation': 'Synthetic tests', 'license_name': 'CC0', 'license_url': 'https://creativecommons.org/publicdomain/zero/1.0/', 'license_input': 'license'}],
        'scope_notes': ['Synthetic engineering data, not anatomy.']}
    monkeypatch.setattr(pipeline, 'import_dataset', lambda *_: ImportedDataset(recipe, paths, []))
    return tmp_path, source, values, affine, recipe


def test_exact_frame_original_series_and_checkpoint_recovery(native_series, capsys):
    root, original, values, affine, _ = native_series
    path = pipeline.build_atlas('frame_test', root, minimum_free_gib=0)
    manifest = validate_package(path)
    assert manifest.schema_version == '1.9' and not manifest.structures
    volume = manifest.volumes[0]
    assert volume.native_frame.frame == 2 and volume.native_frame.source_shape == values.shape
    assert (path.parent / volume.native_frame.source_file).read_bytes() == original.read_bytes()
    assert np.array_equal(nib.load(path.parent / volume.file).dataobj, values[..., 2])
    assert np.allclose(nib.load(path.parent / volume.file).affine, affine, rtol=0, atol=1e-5)
    assert pipeline.build_atlas('frame_test', root, minimum_free_gib=0) == path
    assert json.loads(capsys.readouterr().out.splitlines()[-1])['built'] == 0
    (path.parent / volume.file).unlink()
    pipeline.build_atlas('frame_test', root, minimum_free_gib=0)
    assert json.loads(capsys.readouterr().out.splitlines()[-1])['built'] == 1
    validate_package(path)


def test_reject_wrong_frame_and_altered_samples(native_series):
    root, _, values, _, _ = native_series
    path = pipeline.build_atlas('frame_test', root, minimum_free_gib=0)
    manifest = validate_package(path)
    changed = manifest.model_copy(deep=True)
    changed.volumes[0].native_frame.frame = 1
    with pytest.raises(ValueError, match='identity differs'):
        validate_geometry(changed, path.parent)
    output = path.parent / manifest.volumes[0].file
    image = nib.load(output)
    wrong = nib.Nifti1Image(values[..., 1], image.affine, image.header)
    nib.save(wrong, output)
    with pytest.raises(ValueError, match='changed source samples'):
        validate_geometry(manifest, path.parent)


def test_reject_missing_source_frame(native_series):
    root, _, _, _, recipe = native_series
    recipe['images'][0]['source_frame'] = 3
    with pytest.raises(ValueError, match='channel|frame'):
        pipeline.build_atlas('frame_test', root, minimum_free_gib=0)
