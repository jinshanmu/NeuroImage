"""Compare source-rendered section pixels across display expansion and recovery."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def check(log_path, image_root):
    text = log_path.read_text()
    result, _ = json.JSONDecoder().raw_decode(text.split('### Result\n', 1)[1])
    if result.get('status') != 'passed' or len(result['checks']) != 4:
        raise ValueError('Four successful native source fixtures are required')
    for item in result['checks']:
        prefix = 'large-' + item['dataset'] + '-'
        images = {name: np.asarray(Image.open(image_root / (prefix + name + '.png')).convert('RGB'))
                  for name in ['ordinary', 'full', 'magnified', 'full-returned', 'returned', 'imported']}
        differences = {}
        for source, target in [('ordinary', 'returned'), ('ordinary', 'imported'), ('full', 'full-returned')]:
            if images[source].shape != images[target].shape:
                raise ValueError(f'{item["dataset"]}: recovery changed canvas dimensions')
            differences[target] = int(np.any(images[source] != images[target], axis=2).sum())
        changed = int(np.any(images['full'] != images['magnified'], axis=2).sum())
        if any(differences.values()) or changed < 500:
            raise ValueError(f'{item["dataset"]}: unexpected pixel differences {differences}; magnification {changed}')
        item.update(recovery_pixel_differences=differences, magnification_changed_pixels=changed,
                    canvas_area_gain=round(np.prod(item['expanded_size']) / np.prod(item['ordinary_size']), 3))
    result['scope'] = 'Engineering source-rendered pixels, native cursor, selection and portable scene recovery; no new anatomical review'
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-log', required=True, type=Path)
    parser.add_argument('--image-root', type=Path, default=Path('output/playwright'))
    args = parser.parse_args()
    print(json.dumps(check(args.browser_log, args.image_root), indent=2))
