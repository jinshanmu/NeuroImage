"""Independently check native source samples, image bytes, scenes and viewer pixels."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

import nibabel as nib
import numpy as np
from PIL import Image


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def check(data_root, browser_log, images):
    result, _ = json.JSONDecoder().raw_decode(browser_log.read_text().split('### Result\n', 1)[1])
    assert result['status'] == 'passed'
    package = data_root / 'derivatives/ixi_mra' / result['package_version']
    manifest = json.loads((package / 'manifest.json').read_text())
    source_path = data_root / manifest['build']['recipe']['inputs']['mra']
    retained = package / manifest['volumes'][0]['file']
    source, output = nib.load(source_path), nib.load(retained)
    assert digest(source_path) == digest(retained)
    assert np.array_equal(source.affine, output.affine)
    assert np.array_equal(np.asanyarray(source.dataobj), np.asanyarray(output.dataobj))
    assert source.header.get_xyzt_units() == output.header.get_xyzt_units()
    assert manifest['structures'] == [] and manifest['representation'] == 'mri-volume'
    probes, sides = [], set()
    for probe in result['probes']:
        index = tuple(probe['source_voxel'])
        expected = float(source.dataobj[index])
        world = nib.affines.apply_affine(source.affine, index)
        assert np.allclose(world, probe['requested_ras_mm'], rtol=0, atol=1e-7)
        assert np.allclose(world, probe['displayed_ras_mm'], rtol=0, atol=.00501)
        assert expected == probe['value'], f'Original voxel {index}: {expected} != browser {probe["value"]}'
        sides.add('left' if world[0] < 0 else 'right')
        probes.append({'source_voxel': list(index), 'intensity': expected, 'ras_mm': world.tolist()})
    assert sides == {'left', 'right'}
    def image(name):
        return np.asarray(Image.open(images / f'native-mra-{name}.png').convert('RGB'))
    context, signal, hidden = [image(name) for name in ('context', 'signal', 'no-volume')]
    assert context.shape == signal.shape == hidden.shape
    h, w, _ = signal.shape
    # The linked 3D viewport lies in the lower-right quadrant. All complete
    # source sections and their orientation glyphs must remain pixel-identical.
    difference = np.any(signal != hidden, axis=2)
    allowed = np.zeros((h, w), dtype=bool); allowed[h//2:, w//2:] = True
    assert not difference[~allowed].any(), 'Toggling intensity rendering changed a 2D section'
    assert np.count_nonzero(difference) > 100, 'The 3D intensity view did not render'
    contrast_pixels = int(np.count_nonzero(np.any(context != signal, axis=2)))
    assert contrast_pixels > 1000
    saved = image('saved')
    restored = {}
    for name in ('restored', 'imported'):
        current = image(name)
        assert np.array_equal(saved, current), f'{name} scene pixels changed'
        restored[name] = 0
    with zipfile.ZipFile(data_root / result['export']) as archive:
        assert json.loads(archive.read('scene.json'))['state'] == result['scene']['state']
        assert json.loads(archive.read('provenance.json')) == manifest
        renderer = json.loads(archive.read('rendering.json'))
        assert renderer.get('native_image')
        for asset in manifest['assets']:
            if asset['role'] == 'license':
                assert archive.read(asset['path']) == (package / asset['path']).read_bytes()
    return {'status': 'passed', 'package_version': manifest['package_version'], 'source_image_sha256': digest(source_path),
            'shape': list(source.shape), 'orientation': list(nib.aff2axcodes(source.affine)),
            'source_image_byte_identical': True, 'array_and_affine_identical': True, 'invented_structures': 0,
            'native_samples': probes, 'source_sides_sampled': sorted(sides), 'two_dimensional_pixels_changed_by_volume_toggle': 0,
            'three_dimensional_pixels_changed_by_volume_toggle': int(np.count_nonzero(difference)),
            'display_contrast_changed_pixels': contrast_pixels, 'restored_pixel_changes': restored,
            'credited_export_verified': True, 'renderer_sha256': renderer['build_sha256'], 'expert_review': 'not_performed'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', required=True, type=Path)
    parser.add_argument('--browser-log', required=True, type=Path)
    parser.add_argument('--images', default=Path('output/playwright'), type=Path)
    args = parser.parse_args()
    print(json.dumps(check(args.data_root, args.browser_log, args.images), indent=2))
