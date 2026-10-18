"""Validate independent probability regions without discarding overlaps."""
import nibabel as nib
import numpy as np

from .geometry import read_volume


def validate_regions(manifest, root):
    from .validation import validate_surface_geometry
    volumes = {v.id: v for v in manifest.volumes}

    def read(spec):
        native = read_volume(root / spec.file)
        if (native.source_geometry["units"] != "mm" or native.data.shape != spec.shape
                or not np.allclose(native.affine, spec.affine_ras_mm, rtol=0, atol=1e-4)
                or not np.allclose(nib.affines.voxel_sizes(native.affine), spec.voxel_size_mm, rtol=0, atol=1e-4)
                or "".join(nib.aff2axcodes(native.affine)) != spec.orientation):
            raise ValueError(f"Independent-region volume geometry mismatch: {spec.id}")
        return native

    for spec in manifest.volumes:
        if spec.kind == "image":
            read(spec)
    membership_counts = None
    for structure in manifest.structures:
        mask = read(volumes[structure.mask.volume_id])
        probability = read(volumes[structure.probability.volume_id])
        if not np.isin(mask.data, [0, 1]).all() or not np.any(mask.data):
            raise ValueError(f"Independent source mask must be nonempty and binary: {structure.id}")
        if probability.data.min() < 0 or probability.data.max() > structure.probability.maximum:
            raise ValueError(f"Independent probability outside its declared {structure.probability.units} scale: {structure.id}")
        membership = mask.data == 1
        if not np.array_equal(membership, probability.data >= structure.mask.threshold):
            raise ValueError(f"Independent source mask disagrees with its inclusive probability threshold: {structure.id}")
        indices = np.argwhere(membership)
        if (len(indices) != structure.voxel_count
                or not np.isclose(len(indices) * abs(np.linalg.det(mask.affine[:3, :3])), structure.volume_mm3)
                or not np.allclose(nib.affines.apply_affine(mask.affine, indices.mean(axis=0)), structure.center_ras_mm, rtol=0, atol=1e-4)):
            raise ValueError(f"Independent source membership statistics mismatch: {structure.id}")
        target = nib.affines.apply_affine(np.linalg.inv(mask.affine), structure.target_ras_mm)
        index = np.rint(target).astype(int)
        if (not np.allclose(index, target, rtol=0, atol=1e-4) or np.any(index < 0) or np.any(index >= membership.shape)
                or not membership[tuple(index)]):
            raise ValueError(f"Independent region target is not a member voxel: {structure.id}")
        validate_surface_geometry(structure, root, mask.data, mask.affine)
        if membership_counts is None:
            membership_counts = np.zeros(membership.shape, dtype=np.uint16)
        membership_counts += membership
    actual = {"voxels_with_multiple_memberships": int(np.count_nonzero(membership_counts > 1)),
              "maximum_memberships": int(membership_counts.max()),
              "sum_memberships": int(membership_counts.sum()), "union_voxels": int(np.count_nonzero(membership_counts))}
    if manifest.validation.get("membership_statistics") != actual:
        raise ValueError("Independent-region overlap statistics disagree with retained masks")
