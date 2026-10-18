"""Verify SUIT source identity, independent native axes and probability channels."""
import argparse
import json
from pathlib import Path

import nibabel as nib
import numpy as np

from neuroimage.build import atomic_json, sha256, utc_now
from neuroimage.source_lut import read_index_name_color_tsv
from neuroimage.validation import validate_package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-root', required=True, type=Path)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    root = args.data_root.resolve()
    manifest = validate_package(args.manifest)
    if manifest.dataset_id != 'suit_cerebellum':
        raise ValueError('Select the original SUIT cerebellar package')
    recipe = manifest.build['recipe']
    paths = {key: root / value for key, value in recipe['inputs'].items()}
    volumes = {v.id: v for v in manifest.volumes}
    labels = nib.load(paths['labels'])
    categorical = np.asanyarray(labels.dataobj)
    original_probability = nib.load(paths['probabilities'])
    probabilities = np.asanyarray(original_probability.dataobj)
    lut = read_index_name_color_tsv(paths['label_lut'])
    image_checks = []
    for ident in ['labels', 't1']:
        original = nib.load(paths[ident])
        restored = nib.load(args.manifest.parent / volumes[ident].file)
        if not np.array_equal(original.dataobj, restored.dataobj) or not np.array_equal(original.affine, restored.affine):
            raise ValueError('Source samples or native affine changed: ' + ident)
        image_checks.append({'id': ident, 'source_sha256': sha256(paths[ident]),
                             'original_samples_exact': True, 'original_affine_exact': True})
    t1 = nib.load(paths['t1'])
    mapping = np.linalg.inv(t1.affine) @ labels.affine
    expected_mapping = np.array([[-1, 0, 0, 140], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
    if not np.array_equal(mapping, expected_mapping):
        raise ValueError('Original MRI and label native-index correspondence changed')
    points = np.indices(categorical.shape).reshape(3, -1).T
    mapped = nib.affines.apply_affine(mapping, points)
    error = np.linalg.norm(nib.affines.apply_affine(labels.affine, points)
                           - nib.affines.apply_affine(t1.affine, mapped), axis=1).max()
    maximum = probabilities.max(axis=3)
    field_checks = []
    for structure in manifest.structures:
        value = structure.label_value
        channel = structure.probability.source_channel
        values = probabilities[..., channel]
        restored = nib.load(args.manifest.parent / volumes[structure.probability.volume_id].file)
        if (structure.source_name != lut[value]['source_name'] or channel != value - 1
                or not np.array_equal(values, restored.dataobj)
                or not np.array_equal(original_probability.affine, restored.affine)):
            raise ValueError('Original lookup identity, probability channel or grid changed')
        assigned = categorical == value
        mean_support = probabilities[assigned].mean(axis=0)
        if mean_support.argmax() != channel or not np.array_equal(values[assigned], maximum[assigned]):
            raise ValueError('The declared channel lacks the verified categorical correspondence')
        centroid = nib.affines.apply_affine(labels.affine, np.argwhere(assigned).mean(axis=0))
        side_ok = (centroid[0] < 0 if structure.laterality == 'left'
                   else centroid[0] > 0 if structure.laterality == 'right'
                   else structure.source_name.startswith('Vermis_'))
        if not side_ok:
            raise ValueError('A source hemisphere or vermal assignment requires inspection')
        field_checks.append({'id': structure.id, 'source_name': structure.source_name,
                             'label_value': value, 'source_channel': channel,
                             'source_samples_and_affine_exact': True, 'categorical_voxels': int(assigned.sum()),
                             'declared_channel_is_a_maximum_at_every_assigned_voxel': True,
                             'unique_highest_mean_channel': int(mean_support.argmax()),
                             'probability_range': [float(values.min()), float(values.max())],
                             'categorical_centroid_ras_mm': centroid.tolist(), 'source_laterality_verified': True,
                             'laterality_check': 'Source-named hemispheric centroid sign; source-named vermal identity retains its measured offset'})
    candidate = probabilities.argmax(axis=3).astype(np.uint16) + 1
    candidate[maximum < .25] = 0
    record = {'recorded_utc': utc_now(), 'status': 'passed', 'dataset_id': manifest.dataset_id,
              'package_version': manifest.package_version, 'images': image_checks, 'fields': field_checks,
              'label_to_mri_index_mapping': mapping.tolist(), 'all_voxel_physical_position_error_mm': float(error),
              'source_array_order_preserved': True, 'resampling': 'none',
              'probability_scale': {'storage_dtype': str(original_probability.get_data_dtype()),
                                    'slope': original_probability.dataobj.slope,
                                    'intercept': original_probability.dataobj.inter,
                                    'maximum_scaled_value': float(probabilities.max()),
                                    'values_above_one_from_header_precision': int(np.count_nonzero(probabilities > 1))},
              'source_categorical_relationship': {
                  'binding_basis': 'Publisher ordered numeric LUT and complete native categorical/probability correspondence',
                  'first_argmax_tie_difference_voxels': int(np.count_nonzero((probabilities.argmax(3) + 1 != categorical) & (categorical > 0))),
                  'inclusive_quarter_threshold_reconstruction_difference_voxels': int(np.count_nonzero(candidate != categorical)),
                  'policy': 'Keep delivered source categorical assignments and continuous probabilities as separate original products'},
              'anatomical_review': 'recorded_separately', 'manifest_sha256': sha256(args.manifest),
              'verifier_sha256': sha256(Path(__file__))}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    atomic_json(args.output, record)
    print(json.dumps({'status': 'passed', 'fields': len(field_checks), 'images': len(image_checks),
                      'maximum_source_coordinate_error_mm': float(error),
                      'source_categorical_relationship': record['source_categorical_relationship']}))


if __name__ == '__main__':
    main()
