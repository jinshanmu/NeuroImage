"""Verify actual GPU coordinates and slice pixels against original TrackVis records."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import struct
import zipfile

import nibabel as nib
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

from neuroimage.library import library_records


def source_lines(data_root, recipe, package, structure, level_id):
    """Read the original acquisition, without using the construction decoder."""
    level = next(item for item in structure["streamlines"]["levels"] if item["id"] == level_id)
    indices = json.loads((package / level["indices_file"]).read_text())["indices"]
    selected = set(indices)
    filename = recipe["inputs"][structure["streamlines"]["source_input"]]
    with gzip.open(data_root / filename, "rb") as stream:
        tracks = nib.streamlines.TrkFile.load(stream, lazy_load=True)
        lines = [np.asarray(line, dtype="<f4") for i, line in enumerate(tracks.streamlines) if i in selected]
    if len(lines) != level["streamline_count"] or sum(map(len, lines)) != level["point_count"]:
        raise ValueError("Original source subset count differs from the manifest")
    return lines


def digest(lines):
    value = hashlib.sha256()
    for line in lines:
        value.update(struct.pack("<I", len(line)))
        value.update(line.tobytes())
    return value.hexdigest()


def source_distance(lines, position, section_axis=None, slab=1):
    """Independent Euclidean segment distance; only slab intersections in 2D."""
    a = np.concatenate([line[:-1] for line in lines]).astype(np.float64)
    b = np.concatenate([line[1:] for line in lines]).astype(np.float64)
    position = np.asarray(position)
    if section_axis is not None:
        axis = section_axis
        valid = (np.minimum(a[:, axis], b[:, axis]) <= position[axis] + slab / 2) & (np.maximum(a[:, axis], b[:, axis]) >= position[axis] - slab / 2)
        a, b = a[valid], b[valid]
        delta = b - a
        moving = np.abs(delta[:, axis]) > 1e-12
        start, end = np.zeros(len(a)), np.ones(len(a))
        low = (position[axis] - slab / 2 - a[moving, axis]) / delta[moving, axis]
        high = (position[axis] + slab / 2 - a[moving, axis]) / delta[moving, axis]
        start[moving] = np.maximum(0, np.minimum(low, high))
        end[moving] = np.minimum(1, np.maximum(low, high))
        a, b = a + start[:, None] * delta, a + end[:, None] * delta
        a[:, axis] = b[:, axis] = position[axis]
    delta = b - a
    length = np.sum(delta ** 2, axis=1)
    t = np.clip(np.divide(np.sum((position - a) * delta, axis=1), length, out=np.zeros(len(a)), where=length != 0), 0, 1)
    return float(np.min(np.linalg.norm(position - a - t[:, None] * delta, axis=1)))


def section_matrices(fixture, slab, position):
    sections = []
    for draw in fixture["draws"]:
        matrix = np.asarray(draw["matrix"]).reshape(4, 4).T
        scale = np.linalg.norm(matrix[2, :3])
        if np.isclose(scale, 2 / slab, rtol=0, atol=1e-5):
            if abs((matrix @ [*position, 1])[2]) > 1e-4:
                raise ValueError("The section is not centered on the physical cursor")
            axis = int(np.argmax(np.abs(matrix[2, :3])))
            if np.count_nonzero(np.abs(matrix[2, :3]) > 1e-5) != 1:
                raise ValueError("The physical orthogonal section has an unexpected axis")
            sections.append((axis, matrix, draw["viewport"]))
    return sections


def check_pixels(fixture, lines, color, filename, slab, position):
    pixels = np.asarray(Image.open(filename).convert("RGB"))
    height, width = pixels.shape[:2]
    canvas = fixture["canvas"]
    scale = np.asarray(fixture["css"]) / canvas
    a = np.concatenate([line[:-1] for line in lines]).astype(np.float64)
    b = np.concatenate([line[1:] for line in lines]).astype(np.float64)
    findings = []
    for axis, matrix, viewport in section_matrices(fixture, slab, position):
        start = a @ matrix[:3, :3].T + matrix[:3, 3]
        end = b @ matrix[:3, :3].T + matrix[:3, 3]
        valid = (np.minimum(start[:, 2], end[:, 2]) <= 1) & (np.maximum(start[:, 2], end[:, 2]) >= -1)
        start, end = start[valid], end[valid]
        delta = end - start
        moving = np.abs(delta[:, 2]) > 1e-12
        low, high = np.zeros(len(start)), np.ones(len(start))
        t0 = (-1 - start[moving, 2]) / delta[moving, 2]
        t1 = (1 - start[moving, 2]) / delta[moving, 2]
        low[moving] = np.maximum(0, np.minimum(t0, t1))
        high[moving] = np.minimum(1, np.maximum(t0, t1))
        clipped_a, clipped_b = start + low[:, None] * delta, start + high[:, None] * delta
        left, bottom, view_width, view_height = viewport

        def project(points):
            return np.column_stack(((left + (points[:, 0] + 1) * view_width / 2) * scale[0],
                                    (canvas[1] - bottom - (points[:, 1] + 1) * view_height / 2) * scale[1]))

        prediction = Image.new("1", (width, height))
        painter = ImageDraw.Draw(prediction)
        for first, last in zip(project(clipped_a), project(clipped_b)):
            painter.line([tuple(first), tuple(last)], fill=1)
        expected = np.asarray(prediction)
        region = np.zeros((height, width), dtype=bool)
        x0, x1 = int(left * scale[0]), min(width, int(np.ceil((left + view_width) * scale[0])) + 1)
        y0 = max(0, int((canvas[1] - bottom - view_height) * scale[1]))
        y1 = min(height, int(np.ceil((canvas[1] - bottom) * scale[1])) + 1)
        region[y0:y1, x0:x1] = True
        observed = (np.max(np.abs(pixels.astype(int) - color), axis=2) <= 2) & region
        count = int(observed.sum())
        # Thin sections through a sparse source bundle can contain only a few
        # pixels. Require observable evidence on each axis without inventing a
        # density threshold for anatomy or widening the source slab to pass.
        if count < 1:
            raise ValueError(f"Insufficient source-colored pixels in {filename.name}, axis {axis}: {count}")
        distances = distance_transform_edt(~expected)[observed]
        fraction = float(np.mean(distances <= 2.5))
        if fraction < .98:
            raise ValueError(f"Source-to-pixel mismatch in {filename.name}, axis {axis}: {fraction:.5f}")
        findings.append({"ras_axis": axis, "source_colored_pixels": count,
                         "fraction_within_2_5_pixels": fraction,
                         "maximum_distance_pixels": float(distances.max())})
    return findings


def check(data_root, browser_log, image_root):
    text = browser_log.read_text()
    result, _ = json.JSONDecoder().raw_decode(text.split("### Result\n", 1)[1])
    if result.get("status") != "passed":
        raise ValueError("Browser acceptance did not finish")
    matches = [item for item in library_records(data_root) if item.get("status") == "available"
               and item["dataset_id"] == "hcp1065_tracts" and item["package_version"] == result["package_version"]]
    if len(matches) != 1:
        raise ValueError("The fixture does not identify one available atlas package")
    package = Path(matches[0]["manifest"]).parent
    manifest = json.loads((package / "manifest.json").read_text())
    recipe = json.loads((Path(__file__).resolve().parents[1] / "src/neuroimage/recipes/hcp1065_tracts.json").read_text())
    fixtures, original = [], {}
    for fixture in result["fixtures"]:
        structure = next(item for item in manifest["structures"] if item["id"] == fixture["id"])
        lines = source_lines(data_root, recipe, package, structure, fixture["level"])
        original[structure["source_name"]] = lines
        geometry = fixture["geometries"][0]
        if digest(lines) != geometry["coordinate_sha256"] or not geometry["index_order_complete"]:
            raise ValueError("Actual GPU coordinate/index buffers differ from original source trajectories")
        if not np.array_equal(lines[0][0], geometry["first_point"]) or not np.array_equal(lines[-1][-1], geometry["last_point"]):
            raise ValueError("First or last source trajectory was changed or omitted")
        sections = section_matrices(fixture, 1, fixture["position_ras_mm"])
        if sorted(item[0] for item in sections) != [0, 1, 2]:
            raise ValueError("The viewer did not render all three 1 mm orthogonal source slabs")
        pixels = check_pixels(fixture, lines, structure["color"], image_root / f"streamlines-{fixture['source_name']}.png", 1, fixture["position_ras_mm"])
        fixtures.append({"id": fixture["id"], "streamlines": len(lines), "points": sum(map(len, lines)),
                         "source_gpu_coordinate_sha256": geometry["coordinate_sha256"], "sections": pixels})
    picking = result["picking"]
    pointer_distances = {"slice_mm": source_distance(original["AF_L"], picking["slice"]["position"], section_axis=2),
                         "render_mm": source_distance(original["AF_L"], picking["render"]["position"])}
    if max(pointer_distances.values()) > 1.02:
        raise ValueError(f"Real pointer picks do not match displayed source segments: {pointer_distances}")
    for name in ("CC", "CST_L"):
        if source_distance(original[name], picking["overlap"]["position"]) > 1e-8:
            raise ValueError("The overlap fixture is not on both original source bundles")
    first = manifest["structures"][0]
    detail = source_lines(data_root, recipe, package, first, "detail")
    if digest(detail) != result["detail"]["geometries"][0]["coordinate_sha256"]:
        raise ValueError("The changed display level is not its original source subset")
    if len(section_matrices(result["detail"], 3, first["target_ras_mm"])) != 3:
        raise ValueError("The detail view did not restore all physical 3 mm sections")
    neurological = section_matrices(result["neurological"], 3, first["target_ras_mm"])
    radiological = section_matrices(result["fixtures"][0], 1, first["target_ras_mm"])
    if len(neurological) != 1 or neurological[0][0] != 2:
        raise ValueError("The neurological axial section has an unexpected axis")
    radio = next(item[1] for item in radiological if item[0] == 2)
    if radio[0, 0] >= 0 or neurological[0][1][0, 0] <= 0:
        raise ValueError("Radiological and neurological views have incorrect left/right projection signs")
    names = ["slice-opaque", "slice-3d-hidden", "slice-mri-only", "slice-thick", "saved", "restored", "imported"]
    images = {name: np.asarray(Image.open(image_root / f"streamlines-{name}.png").convert("RGB")) for name in names}
    if len({image.shape for image in images.values()}) != 1:
        raise ValueError("The canvas dimensions changed during pixel comparison")
    differences = {}
    for first_name, last_name, expected in [("slice-opaque", "slice-3d-hidden", False), ("slice-opaque", "slice-mri-only", True),
                                          ("slice-opaque", "slice-thick", True), ("saved", "restored", False), ("saved", "imported", False)]:
        count = int(np.any(images[first_name] != images[last_name], axis=2).sum())
        differences[f"{first_name}_to_{last_name}"] = count
        if (expected and count < 100) or (not expected and count):
            raise ValueError(f"Unexpected pixel changes: {first_name} to {last_name}: {count}")
    output = data_root / "exports/hcp1065_tracts/browser-validation"
    scene = json.loads((output / "streamline-scene.json").read_text())
    if scene["state"]["streamlineLevel"] != "detail" or scene["state"]["streamlineSlabMm"] != 3:
        raise ValueError("The portable scene lost its source display controls")
    with zipfile.ZipFile(output / "streamline-teaching.zip") as archive:
        if json.loads(archive.read("scene.json"))["state"] != scene["state"]:
            raise ValueError("The credited export lost the source scene")
        rendering = json.loads(archive.read("rendering.json"))
        if not rendering.get("streamline_rendering"):
            raise ValueError("The credited export omitted the trajectory rendering interpretation")
        licenses = [asset for asset in manifest["assets"] if asset["role"] == "license"]
        for asset in licenses:
            if archive.read(asset["path"]) != (package / asset["path"]).read_bytes():
                raise ValueError("The credited export changed or omitted a source license")
    return {"status": "passed", "dataset_id": manifest["dataset_id"], "package_version": manifest["package_version"],
            "fixtures": fixtures, "detail_source_gpu_digest": digest(detail), "pixel_differences": differences,
            "pointer_distances": pointer_distances, "overlap": picking["overlap"],
            "licenses_verified": len(licenses), "graphics": result["graphics"], "renderer_sha256": rendering["build_sha256"],
            "scope": "Engineering source/GPU, physical slabs, left/right, pixels, scene and export validation; anatomy review separate"}


def check_teaching(data_root, browser_log, image_root, notebook_path):
    text = browser_log.read_text()
    result, _ = json.JSONDecoder().raw_decode(text.split("### Result\n", 1)[1])
    if result.get("status") != "passed":
        raise ValueError("The installed teaching fixture did not finish")
    notebook = json.loads(notebook_path.read_text())
    matches = [item for item in library_records(data_root) if item.get("status") == "available"
               and item["dataset_id"] == result["package_id"] and item["package_version"] == result["package_version"]]
    if len(matches) != 1 or notebook["id"] != result["notebook_id"]:
        raise ValueError("The teaching fixture does not identify its exact source notebook and package")
    package = Path(matches[0]["manifest"]).parent
    manifest = json.loads((package / "manifest.json").read_text())
    recipe = manifest["build"]["recipe"]
    output = data_root / result["artifact_directory"]
    exported_book = json.loads((output / "teaching-notebook.json").read_text())
    original_points, scenes = {}, []
    for index, entry in enumerate(notebook["scenes"]):
        state = entry["scene"]["state"]
        structure = next(item for item in manifest["structures"] if item["id"] == state["selected"])
        evidence = structure["streamlines"]
        if structure["id"] not in original_points:
            with gzip.open(data_root / recipe["inputs"][evidence["source_input"]], "rb") as stream:
                for line_index, line in enumerate(nib.streamlines.TrkFile.load(stream, lazy_load=True).streamlines):
                    if line_index == evidence["target_streamline_index"]:
                        original_points[structure["id"]] = np.asarray(line[evidence["target_point_index"]]).tolist()
                        break
        if state["position"] != original_points[structure["id"]] or state != exported_book["scenes"][index]["scene"]["state"]:
            raise ValueError("The notebook lost an exact original trajectory target or display state")
        with zipfile.ZipFile(output / f"view-{index + 1}.zip") as archive:
            if state != json.loads(archive.read("scene.json"))["state"]:
                raise ValueError("A teaching image export lost the captured scene state")
            rendering = json.loads(archive.read("rendering.json"))
            if not rendering.get("streamline_rendering"):
                raise ValueError("A teaching image omitted trajectory interpretation")
            licenses = [asset for asset in manifest["assets"] if asset["role"] == "license"]
            for asset in licenses:
                if archive.read(asset["path"]) != (package / asset["path"]).read_bytes():
                    raise ValueError("A teaching view changed or omitted source notices")
            with archive.open("anatomy.png") as file:
                image = np.asarray(Image.open(file).convert("RGB"))
            if image.shape[0] < 600 or float(image.std()) < 10:
                raise ValueError("The teaching image is empty or lacks its credited footer")
        scenes.append({"index": index + 1, "title": entry["title"], "source_id": structure["id"],
                       "original_line_index": evidence["target_streamline_index"], "original_vertex_index": evidence["target_point_index"],
                       "position_ras_mm": state["position"], "display_level": state["streamlineLevel"], "slab_mm": state["streamlineSlabMm"],
                       "export_state": "unchanged", "licenses_verified": len(licenses)})
    initial = np.asarray(Image.open(image_root / "teaching-delivery-1.png"))
    differences = {}
    for name in ("returned", "reimported"):
        other = np.asarray(Image.open(image_root / f"teaching-delivery-{name}.png"))
        if initial.shape != other.shape:
            raise ValueError("The restored teaching canvas changed dimensions")
        differences[name] = int(np.any(initial != other, axis=2).sum())
        if differences[name]:
            raise ValueError("The restored teaching canvas changed pixels")
    return {**result, "scenes": scenes, "pixel_differences": differences, "renderer": rendering,
            "notebook_sha256": hashlib.sha256(notebook_path.read_bytes()).hexdigest(),
            "source_check": "Original TRK line and vertex indices, independently decoded with NiBabel",
            "anatomical_review": "not_performed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, type=Path)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--browser-log", type=Path)
    inputs.add_argument("--teaching-log", type=Path)
    parser.add_argument("--notebook", type=Path)
    parser.add_argument("--image-root", type=Path, default=Path("output/playwright"))
    args = parser.parse_args()
    if args.teaching_log:
        if not args.notebook:
            parser.error("--teaching-log requires --notebook")
        result = check_teaching(args.data_root, args.teaching_log, args.image_root, args.notebook)
    else:
        result = check(args.data_root, args.browser_log, args.image_root)
    print(json.dumps(result, indent=2))
