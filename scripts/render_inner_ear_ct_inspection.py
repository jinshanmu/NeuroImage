"""Render original CT planes and complete source-label geometry for inspection.

This development figure generator consumes the verified source-readiness receipt.
It leaves the original arrays unchanged and keeps source landmarks in the receipt.
"""
import argparse
import hashlib
import json
from pathlib import Path

import h5py
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
import nibabel as nib
import numpy as np

from neuroimage.build import atomic_json, utc_now
from neuroimage.geometry import surface_from_mask


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        while block := stream.read(4 * 1024 ** 2):
            result.update(block)
    return result.hexdigest()


def render(source, receipt, output):
    evidence = json.loads(receipt.read_text())
    if digest(source) != evidence["source_sha256"] or not evidence["publisher_md5_verified"]:
        raise ValueError("The original file must match the verified source receipt")
    output.mkdir(parents=True, exist_ok=True)
    spatial = evidence["spatial_evidence"]
    affine_lps = np.asarray(spatial["source_affine_lps"])
    affine_ras = np.diag([-1., -1., 1., 1.]) @ affine_lps
    with h5py.File(source, "r") as f:
        original_labels = f["label/label-0"][:]
        positions = np.argwhere(original_labels > 0)
        lo = np.maximum(0, positions.min(axis=0) - 12)
        hi = np.minimum(original_labels.shape, positions.max(axis=0) + 13)
        focus = np.rint(positions.mean(axis=0)).astype(int)
        selection = tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))
        labels = original_labels[selection].copy()
        ct = f["raw/raw-0"][selection]
    del original_labels, positions
    crop_affine = affine_ras.copy()
    crop_affine[:3, 3] = nib.affines.apply_affine(affine_ras, lo)
    definitions = [d for d in spatial["source_label_definitions"] if d["value"]]
    colors = {d["value"]: d["color"] for d in definitions}
    legend = [Patch(facecolor=d["color"], edgecolor="0.3", label=f'{d["value"]}: {d["name"]}') for d in definitions]
    credit = "Stebani, Blaimer, Neun, Pelt & Rak | Dataset A specimen 1 | Zenodo 8277159 v1.0 | CC BY 4.0"
    footer = "Reconstructed grid 0.09863 mm; published acquisition slice thickness 0.466 mm. Source-native specimen; side unassigned."
    plt.rcParams.update({"font.size": 13, "font.family": "DejaVu Sans"})
    fig, axes = plt.subplots(1, 3, figsize=(18, 8.5))
    fig.subplots_adjust(left=.05, right=.99, top=.88, bottom=.23, wspace=.25)
    plane_records = []
    for dimension, axis in enumerate(axes):
        local_focus = int(focus[dimension] - lo[dimension])
        image = np.take(ct, local_focus, axis=dimension)
        region = np.take(labels, local_focus, axis=dimension)
        remaining = [d for d in range(3) if d != dimension]
        extent = [lo[remaining[0]] - .5, hi[remaining[0]] - .5,
                  lo[remaining[1]] - .5, hi[remaining[1]] - .5]
        axis.imshow(image.T, origin="lower", cmap="gray", vmin=-600, vmax=2200,
                    interpolation="nearest", extent=extent)
        x = np.arange(lo[remaining[0]], hi[remaining[0]])
        y = np.arange(lo[remaining[1]], hi[remaining[1]])
        for d in definitions:
            mask = region == d["value"]
            if np.any(mask):
                axis.contour(x, y, mask.T, levels=[.5], colors=["0.15"], linewidths=2.8)
                axis.contour(x, y, mask.T, levels=[.5], colors=[colors[d["value"]]], linewidths=1.4)
        axis.set_title(f'Source {"IJK"[dimension]} = {focus[dimension]}')
        axis.set_xlabel(f'Original {"IJK"[remaining[0]]} index')
        axis.set_ylabel(f'Original {"IJK"[remaining[1]]} index')
        axis.set_aspect("equal")
        plane_records.append({"fixed_array_axis": dimension, "source_index": int(focus[dimension])})
    fig.suptitle("Original inner-ear CT with source label contours", fontsize=22)
    fig.legend(handles=legend, loc="lower center", bbox_to_anchor=(.5, .018), ncol=3, frameon=False)
    fig.text(.5, .12, credit, ha="center", fontsize=10)
    fig.text(.5, .085, footer, ha="center", fontsize=9)
    plane_path = output / "specimen-1-original-ct.png"
    fig.savefig(plane_path, dpi=150)
    plt.close(fig)

    meshes, all_points = [], []
    fig = plt.figure(figsize=(13, 11))
    fig.subplots_adjust(left=.02, right=.98, top=.9, bottom=.18)
    axis = fig.add_subplot(111, projection="3d")
    for definition in definitions:
        value = definition["value"]
        points, faces, stats, qc = surface_from_mask(labels == value, crop_affine)
        all_points.append(points)
        collection = Poly3DCollection(points[faces], facecolors=colors[value], edgecolors=None,
                                      linewidth=0, alpha=1, shade=True, zsort="average")
        axis.add_collection3d(collection)
        meshes.append({"value": value, "source_name": definition["name"], "statistics": stats, "quality": qc})
    points = np.concatenate(all_points)
    lower, upper = points.min(axis=0) - .6, points.max(axis=0) + .6
    axis.set(xlim=(lower[0], upper[0]), ylim=(lower[1], upper[1]), zlim=(lower[2], upper[2]))
    axis.set_box_aspect(upper - lower, zoom=1.18)
    axis.set_xlabel("R coordinate (mm)", labelpad=12)
    axis.set_ylabel("A coordinate (mm)", labelpad=12)
    axis.set_zlabel("S coordinate (mm)", labelpad=12)
    axis.view_init(elev=18, azim=60)
    axis.set_proj_type("ortho")
    fig.suptitle("Complete original-label fluid-space surfaces", fontsize=22)
    fig.legend(handles=legend, loc="lower center", bbox_to_anchor=(.5, .015), ncol=3, frameon=False)
    fig.text(.5, .1, credit, ha="center", fontsize=10)
    fig.text(.5, .07, "Half-voxel label isosurfaces | Native physical coordinates expressed in RAS mm", ha="center", fontsize=10)
    mesh_path = output / "specimen-1-complete-3d.png"
    fig.savefig(mesh_path, dpi=150)
    plt.close(fig)
    report = {"created_utc": utc_now(), "source_sha256": evidence["source_sha256"],
              "inspection_receipt_sha256": digest(receipt), "script_sha256": digest(Path(__file__)),
              "crop_ijk": [lo.tolist(), hi.tolist()], "planes": plane_records,
              "ct_display_window_original_units": [-600, 2200], "interpolation": "nearest",
              "source_resampling": "none", "geometry": meshes,
              "geometry_smoothing": False, "geometry_decimation": False,
              "camera": {"projection": "orthographic", "elevation_degrees": 18, "azimuth_degrees": 60},
              "coordinate_conversion": "LPS to RAS basis change; original physical positions retained",
              "attribution": {"authors": ["Jannik Stebani", "Martin Blaimer", "Tilman Neun", "Daniël M. Pelt", "Kristen Rak"],
                              "source_url": "https://doi.org/10.5281/zenodo.8277159",
                              "license": "CC BY 4.0", "license_url": "https://creativecommons.org/licenses/by/4.0/",
                              "changes": "Original CT display window and contour overlay; half-voxel surface extraction and camera projection"},
              "landmarks": "Original index/physical discrepancies retained in source receipt; markers omitted from these inspection figures",
              "atlas_constructed": False, "expert_review": "pending",
              "images": [{"path": p.name, "sha256": digest(p)} for p in (plane_path, mesh_path)]}
    atomic_json(output / "figure-receipt.json", report)
    print(json.dumps({"output": str(output), "images": report["images"], "meshes": len(meshes)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    render(args.source, args.receipt, args.output)
