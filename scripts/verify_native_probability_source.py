"""Verify original independent probability fields and exact reference subarrays."""
import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np

from neuroimage.build import atomic_json, sha256, utc_now
from neuroimage.validation import validate_package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', required=True, type=Path)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = args.data_root.resolve()
    manifest = validate_package(args.manifest)
    recipe = manifest.build['recipe']
    if manifest.representation != 'mri-regions' or recipe['adapter'] != 'independent-nifti-regions':
        raise ValueError('Select an independent native probability-field package')
    volumes = {v.id: v for v in manifest.volumes}
    image_checks, field_checks = [], []
    for spec in recipe['images']:
        path = root / recipe['inputs'][spec['id']]
        original = nib.load(path)
        output = nib.load(args.manifest.parent / volumes[spec['id']].file)
        values = np.asanyarray(original.dataobj)
        crop = spec.get('native_crop')
        start = np.asarray(crop['start'] if crop else [0, 0, 0])
        shape = crop['shape'] if crop else original.shape
        slices = tuple(slice(int(a), int(a + n)) for a, n in zip(start, shape))
        if not np.array_equal(output.dataobj, values[slices]):
            raise ValueError('Original reference samples changed: ' + spec['id'])
        corners = np.array(np.meshgrid(*[(0, size - 1) for size in shape], indexing='ij')).reshape(3, -1).T
        error = np.max(np.linalg.norm(nib.affines.apply_affine(output.affine, corners)
                                     - nib.affines.apply_affine(original.affine, corners + start), axis=1))
        if error > 1e-5:
            raise ValueError('Reference crop changed original physical positions')
        image_checks.append({'input': spec['id'], 'source_sha256': sha256(path),
                             'original_shape': list(original.shape), 'output_shape': list(output.shape),
                             'crop_start': start.tolist(), 'original_samples_exact': True,
                             'maximum_corner_error_mm': float(error)})
    counts = None
    for structure in manifest.structures:
        path = root / recipe['inputs'][structure.probability.source_input]
        original = nib.load(path)
        values = np.asanyarray(original.dataobj)
        output = nib.load(args.manifest.parent / volumes[structure.probability.volume_id].file)
        mask = nib.load(args.manifest.parent / volumes[structure.mask.volume_id].file)
        if (not np.array_equal(output.dataobj, values) or not np.array_equal(original.affine, output.affine)
                or not np.array_equal(mask.dataobj, values >= structure.mask.threshold)):
            raise ValueError('Source probability, native grid or threshold membership changed: ' + structure.id)
        membership = np.asanyarray(mask.dataobj).astype(np.uint16)
        counts = membership.copy() if counts is None else counts + membership
        support = np.argwhere(values > 0)
        weights = values[tuple(support.T)].astype(np.float64)
        centroid = nib.affines.apply_affine(original.affine, np.average(support, axis=0, weights=weights))
        side = structure.laterality
        hemisphere = ('left' if centroid[0] < 0 else 'right') if side in ['left', 'right'] else 'midline'
        field_checks.append({'id': structure.id, 'source_sha256': sha256(path),
                             'original_samples_exact': True, 'original_affine_exact': True,
                             'inclusive_display_mask_exact': True, 'probability_range': [float(values.min()), float(values.max())],
                             'positive_probability_voxels': len(support), 'display_mask_voxels': int(membership.sum()),
                             'positive_values_below_display_threshold': int(np.count_nonzero((values > 0) & ~membership.astype(bool))),
                             'source_laterality': side, 'probability_weighted_centroid_ras_mm': centroid.tolist(),
                             'centroid_hemisphere_matches_source_name': hemisphere == side})
    if any(not field['centroid_hemisphere_matches_source_name'] for field in field_checks):
        raise ValueError('A probability centroid requires source laterality inspection')
    overlap = {'voxels_with_multiple_memberships': int(np.count_nonzero(counts > 1)),
               'maximum_memberships': int(counts.max()), 'sum_memberships': int(counts.sum()),
               'union_voxels': int(np.count_nonzero(counts))}
    if overlap != manifest.validation['membership_statistics']:
        raise ValueError('Independent overlapping source memberships changed')
    record = {'recorded_utc': utc_now(), 'dataset_id': manifest.dataset_id, 'package_version': manifest.package_version,
              'status': 'passed', 'scope': 'Exact original probabilities, exact native reference crop, physical sample coordinates, threshold memberships and declared hemispheres',
              'anatomical_review': 'recorded_separately', 'images': image_checks, 'fields': field_checks,
              'overlap_statistics': overlap, 'manifest_sha256': sha256(args.manifest), 'verifier_sha256': sha256(Path(__file__))}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(args.output, record)
    print(json.dumps({'status': record['status'], 'fields': len(field_checks), 'images': len(image_checks),
                      'overlap': overlap, 'maximum_corner_error_mm': max(x['maximum_corner_error_mm'] for x in image_checks)}))


if __name__ == '__main__':
    main()
