"""Check native source-model browser evidence, restored pixels and attributed exports."""
import argparse
import json
from pathlib import Path
import zipfile

import numpy as np
from PIL import Image

from neuroimage.build import atomic_json, sha256, utc_now


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', required=True, type=Path)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--log', required=True, type=Path)
    parser.add_argument('--browser-script', required=True, type=Path)
    args = parser.parse_args()
    root = args.data_root.resolve()
    directory = (root / args.directory).resolve()
    directory.relative_to(root)
    report = json.JSONDecoder().raw_decode(args.log.read_text().split('### Result\n', 1)[1])[0]
    if report['status'] != 'passed' or report['page_errors'] or report['external_requests']:
        raise ValueError('The source-model browser flow must complete successfully')
    report.update(recorded_utc=utc_now(), browser_script_sha256=sha256(args.browser_script),
                  verifier_sha256=sha256(Path(__file__)), pixel_checks=[], export_checks=[])
    for row in report['reports']:
        folder = directory / row['curriculum']
        baseline = np.asarray(Image.open(folder / 'saved.png')).astype(int)
        for name in ['restored.png', 'imported.png']:
            capture = np.asarray(Image.open(folder / name)).astype(int)
            if capture.shape != baseline.shape:
                raise ValueError('Restored source-model capture dimensions changed')
            delta = np.abs(baseline - capture)
            if delta.max() > 1:
                raise ValueError('Restored source model differs beyond one 8-bit blending level')
            report['pixel_checks'].append({'curriculum': row['curriculum'], 'comparison': name,
                'maximum_channel_difference': int(delta.max()),
                'changed_pixel_fraction': float((delta.max(axis=2) > 0).mean())})
        for view in row['scenes']:
            if not view['export']:
                continue
            path = (root / view['export']).resolve()
            path.relative_to(directory)
            with zipfile.ZipFile(path) as archive:
                scene = json.loads(archive.read('scene.json'))
                manifest = json.loads(archive.read('provenance.json'))
                if (manifest['representation'] != 'surface-model'
                        or scene['build_signature'] != manifest['build']['signature']
                        or scene['space_id'] != manifest['space']['id']
                        or scene['state']['coordinate_system'] != 'SOURCE_XYZ'
                        or scene['state']['selected'] != view['selected']
                        or scene['state']['position_native_mm'] != view['native_target']
                        or not all(source['license_file'] in archive.namelist() for source in manifest['sources'])
                        or not all(name in archive.namelist() for name in ['anatomy.png', 'rendering.json', 'teaching-notes.txt'])):
                    raise ValueError('Source-model export lost its geometry, scene or attribution binding')
            report['export_checks'].append({'path': view['export'], 'sha256': sha256(path), 'source_license_scene_binding': 'matched'})
    actual = {path.relative_to(root).as_posix() for path in directory.glob('*/view-*.zip')}
    if actual != {row['path'] for row in report['export_checks']}:
        raise ValueError('Saved exports differ from the executed browser evidence')
    atomic_json(directory / 'acceptance.json', report)
    print(json.dumps({'status': 'passed', 'curricula': len(report['reports']),
                      'views': sum(len(row['scenes']) for row in report['reports']),
                      'scene_pixel_checks': len(report['pixel_checks']), 'exports': len(actual)}))


if __name__ == '__main__':
    main()
