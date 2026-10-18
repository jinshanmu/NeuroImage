"""Compare actual browser probability readouts with original source samples."""
import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np

from neuroimage.build import atomic_json, sha256
from verify_fine_anatomy_browser import verify


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', required=True, type=Path)
    parser.add_argument('--log', required=True, type=Path)
    args = parser.parse_args()
    root = args.data_root.resolve()
    directory = root / 'benchmarks/suit_cerebellum/fine-anatomy-20261014/browser'
    result = verify(root, args.log, directory, Path(__file__).with_name('browser_suit_cerebellum.js'))
    checks = []
    for report in result['reports']:
        if report['dataset_id'] != 'suit_cerebellum' or len(report['package_version']) != 16 or not all(c in '0123456789abcdef' for c in report['package_version']):
            raise ValueError('Browser report must bind an exact SUIT cerebellar package')
        path = root / 'derivatives/suit_cerebellum' / report['package_version'] / 'manifest.json'
        manifest = json.loads(path.read_text())
        structures = {s['id']: s for s in manifest['structures']}
        recipe = manifest['build']['recipe']
        for scene in report['scenes']:
            if scene['overlay'] != 'probability':
                continue
            structure = structures[scene['selected']]
            original = root / recipe['inputs'][structure['probability']['source_input']]
            image = nib.load(original)
            voxel = np.floor(nib.affines.apply_affine(np.linalg.inv(image.affine), scene['position_ras_mm']) + .5).astype(int)
            expected = float(image.dataobj[tuple(voxel) + (structure["probability"]["source_channel"],)])
            actual = scene['source_probability_at_cursor']
            if abs(expected - actual) > .00005001:
                raise ValueError('Browser source probability differs from original sample: ' + scene['selected'])
            checks.append({'id': scene['selected'], 'voxel_index': voxel.tolist(), 'source_value': expected, 'display_value': actual})
    if len(checks) != 34 or len({c['id'] for c in checks}) != 34:
        raise ValueError('Every original field requires a distinct actual browser readout')
    result.update(source_probability_checks=checks, source_sample_verifier_sha256=sha256(Path(__file__)))
    atomic_json(directory / 'acceptance.json', result)
    print(json.dumps({'status': result['status'], 'source_fields_sampled': len(checks),
                      'views': sum(len(r['scenes']) for r in result['reports']),
                      'restored_scene_checks': len(result['scene_pixel_checks']), 'exports': len(result['export_checks'])}))


if __name__ == '__main__':
    main()
