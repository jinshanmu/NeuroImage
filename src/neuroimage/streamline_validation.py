"""Verify package trajectories and exact source-index display subsets."""
import json
import nibabel as nib
import numpy as np
from .streamlines import LEVEL_LIMITS, coordinate_digest, subset_indices, tck_arrays


def validate_streamlines(manifest, root):
    reference = manifest.volumes[0]
    inverse = np.linalg.inv(reference.affine_ras_mm)
    for structure in manifest.structures:
        evidence = structure.streamlines
        full = next(level for level in evidence.levels if level.id == "full")
        with tck_arrays(root / full.file) as (points, starts, ends):
            if len(starts) != evidence.source_streamline_count or int(np.sum(ends - starts)) != evidence.source_point_count:
                raise ValueError(f"{structure.id}: source streamline or point count mismatch")
            if coordinate_digest(points[begin:end] for begin, end in zip(starts, ends)) != evidence.decoded_ras_sha256:
                raise ValueError(f"{structure.id}: decoded source coordinates or ordering changed")
            count, total = 0, np.zeros(3, dtype=np.float64)
            low, high = np.full(3, np.inf), np.full(3, -np.inf)
            for begin, end in zip(starts, ends):
                vertices = points[begin:end]
                voxels = nib.affines.apply_affine(inverse, vertices)
                if not ((voxels >= -.5) & (voxels <= np.asarray(reference.shape) - .5)).all():
                    raise ValueError(f"{structure.id}: trajectory outside the declared reference field of view")
                count += len(vertices)
                total += vertices.sum(axis=0, dtype=np.float64)
                low = np.minimum(low, vertices.min(axis=0)); high = np.maximum(high, vertices.max(axis=0))
            center = total / count
            if not np.allclose([low, high], structure.bounds_ras_mm, rtol=0, atol=1e-5) or not np.allclose(center, structure.center_ras_mm, rtol=0, atol=1e-5):
                raise ValueError(f"{structure.id}: declared streamline bounds or centroid mismatch")
            if structure.laterality == "left" and center[0] >= 0 or structure.laterality == "right" and center[0] <= 0:
                raise ValueError(f"{structure.id}: laterality conflicts with RAS coordinates")
            index, target = evidence.target_streamline_index, evidence.target_point_index
            if target >= ends[index] - starts[index] or not np.array_equal(points[starts[index] + target], structure.target_ras_mm):
                raise ValueError(f"{structure.id}: target is not an exact retained source point")
            for level in evidence.levels:
                if level.id == "full":
                    continue
                record = json.loads((root / level.indices_file).read_text())
                expected = subset_indices(len(starts), LEVEL_LIMITS[level.id])
                indices = record.get("indices")
                if (record.get("source_streamline_count") != len(starts) or record.get("method") != evidence.sampling
                        or indices != expected.tolist() or index not in indices):
                    raise ValueError(f"{structure.id}: invalid deterministic display subset")
                with tck_arrays(root / level.file) as (subset, a, b):
                    if len(a) != level.streamline_count or len(a) != len(indices) or int(np.sum(b - a)) != level.point_count:
                        raise ValueError(f"{structure.id}: display subset counts differ from the manifest")
                    for original_index, begin, end in zip(indices, a, b):
                        if not np.array_equal(subset[begin:end], points[starts[original_index]:ends[original_index]]):
                            raise ValueError(f"{structure.id}: display subset changed source coordinates or point order")
