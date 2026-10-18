"""Check real native cutaway pixels, unchanged GPU buffers and source-surface picking."""
import argparse
import json
from pathlib import Path
import zipfile

import nibabel as nib
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree


def surface_distance(point, vertices, faces):
    """Measure against nearby original triangles, including their edges."""
    _, near = cKDTree(vertices).query(point, k=min(32, len(vertices)))
    triangles = vertices[faces[np.isin(faces, near).any(axis=1)]]
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    ab, ac, ap = b - a, c - a, point - a
    dot = lambda u, v: np.einsum("ij,ij->i", u, v)
    normal = np.cross(ab, ac)
    norm2 = dot(normal, normal)
    valid = norm2 > 1e-12
    signed = dot(ap, normal) / np.where(valid, norm2, 1)
    projection = ap - signed[:, None] * normal
    d00, d01, d11 = dot(ab, ab), dot(ab, ac), dot(ac, ac)
    denominator = d00 * d11 - d01 * d01
    denominator = np.where(valid, denominator, 1)
    u = (d11 * dot(projection, ab) - d01 * dot(projection, ac)) / denominator
    v = (d00 * dot(projection, ac) - d01 * dot(projection, ab)) / denominator
    inside = valid & (u >= 0) & (v >= 0) & (u + v <= 1)
    distances = list(np.abs(signed[inside]) * np.sqrt(norm2[inside]))
    for start, end in [(a, b), (b, c), (c, a)]:
        edge = end - start
        fraction = np.clip(dot(point - start, edge) / np.maximum(dot(edge, edge), 1e-12), 0, 1)
        distances.extend(np.linalg.norm(point - start - fraction[:, None] * edge, axis=1))
    return float(min(distances))


def check(data_root, log, images):
    result, _ = json.JSONDecoder().raw_decode(log.read_text().split("### Result\n", 1)[1])
    assert result["status"] == "passed"
    records = {item["name"]: item for item in result["records"]}
    package = data_root / "derivatives/mida" / result["package_version"]
    manifest = json.loads((package / "manifest.json").read_text())
    structure = next(item for item in manifest["structures"] if item["id"] == result["source_structure"])
    whole = np.asarray(Image.open(images / "surface-cutaway-whole.png").convert("RGB"))
    height, width, _ = whole.shape
    reference = records["whole"]["draws"][0]
    x, y, w, h = reference["viewport"]
    outside = np.ones((height, width), dtype=bool)
    outside[height - y - h:height - y, x:x + w] = False
    pixel_records = []
    for name in ["superior", "inferior", "right", "anterior", "restored", "imported", "after-picking-restore"]:
        record = records[name]
        assert record["canvas"] == records["whole"]["canvas"]
        for draw in record["draws"]:
            assert (draw["buffer"], draw["revision"], draw["count"]) == (reference["buffer"], reference["revision"], reference["count"])
            assert draw["native_fragment_cut"] and draw["plane"] == record["expected_plane"]
        current = np.asarray(Image.open(images / f"surface-cutaway-{name}.png").convert("RGB"))
        difference = np.any(current != whole, axis=2)
        assert np.count_nonzero(difference[outside]) == 0, "A 3D cut changed complete 2D source-section pixels"
        assert np.count_nonzero(difference[~outside]) > 100, "The fixture did not cut visible source geometry"
        if name in ["restored", "imported", "after-picking-restore"]:
            expected = np.asarray(Image.open(images / "surface-cutaway-anterior.png").convert("RGB"))
            assert np.array_equal(current, expected), "Restored cutaway pixels differ from the recorded source view"
        pixel_records.append({"view": name, "changed_2d_pixels": 0, "changed_3d_pixels": int(np.count_nonzero(difference[~outside]))})
    point = np.asarray(result["picking"]["position_ras_mm"])
    assert point[1] <= 20.02
    assert np.max(np.abs(point - result["picking"]["translucent_position_ras_mm"])) < .011
    assert result["picking"]["zero_opacity_draws"] == []
    for draw in result["picking"]["draws"] + result["picking"]["translucent_draws"]:
        assert draw["picking"] and not draw["blend"] and draw["depth_write"] and draw["plane"] == [0, 1, 0, -20]
    surface = nib.load(str(package / structure["mesh_file"]))
    distance = surface_distance(point, surface.darrays[0].data.astype(float), surface.darrays[1].data)
    # The UI records coordinates to 0.01 mm; use a bound on this quantization,
    # independent of source voxel size, instead of accepting a one-pixel offset.
    assert distance < .02, f"Picked point is {distance} mm from the retained source surface"
    with zipfile.ZipFile(data_root / result["export"]) as archive:
        exported = json.loads(archive.read("scene.json"))
        assert exported["state"] == result["scene"]["state"]
        assert json.loads(archive.read("provenance.json")) == manifest
        renderer = json.loads(archive.read("rendering.json"))
        assert renderer.get("surface_cutaway") and renderer.get("depth_picking")
        for asset in manifest["assets"]:
            if asset["role"] == "license":
                assert archive.read(asset["path"]) == (package / asset["path"]).read_bytes()
    return {"status": "passed", "package_version": result["package_version"], "source_structure": structure["id"],
            "pixels": pixel_records, "source_vertex_buffer_rewrites": 0,
            "picked_ras_mm": point.tolist(), "picked_source_triangle_distance_mm": distance,
            "transparent_and_opaque_pick_identical": True, "expert_review": "Not performed; display and geometry engineering only"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--browser-log", required=True, type=Path)
    parser.add_argument("--images", type=Path, default=Path("output/playwright"))
    args = parser.parse_args()
    print(json.dumps(check(args.data_root, args.browser_log, args.images), indent=2))
