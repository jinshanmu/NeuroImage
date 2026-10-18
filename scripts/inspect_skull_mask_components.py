"""Inspect original archived skull masks without extracting or modifying them.

Component size is a technical description, not an anatomical classification.
The diagnostic preview is not a cleaned atlas or an accepted teaching image.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import zipfile

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import nrrd
import numpy as np
from scipy import ndimage


def inspect_archive(archive, members, output, minimum_free_gib=400):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output).free < (minimum_free_gib + 1) * 1024 ** 3:
        raise ValueError("Insufficient capacity for the diagnostic output and safety floor")
    rows = []
    figure, axes = plt.subplots(len(members), 3, figsize=(11, 3.1 * len(members)), squeeze=False)
    with zipfile.ZipFile(archive) as source:
        for row, member in enumerate(members):
            info = source.getinfo(member)
            if info.file_size > 64 * 1024 ** 2:
                raise ValueError("A selected compressed NRRD exceeds the diagnostic memory budget")
            original = source.read(member)
            stream = io.BytesIO(original)
            header = nrrd.read_header(stream)
            shape = np.asarray(header["sizes"], dtype=int)
            if shape.size != 3 or np.any(shape <= 0) or np.prod(shape, dtype=np.int64) > 150_000_000:
                raise ValueError("Expected a bounded three-dimensional source mask")
            data = nrrd.read_data(header, stream, index_order="F")
            if not np.all(np.isin(data, [0, 1])):
                raise ValueError("The diagnostic requires an original binary mask")
            mask = data != 0
            foreground = int(np.count_nonzero(mask))
            result = {"member": member, "source_bytes": len(original),
                      "source_sha256": hashlib.sha256(original).hexdigest(),
                      "shape": shape.tolist(), "source_space": header.get("space"),
                      "source_directions": np.asarray(header["space directions"]).tolist(),
                      "source_origin": np.asarray(header["space origin"]).tolist(),
                      "foreground_voxels": foreground, "components": {}}
            for connectivity, neighbors in ((1, 6), (3, 26)):
                labels, count = ndimage.label(mask, ndimage.generate_binary_structure(3, connectivity))
                sizes = np.bincount(labels.ravel())[1:]
                largest = int(sizes.max(initial=0))
                result["components"][str(neighbors)] = {
                    "count": int(count), "largest_voxels": largest,
                    "largest_foreground_fraction": largest / foreground if foreground else 0,
                    "voxels_outside_largest": foreground - largest,
                    "voxels_in_components_up_to_5": int(sizes[sizes <= 5].sum()),
                    "largest_ten_sizes": sorted(sizes.tolist(), reverse=True)[:10]}
                del labels, sizes
            midpoint = (shape // 2).tolist()
            result["diagnostic_cursor_ijk"] = midpoint
            for axis in range(3):
                section = np.take(mask, midpoint[axis], axis=axis).T
                axes[row, axis].imshow(section, origin="lower", cmap="gray", vmin=0, vmax=1,
                                       interpolation="nearest", aspect="equal")
                axes[row, axis].set_title(f"{Path(member).stem} | native axis {axis}, index {midpoint[axis]}", fontsize=9)
                axes[row, axis].set_axis_off()
            rows.append(result)
            print(json.dumps({"case": Path(member).stem, "foreground": foreground,
                              "components_26": result["components"]["26"]}), flush=True)
    figure.suptitle("Original MUG500+ source masks | native index planes, independently centered\n"
                    "No filtering, resampling, cross-case registration or teaching approval", fontsize=11)
    figure.tight_layout(rect=(0, 0, 1, .965))
    figure.savefig(output / "original-mask-sections.png", dpi=130, facecolor="white")
    plt.close(figure)
    receipt = {"schema_version": "1.0", "status": "source_diagnostics_only",
               "source_archive_sha256": hashlib.sha256(Path(archive).read_bytes()).hexdigest(),
               "source_archive_bytes": Path(archive).stat().st_size,
               "method": "Scipy connected-component counts for 6- and 26-neighbor connectivity; original binary foreground is unchanged.",
               "limitation": "Disconnected components can include anatomy; a large connected component can include artifacts. Counts do not authorize anatomical cleanup.",
               "written_source_volumes": 0, "archive_extractions": 0, "cases": rows}
    (output / "component-inspection.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--member", action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--minimum-free-gib", type=float, default=400)
    args = parser.parse_args()
    if args.minimum_free_gib < 0:
        parser.error("The safety floor cannot be negative")
    inspect_archive(args.archive, args.member, args.output, args.minimum_free_gib)
