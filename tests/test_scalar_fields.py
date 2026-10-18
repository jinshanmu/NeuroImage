"""Exercise native statistical evidence without implying MRI or source labels."""
import json
import nibabel as nib
import numpy as np
import pytest
from neuroimage import build as pipeline
from neuroimage.adapters import ImportedDataset
from neuroimage.contracts import Manifest
from neuroimage.validation import validate_package


@pytest.fixture
def scalar_source(tmp_path, monkeypatch):
    values = np.linspace(0, 1, 9*11*13, dtype='>f4').reshape(9, 11, 13)
    affine = np.diag([-.5, .5, .5, 1.]); affine[:3, 3] = [8, -9, -10]
    paths, fields = {}, []
    for ident, scale in [('mean', 1), ('std', .2)]:
        source = tmp_path / (ident + '.nii.gz')
        image = nib.Nifti1Image(values * scale, affine); image.header.set_xyzt_units('mm')
        image.set_qform(affine, code=1); image.set_sform(affine, code=0); nib.save(image, source)
        paths[ident] = source
        fields.append({'id': ident, 'name': ident, 'scalar': {'source_input': ident, 'metric': 'Synthetic fraction',
            'units': 'fraction', 'statistic': ident, 'interpretation': 'Generated engineering field; not anatomy.',
            'derivation': 'Generated numbers', 'reference': 'Synthetic fixture', 'valid_range': [0, 1]}})
    paths['license'] = tmp_path / 'license.txt'; paths['license'].write_text('Generated fixture. CC0.\n')
    recipe = {'id': 'scalar_test', 'version': '1', 'title': 'Synthetic statistics', 'representation': 'scalar-fields',
        'inputs': {key:path.name for key,path in paths.items()}, 'images':fields,
        'space':{'id':'test-native','name':'Generated grid','reference':'Synthetic','correspondence':'No external correspondence'},
        'sources':[{'id':'test','title':'Generated test','version':'1','url':'https://example.org/','citation':'Synthetic fixture',
            'license_name':'CC0','license_url':'https://creativecommons.org/publicdomain/zero/1.0/','license_input':'license'}],
        'scope_notes':['Synthetic engineering data.']}
    monkeypatch.setattr(pipeline,'import_dataset',lambda *_: ImportedDataset(recipe,paths,[]))
    return tmp_path, paths, recipe


def test_scalar_native_bytes_units_and_resume(scalar_source, capsys):
    root, sources, _ = scalar_source
    path = pipeline.build_atlas('scalar_test', root, minimum_free_gib=0)
    manifest = validate_package(path)
    assert manifest.schema_version == '1.8' and manifest.representation == 'scalar-fields'
    assert not manifest.structures and len(manifest.volumes) == 2
    for field in manifest.volumes:
        assert field.kind == 'scalar' and field.scalar.units == 'fraction'
        assert (path.parent / field.file).read_bytes() == sources[field.id].read_bytes()
    assert pipeline.build_atlas('scalar_test', root, minimum_free_gib=0) == path
    assert json.loads(capsys.readouterr().out.splitlines()[-1])['built'] == 0
    for mutation in ('missing_definition', 'different_grid', 'fake_mri'):
        content = manifest.model_dump()
        if mutation == 'missing_definition': content['volumes'][0]['scalar'] = None
        if mutation == 'different_grid': content['volumes'][1]['affine_ras_mm'][0][3] += 1
        if mutation == 'fake_mri': content['representation'] = 'mri-volume'
        with pytest.raises(ValueError): Manifest.model_validate(content)


def test_scalar_range_is_checked_against_actual_source_values(scalar_source):
    root, _, recipe = scalar_source
    recipe['images'][0]['scalar']['valid_range'] = [0, .5]
    with pytest.raises(ValueError, match='Scalar values exceed'):
        pipeline.build_atlas('scalar_test', root, minimum_free_gib=0)
