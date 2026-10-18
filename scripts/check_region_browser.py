"""Compare browser samples, GPU geometry and restoration with native source data."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

import nibabel as nib
import numpy as np
from PIL import Image


def read_result(path):
    log = path.read_text()
    if "### Result\n" not in log:
        raise ValueError("Browser acceptance did not return a completed result")
    result, _ = json.JSONDecoder().raw_decode(log.split("### Result\n", 1)[1])
    assert result["status"] == "passed"
    return result


def check_teaching(manifest_path, browser_log, data_root, image_root, notebook_path, curriculum_path):
    manifest = json.loads(manifest_path.read_text())
    result = read_result(browser_log)
    notebook = json.loads(notebook_path.read_text())
    curriculum = json.loads(curriculum_path.read_text())
    assert result["package_version"] == manifest["package_version"] == notebook["package_version"]
    assert result["build_signature"] == manifest["build"]["signature"] == notebook["build_signature"]
    assert result["notebook_id"] == notebook["id"]
    structures = {s["id"]: s for s in manifest["structures"]}
    inputs = manifest["build"]["recipe"]["inputs"]
    output = data_root / result["artifact_directory"]
    exported = json.loads((output / "teaching-notebook.json").read_text())
    assert len(notebook["scenes"]) == len(curriculum["scenes"]) == len(exported["scenes"]) == 6
    scenes = []
    for index, (entry, lesson) in enumerate(zip(notebook["scenes"], curriculum["scenes"])):
        state = entry["scene"]["state"]
        structure = structures[state["selected"]]
        assert structure["id"] == lesson["selected"]
        anchor = lesson.get("source_voxel")
        if anchor:
            source_input = anchor["volume_id"]
            image = nib.load(data_root / inputs[source_input])
            voxel = np.asarray(anchor["index"], dtype=int)
            expected = nib.affines.apply_affine(image.affine, voxel)
            assert float(np.asanyarray(image.dataobj)[tuple(voxel)]) > 0
        else:
            source_input = structure["mask"]["source_input"]
            image = nib.load(data_root / inputs[source_input])
            expected = np.asarray(structure["target_ras_mm"])
            voxel = np.floor(nib.affines.apply_affine(np.linalg.inv(image.affine), expected) + .5).astype(int)
            assert np.asanyarray(image.dataobj)[tuple(voxel)] == 1
        assert np.array_equal(state["position"], expected)
        assert state["position"] == state["focus3D"]
        assert state["pan"][3] == lesson["display"]["slice_zoom"]
        assert state["pan"] == [0, 0, 0, 1], "The default curriculum must retain the full source field of view"
        assert state["overlay"] == lesson["display"]["overlay"]
        assert state["background"] == lesson["background"]
        assert state == exported["scenes"][index]["scene"]["state"]
        probability = nib.load(data_root / inputs[structure["probability"]["source_input"]])
        pi = np.floor(nib.affines.apply_affine(np.linalg.inv(probability.affine), expected) + .5).astype(int)
        support = float(np.asanyarray(probability.dataobj)[tuple(pi)])
        members = []
        for sid, other in structures.items():
            mask = nib.load(data_root / inputs[other["mask"]["source_input"]])
            mi = np.floor(nib.affines.apply_affine(np.linalg.inv(mask.affine), expected) + .5).astype(int)
            if np.asanyarray(mask.dataobj)[tuple(mi)] == 1:
                members.append(sid)
        if lesson["id"] == "overlapping-memberships":
            assert set(members) == {"brainstem_navigator_mni:region:PAG", "brainstem_navigator_mni:region:DR"}
        if lesson["id"] == "support-outside-mask":
            assert support == .15 and structure["id"] not in members
        with zipfile.ZipFile(output / f"view-{index + 1}.zip") as archive:
            assert json.loads(archive.read("scene.json"))["state"] == state
            assert json.loads(archive.read("provenance.json")) == manifest
            rendering = json.loads(archive.read("rendering.json"))
            assert rendering["independent_regions"]["membership"] == "independent source masks; all overlaps retained"
            licenses = [a for a in manifest["assets"] if a["role"] == "license"]
            for asset in licenses:
                assert hashlib.sha256(archive.read(asset["path"])).hexdigest() == asset["sha256"]
            with archive.open("anatomy.png") as file:
                pixels = np.asarray(Image.open(file).convert("RGB"))
            assert pixels.shape[0] >= 500 and pixels.std() > 10
        scenes.append({"index": index + 1, "title": entry["title"], "source_id": structure["id"],
                       "source_input": source_input, "source_voxel": voxel.tolist(), "position_ras_mm": state["position"],
                       "source_probability": support, "source_mask_memberships": members,
                       "export_state": "unchanged", "licenses_verified": len(licenses)})
    initial = np.asarray(Image.open(image_root / "teaching-delivery-1.png"))
    differences = {}
    for name in ("returned", "reimported"):
        other = np.asarray(Image.open(image_root / f"teaching-delivery-{name}.png"))
        assert initial.shape == other.shape
        change = np.abs(initial.astype(int) - other.astype(int))
        changed = np.any(change != 0, axis=2)
        rows, columns = np.where(changed)
        maximum = int(change.max())
        # The complete serialized scene is checked exactly above. Translucent
        # GPU blending can round a few 3D pixels by one 8-bit level between
        # frames. Require bit-identical MRI sections and bound that noise.
        assert maximum <= 1 and len(rows) <= 32
        assert np.all(rows >= initial.shape[0] / 2) and np.all(columns >= initial.shape[1] / 2)
        differences[name] = {"changed_pixels": len(rows), "maximum_channel_delta": maximum,
                             "mri_section_pixel_changes": 0, "scope": "3D translucent blend rounding only"}
    return {**result, "scenes": scenes, "pixel_differences": differences, "renderer": rendering,
            "notebook_sha256": hashlib.sha256(notebook_path.read_bytes()).hexdigest(),
            "source_check": "Original supplied NIfTI probability values, independent mask memberships and affine coordinates, decoded with NiBabel",
            "anatomical_review": "not_performed"}


def check(manifest_path, browser_log, data_root, image_root):
    manifest = json.loads(manifest_path.read_text())
    browser = read_result(browser_log)
    assert browser["status"] == "passed" and browser["package_version"] == manifest["package_version"]
    structures = {s["id"]: s for s in manifest["structures"]}
    inputs = manifest["build"]["recipe"]["inputs"]
    errors, below, threshold = [], 0, 0
    for sid, structure in structures.items():
        image = nib.load(data_root / inputs[structure["probability"]["source_input"]])
        source = np.asanyarray(image.dataobj)
        probes = [probe for probe in browser["probes"] if probe["structure_id"] == sid]
        assert len(probes) >= 2
        for probe in probes:
            ijk = np.floor(nib.affines.apply_affine(np.linalg.inv(image.affine), probe["position_ras_mm"]) + .5).astype(int)
            assert np.all(ijk >= 0) and np.all(ijk < source.shape)
            value = float(source[tuple(ijk)])
            errors.append(abs(probe["displayed_support"] - value))
            below += 0 < value < structure["mask"]["threshold"]
            threshold += value == structure["mask"]["threshold"]
        surface = nib.load(manifest_path.parent / structure["mesh_file"])
        points = surface.get_arrays_from_intent("NIFTI_INTENT_POINTSET")[0].data
        faces = surface.get_arrays_from_intent("NIFTI_INTENT_TRIANGLE")[0].data
        gpu = next(g for g in browser["geometries"] if g["id"] == sid)
        assert gpu["coordinate_sha256"] == hashlib.sha256(points.astype("<f4").tobytes()).hexdigest(), sid
        assert gpu["triangle_sha256"] == hashlib.sha256(faces.astype("<u4").tobytes()).hexdigest(), sid
        assert gpu["point_count"] == len(points) and gpu["triangle_count"] == len(faces)
    assert max(errors) <= .000051 and below and threshold
    overlap = browser["overlap"]
    memberships = []
    for sid, structure in structures.items():
        image = nib.load(data_root / inputs[structure["mask"]["source_input"]])
        ijk = np.floor(nib.affines.apply_affine(np.linalg.inv(image.affine), overlap["position"]) + .5).astype(int)
        if np.asanyarray(image.dataobj)[tuple(ijk)] == 1:
            memberships.append(sid)
    assert sorted(memberships) == overlap["candidates"] and len(memberships) == 2
    selected = manifest["structures"][0]
    mesh = nib.load(manifest_path.parent / selected["mesh_file"])
    points = mesh.get_arrays_from_intent("NIFTI_INTENT_POINTSET")[0].data
    pick = browser["surfacePick"]
    distance = float(np.linalg.norm(points - pick["position_ras_mm"], axis=1).min())
    assert pick["selected"] == selected["name"] and distance <= 1.02
    def pixels(name):
        return np.asarray(Image.open(image_root / ("regions-" + name + ".png")).convert("RGB"))
    def delta(a, b):
        x, y = pixels(a), pixels(b)
        assert x.shape == y.shape, (a, b, x.shape, y.shape)
        return int(np.any(x != y, axis=2).sum())
    surface_change = delta("probability", "probability-no-surface")
    overview_change = delta("full-sections", "magnified-sections")
    overview_restored = delta("full-sections", "full-sections-returned")
    assert overview_change > 100 and overview_restored == 0
    navigation = browser["sectionNavigation"]
    assert navigation["full"] == navigation["returned"] == [0, 0, 0, 1]
    reference = next(v for v in manifest["volumes"] if v["kind"] == "image")
    center = nib.affines.apply_affine(np.asarray(reference["affine_ras_mm"]), (np.asarray(reference["shape"]) - 1) / 2)
    assert np.allclose((center - navigation["magnified"][:3]) / navigation["magnified"][3], navigation["position"])
    mask_change = delta("mask", "mri-only")
    restored, imported = delta("saved", "restored"), delta("saved", "imported")
    assert surface_change == restored == imported == 0
    assert mask_change > 25
    export = data_root / "exports/brainstem_navigator_mni/browser-validation/region-teaching.zip"
    with zipfile.ZipFile(export) as archive:
        scene = json.loads(archive.read("scene.json"))
        evidence = json.loads(archive.read("provenance.json"))
        rendering = json.loads(archive.read("rendering.json"))
        assert evidence == manifest
        assert scene["state"]["focus3D"] == selected["target_ras_mm"] and scene["state"]["pan"][3] == 3
        assert scene["state"]["background"] == "fa" and scene["state"]["overlay"] == "probability"
        assert rendering["independent_regions"]["membership"] == "independent source masks; all overlaps retained"
        for asset in manifest["assets"]:
            if asset["role"] == "license":
                assert hashlib.sha256(archive.read(asset["path"])).hexdigest() == asset["sha256"]
    return {"status": "passed", "package_version": manifest["package_version"], "source_probability_samples": len(errors),
            "maximum_readout_error": max(errors), "positive_below_threshold_samples": below, "inclusive_threshold_samples": threshold,
            "exact_source_meshes_in_gpu": len(structures), "source_overlapping_memberships": memberships,
            "surface_pick_distance_to_original_vertex_mm": distance, "surface_opacity_slice_pixel_changes": surface_change,
            "mask_opacity_pixel_changes": mask_change, "restored_pixel_changes": restored, "imported_pixel_changes": imported,
            "physical_3d_focus_and_section_centering": "passed", "credited_export_with_exact_license": "passed",
            "full_section_navigation": {"magnified_pixel_changes": overview_change, "returned_pixel_changes": overview_restored,
                                        "source_location_and_selection": "unchanged", "default_pan": navigation["full"]},
            "graphics": browser["graphics"], "anatomical_review": "not_performed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--browser-log", type=Path)
    inputs.add_argument("--teaching-log", type=Path)
    parser.add_argument("--notebook", type=Path)
    parser.add_argument("--curriculum", type=Path, default=Path("src/neuroimage/curricula/brainstem-source-regions.json"))
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--image-root", type=Path, default=Path("output/playwright"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.teaching_log:
        if not args.notebook:
            parser.error("--teaching-log requires --notebook")
        result = check_teaching(args.manifest, args.teaching_log, args.data_root, args.image_root, args.notebook, args.curriculum)
    else:
        result = check(args.manifest, args.browser_log, args.data_root, args.image_root)
    text = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.write_text(text)
    print(text)
