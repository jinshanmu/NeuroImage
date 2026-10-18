"""Compare real browser pixels for 3D-only cursor visibility and scene recovery."""
import argparse
import json
from pathlib import Path
import zipfile

import numpy as np
from PIL import Image


def check(result_path, data_root):
    result = json.loads(Path(result_path).read_text())
    prefix = result['images_prefix']
    image = lambda suffix: np.asarray(Image.open(prefix + suffix + '.png').convert('RGB'))
    changes = {}
    for plane in ['axial', 'coronal', 'sagittal', 'quad']:
        shown, hidden = image(plane + '-shown'), image(plane + '-hidden')
        assert shown.shape == hidden.shape
        changes[plane] = int(np.any(shown != hidden, axis=-1).sum())
    assert all(changes[plane] == 0 for plane in ['axial', 'coronal', 'sagittal'])
    assert changes['quad'] > 0
    for name in ['restored', 'imported']:
        assert np.array_equal(image(name), image('quad-hidden'))
    with zipfile.ZipFile(Path(data_root) / result['export']) as archive:
        names = archive.namelist()
        scene_name = next(name for name in names if name.endswith('scene.json'))
        scene = json.loads(archive.read(scene_name))
        assert scene['state']['show3DCursor'] is False
        assert scene['state']['position'] == result['scene']['state']['position']
    return {'status':'passed','changed_pixels':changes,'scene_restore_changed_pixels':0,'scene_import_changed_pixels':0,
            'export_retains_cursor_visibility':True,'source_point_unchanged':True,'expert_review':'not_performed'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('result', type=Path)
    parser.add_argument('--data-root', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(check(args.result, args.data_root), indent=2))
