"""Explicit voxel-to-RAS geometry; no registration or geometric refinement."""
from dataclasses import dataclass
from pathlib import Path
import math
import nibabel as nib
import nrrd
import numpy as np
from scipy.ndimage import map_coordinates
from skimage.measure import marching_cubes


@dataclass
class NativeVolume:
    data: np.ndarray
    affine: np.ndarray
    source_geometry: dict


def checked_affine(affine):
    a = np.asarray(affine, dtype=float)
    if a.shape != (4, 4) or not np.isfinite(a).all() or not np.allclose(a[3], [0, 0, 0, 1]):
        raise ValueError("Invalid voxel-to-world affine")
    if abs(np.linalg.det(a[:3, :3])) < 1e-10:
        raise ValueError("Singular voxel-to-world affine")
    return a


def _scalar_volume(data, affine, source):
    if data.ndim != 3 or any(n < 2 for n in data.shape) or not np.isfinite(data).all():
        raise ValueError("Expected one finite, scalar 3D volume")
    return NativeVolume(data, checked_affine(affine), source)


def crop_native_volume(volume: NativeVolume, spec: dict) -> NativeVolume:
    """Select an explicitly documented index subvolume with original samples."""
    if not isinstance(spec, dict) or set(spec) != {"start", "shape", "evidence"}:
        raise ValueError("Native crop requires start, shape and source correspondence evidence")
    if not isinstance(spec["evidence"], str) or not spec["evidence"].strip():
        raise ValueError("Native crop requires source correspondence evidence")
    start, shape = spec["start"], spec["shape"]
    if any(not isinstance(values, (list, tuple)) or len(values) != 3
           or any(type(value) is not int for value in values) for values in (start, shape)):
        raise ValueError("Native crop start and shape require three integer indices")
    if any(a < 0 or n < 2 or a + n > available
           for a, n, available in zip(start, shape, volume.data.shape)):
        raise ValueError("Native crop lies outside the source grid or has insufficient extent")
    translation = np.eye(4)
    translation[:3, 3] = start
    affine = checked_affine(volume.affine) @ translation
    slices = tuple(slice(a, a + n) for a, n in zip(start, shape))
    source = {**volume.source_geometry, "native_crop": {
        "start": list(start), "shape": list(shape), "evidence": spec["evidence"],
        "source_shape": list(volume.data.shape), "source_affine_ras_mm": volume.affine.tolist(),
        "index_operation": "contiguous original voxel subarray; zero-based start, exclusive stop",
        "coordinate_operation": "source affine multiplied by index-origin translation",
        "resampling": "none", "registration": "none"}}
    return _scalar_volume(volume.data[slices], affine, source)


def _read_nifti(img, declared_nifti_units=None, frame=None):
    q, qc = img.get_qform(coded=True)
    s, sc = img.get_sform(coded=True)
    if not qc and not sc:
        raise ValueError("NIfTI must declare a qform or sform")
    if qc and sc and not np.allclose(q, s, atol=1e-3):
        raise ValueError("Conflicting NIfTI qform and sform require adapter-specific evidence")
    header_unit = img.header.get_xyzt_units()[0]
    unit = declared_nifti_units if header_unit == "unknown" and declared_nifti_units else header_unit
    scales = {"mm": 1., "meter": 1000., "micron": .001}
    if unit not in scales:
        raise ValueError(f"Undeclared or unsupported NIfTI spatial unit: {unit}")
    affine = np.diag([scales[unit]] * 3 + [1.]) @ img.affine
    if frame is not None:
        if len(img.shape) != 4 or not isinstance(frame, int) or not 0 <= frame < img.shape[3]:
            raise ValueError("Expected an available zero-based channel in a 4D NIfTI volume")
        data = np.asanyarray(img.dataobj[..., frame])
    else:
        data = np.asanyarray(img.dataobj)
    source = {"format": "NIfTI", "space": "RAS", "units": unit, "header_units": header_unit,
              "unit_basis": "recipe source documentation" if header_unit == "unknown" else "header",
              "qform_code": int(qc), "sform_code": int(sc)}
    if frame is not None:
        source.update(source_shape=list(img.shape), source_channel=frame, channel_extraction="exact; no interpolation")
    return _scalar_volume(data, affine, source)


class NiftiFrameReader:
    """Read individual channels through one file proxy without caching a 4D array."""

    def __init__(self, path, *, declared_nifti_units=None):
        self._image = nib.load(path, keep_file_open=True)
        self._units = declared_nifti_units

    def read(self, frame):
        if self._image is None:
            raise ValueError("The NIfTI frame reader is closed")
        if not isinstance(frame, int) or isinstance(frame, bool):
            raise ValueError("Expected an available zero-based channel in a 4D NIfTI volume")
        return _read_nifti(self._image, self._units, frame)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        # NiBabel owns the handle for the lifetime of its ArrayProxy. Dropping
        # the only image reference releases it on normal or interrupted exit.
        self._image = None


def read_volume(path: Path, *, declared_nrrd_units: str | None = None, declared_nifti_units: str | None = None,
                declared_metaimage_units: str | None = None, frame: int | None = None) -> NativeVolume:
    if path.suffix.lower() == ".mha":
        if frame is not None:
            raise ValueError("A source channel is supported only for a 4D NIfTI volume")
        return _read_metaimage(path, declared_metaimage_units)
    if path.suffix == ".nrrd":
        if frame is not None:
            raise ValueError("A source channel is supported only for a 4D NIfTI volume")
        data, h = nrrd.read(str(path), index_order="F")
        space = h.get("space", "")
        if space not in ("left-posterior-superior", "right-anterior-superior"):
            raise ValueError(f"Unsupported or undeclared NRRD space: {space}")
        units = h.get("space units")
        if units is not None and list(units) != ["mm"] * 3:
            raise ValueError(f"Unsupported NRRD units: {units}")
        if units is None and declared_nrrd_units != "mm":
            raise ValueError("NRRD units require explicit source evidence")
        affine = np.eye(4)
        affine[:3, :3] = np.asarray(h["space directions"]).T
        affine[:3, 3] = h["space origin"]
        if space == "left-posterior-superior":
            affine = np.diag([-1., -1., 1., 1.]) @ affine
        source = {"format": "NRRD", "space": space, "units": "mm", "unit_basis": "header" if units else "recipe source documentation"}
    else:
        return _read_nifti(nib.load(path), declared_nifti_units, frame)
    return _scalar_volume(data, affine, source)


def _read_metaimage(path, declared_units):
    """Read a self-contained MetaImage in ITK LPS with an explicit unit basis."""
    if declared_units != "mm":
        raise ValueError("MetaImage millimeter units require explicit source evidence")
    import SimpleITK as sitk

    header = {}
    with path.open("rb") as stream:
        for _ in range(256):
            line = stream.readline(8192)
            if not line or len(line) >= 8192:
                raise ValueError("Incomplete or oversized MetaImage header")
            try:
                key, sep, value = line.decode("ascii").partition("=")
            except UnicodeDecodeError as exc:
                raise ValueError("Invalid MetaImage header") from exc
            if not sep:
                continue
            key, value = key.strip(), value.strip()
            if key in header:
                raise ValueError(f"Duplicate MetaImage header field: {key}")
            header[key] = value
            if key == "ElementDataFile":
                break
    if header.get("ElementDataFile") != "LOCAL":
        raise ValueError("MetaImage input must contain its original local voxel payload")
    required = {"TransformMatrix", "Offset", "ElementSpacing", "DimSize"}
    if not required.issubset(header) or header.get("NDims") != "3":
        raise ValueError("MetaImage input must explicitly define its complete 3D physical grid")
    reader = sitk.ImageFileReader()
    reader.SetFileName(str(path))
    reader.SetImageIO("MetaImageIO")
    reader.SetNumberOfThreads(1)
    original = reader.Execute()
    if original.GetDimension() != 3 or original.GetNumberOfComponentsPerPixel() != 1:
        raise ValueError("Expected one scalar 3D MetaImage volume")
    direction = np.asarray(original.GetDirection()).reshape(3, 3)
    spacing = np.asarray(original.GetSpacing())
    if not np.isfinite(spacing).all() or np.any(spacing <= 0):
        raise ValueError("MetaImage spacing must be finite and positive")
    lps = np.eye(4)
    lps[:3, :3] = direction @ np.diag(spacing)
    lps[:3, 3] = original.GetOrigin()
    affine = np.diag([-1., -1., 1., 1.]) @ lps
    # SimpleITK returns Z,Y,X storage. This transpose exposes the same voxel
    # indices as X,Y,Z; it neither reorients anatomy nor resamples values.
    data = sitk.GetArrayFromImage(original).transpose(2, 1, 0)
    source = {"format": "MetaImage", "space": "LPS", "units": "mm",
              "unit_basis": "recipe source documentation", "reader": "SimpleITK MetaImageIO",
              "origin_lps_mm": list(original.GetOrigin()), "direction_lps": direction.tolist(),
              "spacing_mm": spacing.tolist(), "source_shape": list(original.GetSize()),
              "header_anatomical_orientation": header.get("AnatomicalOrientation"),
              "array_conversion": "ZYX storage to XYZ indexing; exact original values",
              "coordinate_conversion": "LPS to RAS basis change; original physical points retained"}
    return _scalar_volume(data, affine, source)


def save_nifti(volume: NativeVolume, path: Path):
    image = nib.Nifti1Image(volume.data, volume.affine)
    image.header.set_xyzt_units("mm")
    # sform preserves shear exactly; qform is only coded when representable.
    image.set_sform(volume.affine, code=1)
    image.set_qform(volume.affine, code=0)
    q = image.get_qform()
    if np.allclose(q, volume.affine, atol=1e-5):
        image.set_qform(volume.affine, code=1)
    nib.save(image, path)


def signed_surface_volume(points, faces):
    """Sum oriented tetrahedra in a local float64 frame with bounded memory."""
    reference = np.asarray(points[0], dtype=np.float64)
    partials = []
    for first in range(0, len(faces), 131072):
        triangles = np.asarray(points[faces[first:first + 131072]], dtype=np.float64) - reference
        partials.append(float(np.einsum("ij,ij->i", triangles[:, 0],
                                       np.cross(triangles[:, 1], triangles[:, 2])).sum(dtype=np.float64) / 6))
    return math.fsum(partials)


def surface_from_mask(mask, affine):
    """Extract the unrefined binary half-voxel isosurface in RAS millimeters."""
    indices = np.argwhere(mask)
    if len(indices) == 0:
        raise ValueError("Cannot mesh an empty structure")
    lo, hi = indices.min(axis=0), indices.max(axis=0) + 1
    crop = np.pad(mask[tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))], 1).astype(np.uint8)
    local, faces, _, _ = marching_cubes(crop, level=.5, step_size=1, allow_degenerate=False, method="lorensen")
    vox = local + lo - 1
    points = nib.affines.apply_affine(affine, vox).astype(np.float32)
    # Marching cubes with descent winding yields inward normals in this convention.
    # Reverse only when needed using the signed volume, including reflected affines.
    signed = signed_surface_volume(points, faces)
    if signed < 0:
        faces = faces[:, ::-1].copy()
    # Every vertex must lie on the binary 0.5 level set in the source grid.
    error = float(np.max(np.abs(map_coordinates(crop.astype(float), local.T, order=1) - .5)))
    if error > 1e-5:
        raise ValueError("Surface-to-label level set check failed")
    center = indices.mean(axis=0)
    # The centroid may lie outside a curved structure. Focus on a real member voxel.
    target = indices[np.argmin(np.sum((indices - center) ** 2, axis=1))]
    stats = {
        "voxel_count": len(indices), "volume_mm3": float(len(indices) * abs(np.linalg.det(affine[:3, :3]))),
        "center_ras_mm": nib.affines.apply_affine(affine, center).tolist(),
        "target_ras_mm": nib.affines.apply_affine(affine, target).tolist(),
        "bounds_ras_mm": [points.min(axis=0).tolist(), points.max(axis=0).tolist()],
    }
    qc = {"vertices": len(points), "triangles": len(faces), "level_set_max_error": error,
          "surface_volume_mm3": float(abs(signed)), "surface_volume_method": "Centered float64 oriented tetrahedra",
          "method": "Lorensen edge-intersection marching cubes",
          "topology_review": "not_performed; ambiguous voxel configurations are not repaired",
          "smoothing": False, "decimation": False}
    return points, faces.astype(np.int32), stats, qc


def save_surface(points, faces, path):
    coords = nib.gifti.GiftiCoordSystem(dataspace=0, xformspace=0, xform=np.eye(4))
    arrays = [nib.gifti.GiftiDataArray(points.astype(np.float32), intent="NIFTI_INTENT_POINTSET", coordsys=coords),
              nib.gifti.GiftiDataArray(faces.astype(np.int32), intent="NIFTI_INTENT_TRIANGLE")]
    image = nib.gifti.GiftiImage(darrays=arrays)
    image.meta = nib.gifti.GiftiMetaData({"CoordinateSystem": "RAS", "Units": "mm", "GeometricType": "Anatomical", "Description": "Unsmoothed source label isosurface at 0.5"})
    nib.save(image, path)
