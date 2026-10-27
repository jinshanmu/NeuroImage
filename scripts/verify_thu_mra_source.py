"""Check original MRA/segment samples and native landmark geometry in built cases."""
import argparse
import csv
import json
from pathlib import Path

import nibabel as nib
import numpy as np
import SimpleITK as sitk
from scipy.spatial import cKDTree

from neuroimage.build import atomic_json, sha256, utc_now
from neuroimage.validation import validate_package


def landmark_observation(ident, point, image, declared_outside):
    """Retain delivered crop-external points only when the source inventory agrees."""
    voxel = np.asarray(image.TransformPhysicalPointToContinuousIndex(tuple(point * [-1, -1, 1])))
    inside = bool(np.all(voxel >= -.5) and np.all(voxel <= np.asarray(image.GetSize()) - .5))
    if not inside:
        evidence = next((item for item in declared_outside if item['id'] == ident), None)
        if evidence is None or not (np.allclose(point, evidence['ras_mm'], rtol=0, atol=1e-8)
                and np.allclose(voxel, evidence['original_voxel_index'], rtol=0, atol=1e-8)):
            raise ValueError('Original landmark falls outside its paired source image without matching source evidence')
    return {'id': ident, 'ras_mm': point.tolist(), 'original_voxel_index': voxel.tolist(),
            'inside_source_image': inside,
            'distance_to_voxel_center_mm': float(np.linalg.norm((voxel - np.rint(voxel)) * image.GetSpacing()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', required=True, type=Path)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = args.data_root.resolve()
    manifest = validate_package(args.manifest)
    recipe = manifest.build['recipe']
    if recipe['adapter'] != 'source-mri-label-volume' or recipe['sources'][0]['id'] != 'thu_cerebral_mra':
        raise ValueError('Select an original THU healthy-volunteer MRA package')
    for archive in recipe['archives']:
        for member in archive['members']:
            if sha256(root / member['target']) != member['sha256']:
                raise ValueError('Original source bytes differ from the pinned archive: ' + member['target'])
    checks = []
    sources = {}
    for key in ['mra', 'labels']:
        path = root / recipe['inputs'][key]
        image = sitk.ReadImage(str(path))
        original = sitk.GetArrayFromImage(image).transpose(2, 1, 0)
        volume = next(item for item in manifest.volumes if item.id == key)
        output = nib.load(args.manifest.parent / volume.file)
        actual = np.asanyarray(output.dataobj)
        if not np.array_equal(actual, original):
            raise ValueError('Original voxel values changed: ' + key)
        indices = [(0, 0, 0), tuple(int(n - 1) for n in image.GetSize())]
        for value in (np.unique(original).astype(int) if key == 'labels' else []):
            if value:
                positions = np.argwhere(original == value)
                indices.extend(tuple(int(x) for x in positions[i]) for i in [0, len(positions) // 2, -1])
        error = max(float(np.linalg.norm(nib.affines.apply_affine(output.affine, index)
                    - np.asarray(image.TransformIndexToPhysicalPoint(index)) * [-1, -1, 1])) for index in indices)
        if error > 1e-4:
            raise ValueError('Original voxel physical points changed: ' + key)
        checks.append({'input': key, 'source_sha256': sha256(path), 'exact_original_voxels': True,
                       'physical_points_checked': len(indices), 'maximum_point_error_mm': error,
                       'source_voxel_count': int(original.size)})
        sources[key] = (image, original)
    if (sources['mra'][0].GetSize() != sources['labels'][0].GetSize()
            or sources['mra'][0].GetOrigin() != sources['labels'][0].GetOrigin()
            or sources['mra'][0].GetSpacing() != sources['labels'][0].GetSpacing()
            or sources['mra'][0].GetDirection() != sources['labels'][0].GetDirection()):
        raise ValueError('Original MRA and labels must use the same source grid')
    landmark_text = (root / recipe['inputs']['landmarks']).read_text()
    if '# CoordinateSystem = 0' not in landmark_text:
        raise ValueError('Expected explicit Slicer RAS fiducials')
    points = {int(row[11].split('-')[-1]): np.array(list(map(float, row[1:4])))
              for row in csv.reader(line for line in landmark_text.splitlines() if not line.startswith('#'))}
    image, labels = sources['labels']
    declared_outside = recipe['source_case'].get('landmarks_outside_image', [])
    landmark_checks = [landmark_observation(ident, point, image, declared_outside) for ident, point in points.items()]
    observed_outside = [item for item in landmark_checks if not item['inside_source_image']]
    if {item['id'] for item in observed_outside} != {item['id'] for item in declared_outside}:
        raise ValueError('Source crop-external landmark inventory differs from original coordinates')
    catalog_path = Path(__file__).resolve().parents[1] / 'src/neuroimage/catalogs/thu-cerebral-mra-segments.json'
    catalog = json.loads(catalog_path.read_text())
    correspondence = []
    for item in catalog['segments']:
        voxels = np.argwhere(labels == item['value'])
        if not len(voxels):
            continue
        physical = np.array([image.TransformIndexToPhysicalPoint(tuple(map(int, p))) for p in voxels]) * [-1, -1, 1]
        tree = cKDTree(physical)
        distances = [float(tree.query(points[ident])[0]) for ident in item['endpoint_ids']]
        correspondence.append({'value': item['value'], 'proposed_name': item['name'],
                               'delivered_endpoint_ids': item['endpoint_ids'],
                               'distance_to_original_label_voxel_center_mm': distances})
    report = {'status': 'passed', 'recorded_utc': utc_now(), 'dataset_id': manifest.dataset_id,
              'package_version': manifest.package_version, 'manifest_sha256': sha256(args.manifest),
              'verifier_sha256': sha256(Path(__file__)), 'voxel_checks': checks,
              'same_original_image_and_label_grid': True, 'landmark_checks': landmark_checks,
              'all_source_landmarks_inside_image': not observed_outside,
              'preserved_source_landmarks_outside_crop': observed_outside,
              'correspondence_catalog_sha256': sha256(catalog_path), 'endpoint_observations': correspondence,
              'name_correspondence_status': catalog['status'],
              'scope': 'Engineering preservation of source samples and physical coordinates; name interpretation and introductory teaching suitability are reviewed separately.'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(args.output, report)
    print(json.dumps({'status': 'passed', 'dataset': manifest.dataset_id, 'structures': len(manifest.structures),
                      'landmarks': len(points), 'maximum_physical_error_mm': max(r['maximum_point_error_mm'] for r in checks)}))


if __name__ == '__main__':
    main()
