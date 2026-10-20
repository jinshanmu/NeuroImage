"""Exercise recovery, integrity, provenance and the local serving boundary."""
import hashlib
import json
from pathlib import Path
import threading
import urllib.error
import urllib.request
import nibabel as nib
import numpy as np
import pytest
from neuroimage import build as pipeline
from neuroimage.adapters import ImportedDataset
from neuroimage.server import create_server


@pytest.fixture
def source(tmp_path, monkeypatch):
    affine = np.diag([1.2, 1.5, 2., 1.]); affine[:3, 3] = [-10, -8, -12]
    labels = np.zeros((20, 12, 14), dtype=np.uint16)
    labels[2:6, 3:7, 4:9] = 11; labels[13:17, 3:7, 4:9] = 50
    image = np.arange(labels.size, dtype=np.int16).reshape(labels.shape)
    paths = {}
    for key, array in (("t1", image), ("labels", labels)):
        img = nib.Nifti1Image(array, affine); img.header.set_xyzt_units("mm")
        paths[key] = tmp_path / f"{key}.nii.gz"; nib.save(img, paths[key])
    paths["license"] = tmp_path / "license.txt"; paths["license"].write_text("Synthetic test inputs created by the software tests. CC0.\n")
    recipe = {"id": "synthetic", "title": "Synthetic test package", "version": "1", "source_version": "1", "images": [{"id": "t1", "name": "Synthetic image"}],
              "space": {"id": "synthetic-ras", "name": "Synthetic RAS space", "reference": "Generated asymmetric labels", "correspondence": "Exact shared grid"},
              "inputs": {k: v.name for k, v in paths.items()}, "require_same_grid": True,
              "sources": [{"id": "synthetic", "title": "Synthetic input", "version": "1", "url": "https://example.org/synthetic", "citation": "Generated synthetic fixture", "license_name": "CC0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/", "license_input": "license"}]}
    structures = [{"id": f"synthetic:label:{n}", "name": f"{side} caudate test object", "source_name": f"{side} test object", "label_value": n, "source_values": [n], "category": "Synthetic test", "laterality": side, "color": [75, 180, 190], "evidence": "Generated synthetic input, not anatomy", "source_notes": []} for n, side in [(11, "left"), (50, "right")]]
    imported = ImportedDataset(recipe, paths, structures)
    monkeypatch.setattr(pipeline, "import_dataset", lambda *args: imported)
    return tmp_path, imported


def build(source):
    return pipeline.build_atlas("synthetic", source[0], workers=1, minimum_free_gib=0)


@pytest.fixture
def probability_source(source):
    root, imported = source
    image = nib.load(imported.input_paths["labels"])
    labels = np.asanyarray(image.dataobj)
    fields = np.zeros((*labels.shape, 2), dtype=np.float64)
    fields[..., 0][labels == 11] = .25
    fields[..., 1][labels == 50] = .75
    fields[0, 0, 0, 0] = .24  # Retain support below the navigation threshold.
    fields[2, 3, 4, 1] = .25  # The first channel resolves a tie, including at the threshold.
    path = root / "probabilities.nii.gz"
    volume = nib.Nifti1Image(fields, image.affine); volume.header.set_xyzt_units("mm"); nib.save(volume, path)
    imported.input_paths["probabilities"] = path
    imported.recipe["inputs"]["probabilities"] = path.name
    imported.recipe["hard_label_rule"] = {"method": "maximum-probability-inclusive-threshold", "threshold": .25, "ties": "First source channel wins"}
    imported.recipe["probabilities"] = []
    for index, structure in enumerate(imported.structures):
        ident = f"probability-{index}"
        imported.recipe["probabilities"].append({"id": ident, "name": structure["name"], "input": "probabilities", "channel": index, "label_value": structure["label_value"]})
        structure["probability"] = {"volume_id": ident, "source_input": "probabilities", "source_channel": index,
                                    "interpretation": "Synthetic fractional support", "derivation": "Generated test values; not anatomy"}
    return source, fields


def test_probability_channels_preserve_values_and_threshold_relationship(probability_source, monkeypatch):
    source, fields = probability_source
    path = build(source)
    manifest = pipeline.validate_package(path)
    probabilities = [v for v in manifest.volumes if v.kind == "probability"]
    assert len(probabilities) == 2 and manifest.schema_version == "1.2"
    for index, volume in enumerate(probabilities):
        assert np.array_equal(np.asanyarray(nib.load(path.parent / volume.file).dataobj), fields[..., index])
        assert (volume.cal_min, volume.cal_max) == (0, 1)
    report = json.loads((path.parent / "validation.json").read_text())
    assert report["hard_label_probability_relationship"]["mismatch_voxels"] == 0
    assert report["probability_channels"][0]["source_channel"] == 0
    before = [(a.path, a.sha256) for a in manifest.assets]
    monkeypatch.setattr(pipeline, "read_volume", lambda *args, **kwargs: pytest.fail("A complete verified package must not repeat source array decompression"))
    assert build(source) == path
    assert [(a.path, a.sha256) for a in pipeline.validate_package(path).assets] == before


@pytest.mark.parametrize("value, message", [(1.01, "within 0 to 1"), (.5, "declared probability rule")])
def test_invalid_source_probability_is_not_silently_clamped_or_relabelled(probability_source, value, message):
    source, fields = probability_source
    fields[0, 0, 0, 0] = value
    path = source[1].input_paths["probabilities"]
    old = nib.load(path)
    image = nib.Nifti1Image(fields, old.affine); image.header.set_xyzt_units("mm"); nib.save(image, path)
    original = path.read_bytes()
    with pytest.raises(ValueError, match=message):
        build(source)
    assert path.read_bytes() == original


def test_modified_probability_derivative_fails_semantic_validation(probability_source):
    source, _ = probability_source
    path = build(source)
    manifest = json.loads(path.read_text())
    volume = next(v for v in manifest["volumes"] if v["kind"] == "probability")
    derivative = path.parent / volume["file"]
    image = nib.load(derivative); values = np.asanyarray(image.dataobj).copy(); values[0, 0, 0] = .9
    replacement = nib.Nifti1Image(values, image.affine); replacement.header.set_xyzt_units("mm"); nib.save(replacement, derivative)
    asset = next(a for a in manifest["assets"] if a["path"] == volume["file"])
    asset.update(bytes=derivative.stat().st_size, sha256=hashlib.sha256(derivative.read_bytes()).hexdigest())
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="Probability evidence and categorical labels disagree"):
        pipeline.validate_package(path)


def test_reuse_and_corrupt_asset_repair(source):
    path = build(source); manifest = pipeline.validate_package(path)
    original_manifest = path.read_bytes()
    image = path.parent / manifest.volumes[0].file; mtime = image.stat().st_mtime_ns
    assert build(source) == path
    assert path.read_bytes() == original_manifest
    assert image.stat().st_mtime_ns == mtime
    mesh = path.parent / manifest.structures[0].mesh_file
    other = path.parent / manifest.structures[1].mesh_file; other_mtime = other.stat().st_mtime_ns
    data = mesh.read_bytes(); mesh.write_bytes(b"invalid" + data[7:])
    with pytest.raises(ValueError, match="mismatch"):
        pipeline.validate_package(path)
    build(source)
    pipeline.validate_package(path)
    assert mesh.read_bytes() == data
    assert other.stat().st_mtime_ns == other_mtime
    assert image.stat().st_mtime_ns == mtime


def test_interruption_preserves_completed_work(source, monkeypatch):
    save = pipeline.save_surface
    def fail_second(points, faces, target):
        if "50.gii" in str(target):
            raise RuntimeError("Simulated interruption")
        save(points, faces, target)
    monkeypatch.setattr(pipeline, "save_surface", fail_second)
    with pytest.raises(RuntimeError, match="Simulated"):
        build(source)
    states = list(source[0].glob("derivatives/synthetic/*/.build-state.json"))
    assert len(states) == 1
    checkpoint = json.loads(states[0].read_text())
    assert "mesh:synthetic:label:11" in checkpoint["completed"]
    assert "mesh:synthetic:label:50" not in checkpoint["completed"]
    first = states[0].parent / "meshes/label-11.gii"; mtime = first.stat().st_mtime_ns
    monkeypatch.setattr(pipeline, "save_surface", save)
    path = build(source)
    assert first.stat().st_mtime_ns == mtime
    pipeline.validate_package(path)
    assert json.loads(states[0].read_text())["status"] == "complete"


def test_changed_input_creates_new_version(source):
    first = build(source)
    source[1].input_paths["license"].write_text("Changed synthetic source notice.\n")
    second = build(source)
    assert first.parent != second.parent
    assert first.is_file()


def test_label_model_keeps_geometry_without_inventing_images_or_sides(source):
    from neuroimage.contracts import Manifest
    from neuroimage.review import prepare_review
    recipe = source[1].recipe
    recipe.update(representation="label-model", images=[])
    recipe["inputs"].pop("t1"); source[1].input_paths.pop("t1")
    for structure in source[1].structures:
        structure["laterality"] = "unspecified"
    path = build(source)
    manifest = pipeline.validate_package(path)
    assert manifest.schema_version == "1.2" and manifest.representation == "label-model"
    assert [v.kind for v in manifest.volumes] == ["labels"]
    report = json.loads((path.parent / "validation.json").read_text())
    assert report["laterality_order_check"].startswith("not_applicable")
    assert report["image_label_grids"] == []
    root = prepare_review(path, source[0], minimum_free_gib=0)
    scene = json.loads((root / "scenes/NI-R001.json").read_text())
    assert scene["state"]["background"] == "labels"
    bad = manifest.model_dump(); bad["representation"] = "mri-labels"
    with pytest.raises(ValueError, match="image volume is required"):
        Manifest.model_validate(bad)
    bad = manifest.model_dump(); bad["schema_version"] = "1.0"
    with pytest.raises(ValueError, match="requires schema 1.1"):
        Manifest.model_validate(bad)


def test_storage_floor_precedes_output_creation(source):
    with pytest.raises(ValueError, match="safety floor"):
        pipeline.build_atlas("synthetic", source[0], minimum_free_gib=1e9)
    assert not (source[0] / "derivatives").exists()


def test_server_only_exposes_selected_files(source):
    manifest_path = build(source)
    web = source[0] / "web"; web.mkdir(); (web / "index.html").write_text("<!doctype html><title>Synthetic viewer</title>")
    outside = source[0] / "private.txt"; outside.write_text("Private source root file")
    server = create_server([manifest_path], web, 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(url + "/api/atlases") as response:
            entry = json.load(response)["atlases"][0]
        with urllib.request.urlopen(url + entry["manifest_url"]) as response:
            manifest = json.load(response)
            assert response.headers["X-Content-Type-Options"] == "nosniff"
        with urllib.request.urlopen(url + entry["base_url"] + manifest["volumes"][0]["file"]) as response:
            assert hashlib.sha256(response.read()).hexdigest() == next(a["sha256"] for a in manifest["assets"] if a["path"] == manifest["volumes"][0]["file"])
        for path in ("/private.txt", "/../private.txt", "/%2e%2e/private.txt", entry["base_url"] + ".build-state.json",
                     entry["base_url"] + ".geometry-validation-cache.json", "/assets/../../private.txt"):
            with pytest.raises(urllib.error.HTTPError) as exc:
                urllib.request.urlopen(url + path)
            assert exc.value.code == 404
        req = urllib.request.Request(url + "/api/atlases", headers={"Host": "foreign.example"})
        with pytest.raises(urllib.error.HTTPError) as exc:
            urllib.request.urlopen(req)
        assert exc.value.code == 403
    finally:
        server.shutdown(); server.server_close(); thread.join()






def test_startup_content_matches_exact_package_and_never_exposes_its_directory(source):
    from neuroimage.review import scene_for
    manifest_path = build(source)
    manifest = pipeline.validate_package(manifest_path)
    scene = scene_for(manifest, manifest.structures[0])
    content = source[0] / "chosen-scene.json"; content.write_text(json.dumps(scene))
    web = source[0] / "web"; web.mkdir(); (web / "index.html").write_text("<!doctype html><title>Synthetic viewer</title>")
    server = create_server([manifest_path], web, 0, content_path=content)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    url = f"http://127.0.0.1:{server.server_port}"
    try:
        with urllib.request.urlopen(url + "/api/atlases") as response:
            catalog = json.load(response)
        assert catalog["startup"]["atlas_key"] == catalog["atlases"][0]["key"]
        content.write_text("User changes after server startup")
        with urllib.request.urlopen(url + catalog["startup"]["content_url"]) as response:
            assert json.load(response) == scene
        for path in ("/chosen-scene.json", "/api/../chosen-scene.json"):
            with pytest.raises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(url + path)
            assert error.value.code == 404
    finally:
        server.shutdown(); server.server_close(); thread.join()
    scene["space_id"] = "other-space"; content.write_text(json.dumps(scene))
    with pytest.raises(ValueError, match="does not match"):
        create_server([manifest_path], web, 0, content_path=content)


@pytest.mark.parametrize("field", ["affine", "target", "count"])
def test_manifest_cannot_misrepresent_actual_geometry(source, field):
    path = build(source)
    manifest = json.loads(path.read_text())
    if field == "affine":
        manifest["volumes"][0]["affine_ras_mm"][0][0] *= -1
    elif field == "target":
        manifest["structures"][0]["target_ras_mm"] = [0, 0, 0]
    else:
        manifest["structures"][0]["voxel_count"] += 1
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="geometry mismatch|member voxel|count mismatch"):
        pipeline.validate_package(path)


def test_shifted_mesh_with_updated_hash_is_still_rejected(source):
    path = build(source)
    manifest = json.loads(path.read_text()); spec = manifest["structures"][0]
    target = path.parent / spec["mesh_file"]
    mesh = nib.load(target); mesh.darrays[0].data[:, 0] += 3
    nib.save(mesh, target)
    spec["bounds_ras_mm"][0][0] += 3; spec["bounds_ras_mm"][1][0] += 3
    asset = next(a for a in manifest["assets"] if a["path"] == spec["mesh_file"])
    asset.update(bytes=target.stat().st_size, sha256=pipeline.sha256(target))
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="source label boundary"):
        pipeline.validate_package(path)


def test_review_packet_preserves_drafts_and_starts_without_judgments(source):
    from neuroimage.review import prepare_review, check_assessment
    path = build(source)
    root = prepare_review(path, source[0], minimum_free_gib=0)
    report = check_assessment(root / "assessment-template.json", root)
    assert report["assessment_completion"] == "incomplete"
    assert report["criteria_assessed"] == 0
    assessment = json.loads((root / "assessment-template.json").read_text())
    assessment["overall_notes"] = "Preserve this local reviewer draft."
    (root / "assessment-template.json").write_text(json.dumps(assessment))
    assert prepare_review(path, source[0], minimum_free_gib=0) == root
    assert "Preserve this local reviewer draft" in (root / "assessment-template.json").read_text()
    assert not list((root / "scenes").glob("NI-L*-step*.json"))
    assert all(item["kind"] == "structure" for item in assessment["items"])
    assert not (root / "source-lessons.json").exists()
    plan_path = root / "review-plan.json"
    plan = json.loads(plan_path.read_text())
    plan["lessons"] = [{"id": "historical-lesson"}]
    plan_path.write_text(json.dumps(plan))
    before = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
    with pytest.raises(ValueError, match="testing branch"):
        check_assessment(root / "assessment-template.json", root)
    assert all(p.read_bytes() == content for p, content in before.items())


def test_review_accepts_legacy_packages_without_optional_probability_fields(source):
    from neuroimage.review import prepare_review, check_assessment
    path = build(source)
    data = json.loads(path.read_text()); data["schema_version"] = "1.0"; data.pop("representation")
    for structure in data["structures"]:
        structure.pop("probability")
    path.write_text(json.dumps(data))
    root = prepare_review(path, source[0], minimum_free_gib=0)
    assert check_assessment(root / "assessment-template.json", root)["criteria_assessed"] == 0


def test_probability_review_retains_evidence_and_offers_explicit_label_comparison(probability_source):
    import io, zipfile
    from PIL import Image
    from neuroimage.review import prepare_review, validate_capture, check_assessment
    source, _ = probability_source
    root = prepare_review(build(source), source[0], minimum_free_gib=0)
    plan = json.loads((root / "review-plan.json").read_text()); case = plan["cases"][0]
    scene = json.loads((root / case["scene_file"]).read_text())
    comparison = json.loads((root / case["categorical_scene_file"]).read_text())
    assert scene["state"]["overlay"] == "probability" and comparison["state"]["overlay"] == "labels"
    assert scene["state"]["position"] == comparison["state"]["position"]
    assert "Synthetic fractional support" in (root / "index.html").read_text()
    assert check_assessment(root / "assessment-template.json", root)["criteria_assessed"] == 0
    comparison["provenance"]["renderer"] = {"build_sha256": "a" * 64, "mesh_projection_in_2d": False, "label_sampling": "nearest-neighbor"}
    buffer = io.BytesIO(); Image.new("RGB", (20, 20), "white").save(buffer, format="PNG")
    capture = root / "captures" / "wrong-evidence.zip"
    with zipfile.ZipFile(capture, "w") as archive:
        archive.writestr("anatomy.png", buffer.getvalue()); archive.writestr("scene.json", json.dumps(comparison))
        archive.writestr("provenance.json", (root / "source-manifest.json").read_bytes())
    with pytest.raises(ValueError, match="source probability overlay"):
        validate_capture(capture, plan, case)


def test_review_rejects_another_source_and_never_certifies_anatomy(source):
    from neuroimage.review import prepare_review, check_assessment
    root = prepare_review(build(source), source[0], minimum_free_gib=0)
    path = root / "assessment-template.json"; data = json.loads(path.read_text())
    data["space_id"] = "different-space"; path.write_text(json.dumps(data))
    with pytest.raises(ValueError, match="different review packet"):
        check_assessment(path, root)
    data["space_id"] = "synthetic-ras"
    data["reviewer"].update(name="Synthetic test fixture", qualifications="Generated test record, not an expert", date="2026-10-12")
    for item in data["items"]:
        item["criteria"] = {key: "acceptable" for key in item["criteria"]}
    path.write_text(json.dumps(data))
    report = check_assessment(path, root)
    assert report["assessment_completion"] == "complete"
    assert "not independently verified" in report["scope"]
    assert "anatomical_review" not in report


def test_review_capture_identity_and_resumable_assembly(source):
    import io, zipfile
    from PIL import Image
    from neuroimage.review import prepare_review, assemble_review
    root = prepare_review(build(source), source[0], minimum_free_gib=0)
    plan = json.loads((root / "review-plan.json").read_text()); case = plan["cases"][0]
    scene = json.loads((root / case["scene_file"]).read_text())
    scene["provenance"]["renderer"] = {"build_sha256": "a" * 64, "mesh_projection_in_2d": False, "label_sampling": "nearest-neighbor", "renderer": "Synthetic capture fixture"}
    buffer = io.BytesIO(); Image.new("RGB", (20, 20), "white").save(buffer, format="PNG")
    def capture(value):
        with zipfile.ZipFile(root / "captures" / (case["id"] + ".zip"), "w") as archive:
            archive.writestr("anatomy.png", buffer.getvalue())
            archive.writestr("scene.json", json.dumps(value))
            archive.writestr("provenance.json", (root / "source-manifest.json").read_bytes())
    wrong = json.loads(json.dumps(scene)); wrong["state"]["selected"] = "unknown"
    capture(wrong)
    with pytest.raises(ValueError, match="wrong target"):
        assemble_review(root)
    wrong = json.loads(json.dumps(scene)); wrong["provenance"]["renderer"]["mesh_projection_in_2d"] = True
    capture(wrong)
    with pytest.raises(ValueError, match="rendering policy"):
        assemble_review(root)
    capture(scene)
    report = assemble_review(root)
    assert report["status"] == "partial" and report["captured"] == 1
    assert report["anatomical_review"] == "not_performed"
    image = root / case["image_file"]; mtime = image.stat().st_mtime_ns
    assert assemble_review(root)["captured"] == 1
    assert image.stat().st_mtime_ns == mtime
    assert not list((root / "captures").glob("*.zip"))
    image.write_bytes(b"Damaged reproducible review image")
    assert assemble_review(root)["captured"] == 0
    wrong = json.loads(json.dumps(scene)); wrong["state"]["position"] = []
    capture(wrong)
    with pytest.raises(ValueError, match="source target"):
        assemble_review(root)


def test_library_discovers_complete_interrupted_and_damaged_builds(source, monkeypatch):
    from neuroimage.library import library_records
    path = build(source)
    root = source[0]
    partial = root / 'derivatives' / 'synthetic' / 'interrupted'
    partial.mkdir()
    (partial / '.build-state.json').write_text(json.dumps({'completed': {'volume:t1': {}}}))
    malformed = root / 'derivatives' / 'synthetic' / 'bad-metadata'
    malformed.mkdir()
    (malformed / 'manifest.json').write_text('{not valid JSON')
    monkeypatch.setattr('neuroimage.validation.read_volume', lambda *args: pytest.fail('Library discovery must not decompress image arrays'))
    records = library_records(root)
    assert {r['status'] for r in records} == {'available', 'incomplete', 'unavailable'}
    available = next(r for r in records if r['status'] == 'available')
    assert available['manifest'] == str(path) and available['structures'] == 2
    assert available['asset_hashes'] == available['geometry'] == 'not_checked'
    assert next(r for r in records if r['status'] == 'incomplete')['completed_assets'] == 1
    assert library_records(root, dataset='not-present') == []
    manifest = json.loads(path.read_text())
    (path.parent / manifest['assets'][0]['path']).write_bytes(b'damaged')
    assert next(r for r in library_records(root) if r['folder_version'] == path.parent.name)['status'] == 'unavailable'


def test_saved_content_locates_exact_historical_package_and_rejects_guessing(source):
    from neuroimage.library import locate_content
    path = build(source)
    manifest = json.loads(path.read_text())
    binding = {'package_id':manifest['package_id'], 'package_version':manifest['package_version'],
               'build_signature':manifest['build']['signature'], 'space_id':manifest['space']['id']}
    scene = {'kind':'neuroimage-scene', 'schema_version':'1.0', **binding}
    content = source[0] / 'source-bound-scene.json'
    content.write_text(json.dumps(scene))
    source[1].recipe['version'] = '2'
    newer = build(source)
    assert newer != path
    assert locate_content(content, source[0])['manifest'] == str(path)
    scene['package_version'] = 'unavailable-version'; content.write_text(json.dumps(scene))
    with pytest.raises(ValueError, match='newer version is not substituted'):
        locate_content(content, source[0])


def test_notebook_locator_is_unavailable_in_the_anatomy_release(source):
    from neuroimage.library import content_binding, locate_content
    path = build(source); manifest = json.loads(path.read_text())
    binding = {'package_id':manifest['package_id'], 'package_version':manifest['package_version'],
               'build_signature':manifest['build']['signature'], 'space_id':manifest['space']['id']}
    scene = {'kind':'neuroimage-scene', 'schema_version':'1.0', **binding}
    notebook = {'kind':'neuroimage-teaching-notebook', 'schema_version':'1.0', **binding, 'scenes':[{'scene':scene}]}
    content = source[0] / 'teaching-notebook.json'; content.write_text(json.dumps(notebook))
    with pytest.raises(ValueError, match='Expected a NeuroImage scene'):
        locate_content(content, source[0])
    assert json.loads(content.read_text()) == notebook
    content.write_text(json.dumps({'kind':'not-supported', **binding}))
    with pytest.raises(ValueError, match='Expected a NeuroImage scene'):
        content_binding(content)


def test_geometry_cache_reuses_only_after_hashing_and_refresh_rechecks(source, monkeypatch):
    import neuroimage.validation as validation
    import neuroimage.validation_cache as cache
    path = build(source)
    original = validation.validate_geometry
    calls = []
    def observed(*args):
        calls.append(True)
        return original(*args)
    monkeypatch.setattr(validation, 'validate_geometry', observed)
    statistics = {}
    validation.validate_package(path, cache_policy='reuse', statistics=statistics)
    assert statistics['geometry'] == 'fresh' and statistics['cache_written']
    validation.validate_package(path, cache_policy='reuse', statistics=statistics)
    assert statistics['geometry'] == 'reused_after_asset_hashing' and statistics['asset_sha256'] == 'fresh'
    assert len(calls) == 1
    validation.validate_package(path, cache_policy='refresh', statistics=statistics)
    assert statistics['geometry'] == 'fresh' and len(calls) == 2
    monkeypatch.setattr(cache, 'VALIDATOR_ID', 'different-loaded-validator')
    validation.validate_package(path, cache_policy='reuse', statistics=statistics)
    assert statistics['geometry'] == 'fresh' and len(calls) == 3
    with pytest.raises(ValueError, match='fresh asset hashing'):
        validation.validate_package(path, verify_hashes=False, cache_policy='reuse')


def test_cached_validation_still_rejects_same_size_asset_corruption(source):
    from neuroimage.validation import validate_package
    path = build(source)
    manifest = validate_package(path, cache_policy='reuse')
    asset = path.parent / manifest.assets[0].path
    original = asset.read_bytes()
    asset.write_bytes(bytes([original[0] ^ 1]) + original[1:])
    with pytest.raises(ValueError, match='checksum/size mismatch'):
        validate_package(path, cache_policy='reuse')


def test_changed_manifest_and_voxels_cannot_reuse_a_geometry_receipt(source):
    from neuroimage.validation import validate_package
    path = build(source)
    manifest = validate_package(path, cache_policy='reuse').model_dump()
    labels = next(v for v in manifest['volumes'] if v['kind'] == 'labels')
    file = path.parent / labels['file']
    native = nib.load(file); values = np.asanyarray(native.dataobj).copy()
    values[2,3,4] = 0
    nib.save(nib.Nifti1Image(values,native.affine,native.header),file)
    asset = next(a for a in manifest['assets'] if a['path'] == labels['file'])
    asset.update(bytes=file.stat().st_size,sha256=pipeline.sha256(file))
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match='volume/count mismatch'):
        validate_package(path, cache_policy='reuse')


def test_package_remains_valid_when_optional_cache_cannot_be_written(source, monkeypatch):
    import neuroimage.validation_cache as cache
    from neuroimage.validation import validate_package
    path = build(source)
    def readonly(*args):
        raise PermissionError('Read-only package directory')
    monkeypatch.setattr(cache.os, 'replace', readonly)
    statistics = {}
    validate_package(path, cache_policy='refresh', statistics=statistics)
    assert statistics['geometry'] == 'fresh' and not statistics['cache_written']
    assert not list(path.parent.glob('.validation-*.partial'))


def test_new_probability_source_does_not_inherit_cit168_anatomical_claims(probability_source):
    from neuroimage.lessons import make_lessons
    source, _ = probability_source
    lesson_file = make_lessons(source[1].recipe, source[1].structures)
    assert len(lesson_file['lessons']) == 1
    assert set(lesson_file['lessons'][0]['structure_ids']) == {s['id'] for s in source[1].structures}
    content = json.dumps(lesson_file).lower()
    for source_specific in ('reflection', '24 manually', 'population', 'observer'):
        assert source_specific not in content
    assert all(lesson['review_status'] == 'draft_not_expert_reviewed' for lesson in lesson_file['lessons'])
