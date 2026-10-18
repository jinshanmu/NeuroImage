"""Original HDF5 scalar arrays with explicit, source-declared physical grids."""
from pathlib import PurePosixPath
import numpy as np
from .geometry import NativeVolume, checked_affine


def _h5py():
    try:
        import h5py
    except ImportError as exc:
        raise ValueError("This source requires h5py; install neuroimage-atlas[hdf5] in the NeuroImage environment") from exc
    return h5py


def original_node(source, path):
    """Reject indirection to other files or unexpected objects before reading."""
    h5py = _h5py()
    parts = PurePosixPath(path)
    if not path or parts.is_absolute() or str(parts) != path or any(p in (".", "..") for p in parts.parts):
        raise ValueError("Expected a normalized internal HDF5 path")
    current = source
    for name in parts.parts:
        if not isinstance(current, h5py.Group) or not isinstance(current.get(name, getlink=True), h5py.HardLink):
            raise ValueError(f"Expected an original internal HDF5 object at {path}")
        current = current[name]
    if (not isinstance(current, h5py.Dataset) or current.is_virtual or current.external
            or current.shape is None or len(current.shape) != 3 or current.dtype.kind not in "biuf"
            or any(n < 2 for n in current.shape) or current.size * current.dtype.itemsize > 4 * 1024 ** 3):
        raise ValueError("Expected an internal finite scalar 3D HDF5 volume within the 4 GiB array budget")
    return current


def text_attribute(value):
    return value.decode("utf-8", errors="strict") if isinstance(value, bytes) else str(value)


def read_hdf5_volume(path, spec):
    """Retain original IJK samples; convert only the explicit coordinate basis."""
    if (spec.get("units") != "mm" or not spec.get("unit_basis")
            or not spec.get("grid_correspondence") or spec.get("array_axis_order") != "IJK"):
        raise ValueError("HDF5 grids require explicit millimeter evidence, IJK order and grid correspondence")
    h5py = _h5py()
    with h5py.File(path, "r") as source:
        dataset = original_node(source, spec["dataset"])
        grid = original_node(source, spec["geometry_dataset"])
        attrs = grid.attrs
        space = text_attribute(attrs.get("space", ""))
        if space not in ("left-posterior-superior", "right-anterior-superior"):
            raise ValueError("The HDF5 source must explicitly declare its anatomical coordinate basis")
        sizes = np.asarray(attrs.get("sizes"))
        directions = np.asarray(attrs.get("space directions"), dtype=float)
        origin = np.asarray(attrs.get("space origin"), dtype=float)
        if (not np.array_equal(sizes, grid.shape) or dataset.shape != grid.shape
                or directions.shape != (3, 3) or origin.shape != (3,)):
            raise ValueError("HDF5 samples must match the declared paired source grid")
        if dataset.name != grid.name:
            for attribute in ("space", "sizes", "space directions", "space origin"):
                if attribute in dataset.attrs and not np.array_equal(dataset.attrs[attribute], attrs[attribute]):
                    raise ValueError("The paired HDF5 label grid conflicts with its declared image grid")
        affine = np.eye(4)
        affine[:3, :3], affine[:3, 3] = directions.T, origin
        checked_affine(affine)
        affine_ras = np.diag([-1., -1., 1., 1.]) @ affine if space == "left-posterior-superior" else affine
        data = dataset[...]
        if not np.isfinite(data).all():
            raise ValueError("HDF5 image samples must all be finite")
        evidence = {"format": "HDF5", "dataset": spec["dataset"], "geometry_dataset": spec["geometry_dataset"],
                    "source_dtype": str(dataset.dtype), "array_axis_order": "IJK", "space": space,
                    "source_affine": affine.tolist(), "units": "mm", "unit_basis": spec["unit_basis"],
                    "grid_correspondence": spec["grid_correspondence"], "resampling": "none",
                    "coordinate_operation": "LPS-to-RAS basis conversion" if space == "left-posterior-superior" else "identity"}
    return NativeVolume(data, checked_affine(affine_ras), evidence)


def validate_hdf5_labels(path, spec, selection):
    """Check original segment names, values and colors without inventing labels."""
    h5py = _h5py()
    with h5py.File(path, "r") as source:
        node = original_node(source, spec["dataset"])
        definitions = {}
        for key in node.attrs:
            if key.endswith("_LabelValue"):
                prefix = key.removesuffix("_LabelValue")
                raw_value = node.attrs[key]
                value = int(raw_value)
                if value != raw_value or value in definitions:
                    raise ValueError("Original HDF5 segment values must be unique integers")
                color = np.asarray(node.attrs[f"{prefix}_Color"], dtype=float)
                if color.shape != (3,) or not np.isfinite(color).all() or np.any(color < 0) or np.any(color > 1):
                    raise ValueError("Original HDF5 segment colors must be finite RGB fractions")
                definitions[value] = {"name": text_attribute(node.attrs[f"{prefix}_Name"]),
                                      "color": np.rint(color * 255).astype(int).tolist()}
        if set(definitions) - {0} != {s["value"] for s in selection}:
            raise ValueError("The selected labels must match the complete original HDF5 segment inventory")
        for item in selection:
            definition = definitions[item["value"]]
            if definition["name"] != item["source_name"] or definition["color"] != item["color"]:
                raise ValueError("A selected HDF5 label differs from its original name or color")
