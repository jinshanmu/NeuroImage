"""Check actual pointer-driven scene restoration against pixels and source labels."""
import argparse
import json
from pathlib import Path
import nibabel as nib
import numpy as np
from PIL import Image


def check(manifest_path, browser_log, image_root):
    log = browser_log.read_text()
    if '### Result\n' not in log:
        raise ValueError('The browser did not produce a complete scene result')
    result, _ = json.JSONDecoder().raw_decode(log.split('### Result\n',1)[1])
    manifest = json.loads(manifest_path.read_text())
    if result.get('status') != 'passed' or result.get('package_version') != manifest['package_version']:
        raise ValueError('The scene check does not match the selected atlas package')
    names = ['baseline','interactive','saved','reset','restored','imported']
    images = {name: np.asarray(Image.open(image_root / f'scene-pose-{name}.png').convert('RGB')) for name in names}
    reference = images['interactive']
    if any(image.shape != reference.shape for image in images.values()):
        raise ValueError('The scene comparisons have different image dimensions')
    differences = {name: int(np.any(image != reference, axis=2).sum()) for name,image in images.items()}
    if differences['baseline'] < 1000 or differences['reset'] < 1000:
        raise ValueError('The real pointer gestures or reset did not materially change the rendered view')
    if any(differences[name] for name in ['saved','restored','imported']):
        raise ValueError(f'Scene recovery changed rendered pixels: {differences}')
    labels = next(volume for volume in manifest['volumes'] if volume['kind'] == 'labels')
    native = nib.load(manifest_path.parent / labels['file'])
    index = np.floor(nib.affines.apply_affine(np.linalg.inv(native.affine),result['position_ras_mm'])+.5).astype(int)
    if np.any(index<0) or np.any(index>=native.shape):
        raise ValueError('Restored cursor lies outside the source label volume')
    value = int(np.asanyarray(native.dataobj)[tuple(index)])
    selected = next(structure for structure in manifest['structures'] if structure['id'] == result['selected'])
    if value != selected['label_value']:
        raise ValueError('Restored cursor no longer identifies its selected source label')
    return {'status':'passed','package_version':manifest['package_version'], 'pixel_differences_from_interactive_view':differences,
            'restored_source_label':value,'camera':result['camera'],'pan':result['pan'],
            'scope':'Engineering pixel/state correspondence; no anatomical expert judgment'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',required=True,type=Path)
    parser.add_argument('--browser-log',required=True,type=Path)
    parser.add_argument('--image-root',type=Path,default=Path('output/playwright'))
    args=parser.parse_args()
    print(json.dumps(check(args.manifest,args.browser_log,args.image_root),indent=2))
