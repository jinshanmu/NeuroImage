"""Independently compare browser samples with each original source probability."""
import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np


def check(result_path, data_root):
    result = json.loads(Path(result_path).read_text())
    package = Path(data_root) / 'derivatives/brainstem_navigator_mni' / result['package_version']
    manifest = json.loads((package / 'manifest.json').read_text())
    structures = {item['id']: item for item in manifest['structures']}
    probes = result['probes']
    assert len(probes) == len(structures) == 86
    assert {probe['structure_id'] for probe in probes} == set(structures)
    errors = []
    for probe in probes:
        structure = structures[probe['structure_id']]
        source = Path(data_root) / manifest['build']['recipe']['inputs'][structure['probability']['source_input']]
        image = nib.load(source)
        voxel = np.rint((np.linalg.inv(image.affine) @ [*probe['position_ras_mm'], 1])[:3]).astype(int)
        assert np.all(voxel >= 0) and np.all(voxel < np.array(image.shape[:3]))
        expected = float(image.dataobj[tuple(voxel)])
        error = abs(expected - probe['displayed_probability'])
        assert error <= .0000501, (probe['structure_id'], expected, probe['displayed_probability'])
        errors.append(error)
    return {'status':'passed', 'package_version':result['package_version'], 'original_source_fields_compared':len(errors),
            'maximum_display_rounding_error':max(errors), 'method':'Independent original NIfTI affine inversion and direct NiBabel source samples; no application selection or rendering code imported',
            'expert_review':'not_performed'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('result', type=Path)
    parser.add_argument('--data-root', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(check(args.result, args.data_root), indent=2))
