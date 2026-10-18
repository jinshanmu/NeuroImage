"""Source-preserving TrackVis decoding and explicit RAS-mm TCK display subsets."""
from contextlib import contextmanager
import gzip
import hashlib
from pathlib import Path
import struct

import nibabel as nib
import numpy as np

from .geometry import checked_affine

LEVEL_LIMITS = {"preview": 256, "standard": 1024, "detail": 4096}


def subset_indices(count, limit):
    """Select whole source streamlines; power-of-two limits produce nested sets."""
    if count < 1 or limit < 1:
        raise ValueError("A streamline subset requires positive counts")
    size = min(count, limit)
    return np.arange(size, dtype=np.int64) * count // size


@contextmanager
def source_stream(path):
    with (gzip.open(path, "rb") if str(path).endswith(".gz") else Path(path).open("rb")) as stream:
        yield stream


def trackvis_header(stream):
    """Read the documented 1000-byte v2 header independently of NiBabel."""
    header = stream.read(1000)
    if len(header) != 1000 or header[:6] != b"TRACK\x00":
        raise ValueError("Expected a complete TrackVis header")
    endian = "<" if struct.unpack_from("<i", header, 996)[0] == 1000 else ">"
    if struct.unpack_from(endian + "i", header, 996)[0] != 1000 or struct.unpack_from(endian + "i", header, 992)[0] != 2:
        raise ValueError("This adapter requires a declared TrackVis v2 voxel-to-RAS transform")
    dimensions = np.array(struct.unpack_from(endian + "3h", header, 6))
    spacing = np.array(struct.unpack_from(endian + "3f", header, 12))
    affine = checked_affine(np.array(struct.unpack_from(endian + "16f", header, 440)).reshape(4, 4))
    order = header[948:952].rstrip(b"\0").decode("ascii")
    if np.any(dimensions < 1) or not np.isfinite(spacing).all() or np.any(spacing <= 0):
        raise ValueError("Invalid TrackVis dimensions or voxel sizes")
    if order != "".join(nib.aff2axcodes(affine)):
        raise ValueError("TrackVis voxel order conflicts with its affine; an explicit source adapter is required")
    if any(header[982:988]):
        raise ValueError("Legacy TrackVis inversion/swap flags need source-specific review")
    if struct.unpack_from(endian + "h", header, 36)[0] or struct.unpack_from(endian + "h", header, 238)[0]:
        raise ValueError("Per-point scalars or streamline properties require an adapter that preserves them")
    count = struct.unpack_from(endian + "i", header, 988)[0]
    if not 0 < count <= 10_000_000:
        raise ValueError("Require an explicit positive TrackVis streamline count")
    # TrackVis coordinates are voxel-mm from the voxel corner. The coded affine
    # maps voxel centers. This is format decoding, not a registration or shift fit.
    transform = affine @ np.diag([*list(1 / spacing), 1.])
    transform[:3, 3] -= affine[:3, :3] @ np.full(3, .5)
    return {"count": count, "endian": endian, "voxel_order": order, "dimensions": dimensions.tolist(),
            "voxel_sizes_mm": spacing.tolist(), "voxel_to_ras_mm": affine.tolist(),
            "trackvis_to_ras_mm": transform.tolist(), "origin_field": list(struct.unpack_from(endian + "3f", header, 24)),
            "coordinate_decoding": "TrackVis voxel-mm corner to voxel-center indices, then the declared voxel-to-RAS-mm affine"}


def raw_trackvis_points(stream, header):
    for _ in range(header["count"]):
        record = stream.read(4)
        if len(record) != 4:
            raise ValueError("Truncated TrackVis streamline count")
        size = struct.unpack(header["endian"] + "i", record)[0]
        if not 2 <= size <= 1_000_000:
            raise ValueError("Invalid TrackVis point count")
        raw = stream.read(size * 12)
        if len(raw) != size * 12:
            raise ValueError("Truncated TrackVis coordinates")
        points = np.frombuffer(raw, dtype=header["endian"] + "f4").reshape(-1, 3)
        if not np.isfinite(points).all():
            raise ValueError("Nonfinite TrackVis source coordinates")
        yield nib.affines.apply_affine(np.asarray(header["trackvis_to_ras_mm"]), points)
    if stream.read(1):
        raise ValueError("TrackVis data exceed the declared streamline count")


def coordinate_digest(streamlines):
    digest = hashlib.sha256()
    for points in streamlines:
        digest.update(struct.pack("<I", len(points)))
        digest.update(np.asarray(points, dtype="<f4").tobytes())
    return digest.hexdigest()


def read_trackvis(path):
    max_error = 0.
    with source_stream(path) as raw, source_stream(path) as source:
        header = trackvis_header(raw)
        library = iter(nib.streamlines.TrkFile.load(source, lazy_load=True).streamlines)
        def verified():
            nonlocal max_error
            # Validate each raw record before allowing the library to allocate
            # its point array. Both decoders read bounded records in parallel.
            for expected in raw_trackvis_points(raw, header):
                actual = next(library, None)
                if actual is None or actual.shape != expected.shape or not np.isfinite(actual).all():
                    raise ValueError("Decoded point count or finiteness mismatch")
                error = float(np.max(np.abs(actual - expected)))
                max_error = max(max_error, error)
                if error > 1e-4:
                    raise ValueError("Independent TrackVis coordinate decoding disagrees with NiBabel")
                yield actual
            if next(library, None) is not None:
                raise ValueError("Decoded streamline count differs from the TrackVis header")
        tracts = nib.streamlines.ArraySequence(verified())
    return tracts, {**header, "independent_decoder_max_error_mm": max_error,
                    "decoded_ras_sha256": coordinate_digest(tracts)}


def write_tck(path, streamlines):
    """Write unmodified float32 RAS-mm vertices in the standard MRtrix format."""
    header = f"mrtrix tracks\ncount: {len(streamlines)}\ndatatype: Float32LE\nfile: . 1024\nEND\n".encode("ascii")
    with Path(path).open("wb") as stream:
        stream.write(header.ljust(1024, b"\0"))
        separator = np.full(3, np.nan, dtype="<f4").tobytes()
        for points in streamlines:
            stream.write(np.asarray(points, dtype="<f4").tobytes())
            stream.write(separator)
        stream.write(np.full(3, np.inf, dtype="<f4").tobytes())


@contextmanager
def tck_arrays(path):
    """Memory-map canonical package TCK files, validating delimiters and counts."""
    path = Path(path)
    with path.open("rb") as stream:
        header = stream.read(1024).split(b"END\n", 1)[0].decode("ascii")
    fields = dict(line.split(": ", 1) for line in header.splitlines()[1:] if ": " in line)
    if not header.startswith("mrtrix tracks\n") or fields.get("file") != ". 1024" or fields.get("datatype") != "Float32LE":
        raise ValueError("Expected the package's canonical RAS-mm TCK encoding")
    size = path.stat().st_size - 1024
    if size < 48 or size % 12:
        raise ValueError("Truncated TCK coordinates")
    values = np.memmap(path, mode="r", offset=1024, dtype="<f4", shape=(size // 12, 3))
    try:
        if not np.isposinf(values[-1]).all() or not np.isnan(values[-2]).all():
            raise ValueError("Missing TCK termination markers")
        separators = np.flatnonzero(np.isnan(values[:-1]).all(axis=1))
        if len(separators) != int(fields.get("count", "0")):
            raise ValueError("TCK streamline count mismatch")
        starts = np.r_[0, separators[:-1] + 1]
        if np.any(separators - starts < 2):
            raise ValueError("TCK streamlines require at least two source points")
        # Check one streamline at a time without copying the entire point cloud.
        for begin, end in zip(starts, separators):
            if not np.isfinite(values[begin:end]).all():
                raise ValueError("Invalid TCK point or delimiter")
        yield values, starts, separators
    finally:
        values._mmap.close()


def tract_statistics(tracts, reference, laterality):
    points = tracts.get_data()
    low, high = points.min(axis=0), points.max(axis=0)
    center = points.mean(axis=0, dtype=np.float64)
    inverse = np.linalg.inv(reference.affine)
    inside_count = 0
    for start in range(0, len(points), 262144):
        voxels = nib.affines.apply_affine(inverse, points[start:start + 262144])
        inside_count += int(np.count_nonzero(((voxels >= -.5) & (voxels <= np.array(reference.data.shape) - .5)).all(axis=1)))
    if inside_count != len(points):
        raise ValueError("Source streamline points fall outside the declared reference image field of view")
    if laterality == "left" and center[0] >= 0 or laterality == "right" and center[0] <= 0:
        raise ValueError("Source bundle laterality conflicts with the RAS point distribution")
    candidates = subset_indices(len(tracts), LEVEL_LIMITS["preview"])
    midpoints = np.array([tracts[index][len(tracts[index]) // 2] for index in candidates])
    target_index = int(candidates[np.argmin(np.sum((midpoints - center) ** 2, axis=1))])
    point_index = len(tracts[target_index]) // 2
    return {"center_ras_mm": center.tolist(), "bounds_ras_mm": [low.tolist(), high.tolist()],
            "target_ras_mm": tracts[target_index][point_index].tolist(),
            "target_streamline_index": target_index, "target_point_index": point_index,
            "point_count": len(points), "reference_fov_point_count": inside_count,
            "left_point_fraction": float(np.count_nonzero(points[:, 0] < 0) / len(points)),
            "right_point_fraction": float(np.count_nonzero(points[:, 0] > 0) / len(points))}
