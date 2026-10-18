"""Verify retained browser captures and credited exports for native fine anatomy."""
import argparse
import json
from pathlib import Path
import zipfile

import numpy as np
from PIL import Image

from neuroimage.build import atomic_json, sha256, utc_now


def verify(root, log, directory, browser_script):
    result = json.JSONDecoder().raw_decode(log.read_text().split('### Result\n', 1)[1])[0]
    if result['status'] != 'passed' or result['page_errors'] or result['external_requests']:
        raise ValueError('Browser interaction must pass before its captures are accepted')
    result.update(recorded_utc=utc_now(), browser_script_sha256=sha256(browser_script),
                  verifier_sha256=sha256(Path(__file__)), scene_pixel_checks=[], export_checks=[])
    captures = {report.get('capture_id', report['dataset_id']): report for report in result['reports']}
    if len(captures) != len(result['reports']) or any(Path(name).name != name for name in captures):
        raise ValueError('Browser reports require distinct local capture folder names')
    for capture, report in captures.items():
        path = directory / capture / 'scene.json'
        baseline = np.asarray(Image.open(path.parent / 'saved.png')).astype(int)
        for filename in ['restored.png', 'imported.png']:
            restored = np.asarray(Image.open(path.parent / filename)).astype(int)
            if baseline.shape != restored.shape:
                raise ValueError('Scene restoration changed the capture dimensions')
            delta = np.abs(baseline - restored)
            # The accepted anatomy layout has three equal MRI panels followed
            # by 3D. Source image pixels must be identical. Transparent GPU
            # blending across overlapping surfaces may differ by two of 256
            # display levels in a small fraction of channels between frames.
            image_width = baseline.shape[1] * 3 // 4
            changed_fraction = float((delta.max(axis=2) > 0).mean())
            if delta.max() > 2 or changed_fraction > .001 or delta[:, :image_width].max() != 0:
                raise ValueError('Restoration changed the source images or exceeded 3D blending precision')
            result['scene_pixel_checks'].append({
                'dataset_id': report['dataset_id'], 'capture_id': capture, 'comparison': filename,
                'source_image_pixels_identical': True,
                'maximum_3d_channel_difference': int(delta.max()),
                'changed_pixel_fraction': changed_fraction,
            })
    for path in sorted(path for capture in captures for path in (directory / capture).glob('view-*.zip')):
        with zipfile.ZipFile(path) as archive:
            scene = json.loads(archive.read('scene.json'))
            manifest = json.loads(archive.read('provenance.json'))
            if (scene['build_signature'] != manifest['build']['signature']
                    or scene['space_id'] != manifest['space']['id']
                    or not any(s['id'] == scene['state']['selected'] for s in manifest['structures'])
                    or not all(source['license_file'] in archive.namelist() for source in manifest['sources'])
                    or not all(name in archive.namelist() for name in ['anatomy.png', 'rendering.json', 'teaching-notes.txt'])):
                raise ValueError('An exported teaching archive lost its native source or license binding')
        result['export_checks'].append({'path': path.relative_to(root).as_posix(), 'sha256': sha256(path),
                                        'source_license_scene_binding': 'matched'})
    if len(result['scene_pixel_checks']) != 2 * len(result['reports']):
        raise ValueError('Every source block requires both saved-scene and portable-import evidence')
    expected_exports = {s['export'] for r in result['reports'] for s in r['scenes'] if s['export']}
    if expected_exports != {s['path'] for s in result['export_checks']}:
        raise ValueError('The export inventory differs from the executed browser flow')
    atomic_json(directory / 'acceptance.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', required=True, type=Path)
    parser.add_argument('--log', required=True, type=Path)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--browser-script', type=Path, default=Path('scripts/browser_nextbrain_fine_anatomy.js'))
    args = parser.parse_args()
    root = args.data_root.resolve()
    directory = (root / args.directory).resolve()
    directory.relative_to(root)
    result = verify(root, args.log, directory, args.browser_script)
    print(json.dumps({'status': result['status'], 'blocks': len(result['reports']),
                      'views': sum(len(r['scenes']) for r in result['reports']), 'exports': len(result['export_checks'])}))


if __name__ == '__main__':
    main()
