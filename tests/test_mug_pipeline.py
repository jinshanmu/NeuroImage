"""Cohort execution must preserve original inputs, completed anatomy and reserve."""
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import importlib
import json
from pathlib import Path
import pickle
import threading
from types import SimpleNamespace
import zipfile

import nrrd
import numpy as np
import pytest


@pytest.fixture
def pipeline(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).parents[1] / "scripts"))
    return importlib.import_module("complete_mug500_cases")


def test_case_worker_is_importable_and_pickleable_for_spawn(pipeline):
    assert pickle.loads(pickle.dumps(pipeline.construct_case)) is pipeline.construct_case
    assert "<locals>" not in pipeline.construct_case.__qualname__


def test_default_and_explicit_cases_cannot_escape_inclusion_policy(monkeypatch, pipeline):
    allowed = frozenset({"A0031", "A0101"})
    monkeypatch.setattr(pipeline, "selected_cases", lambda _: allowed)
    assert pipeline.requested_cases(None) == allowed
    assert pipeline.requested_cases(["A0031"]) == {"A0031"}
    for cases in ([], ["A0001"], ["A0031", "A0036"]):
        with pytest.raises(ValueError, match="currently included"):
            pipeline.requested_cases(cases)
    monkeypatch.setattr(pipeline, "selected_cases", lambda _: frozenset())
    with pytest.raises(ValueError, match="inclusion policy"):
        pipeline.requested_cases(None)
    monkeypatch.setattr(pipeline, "selected_cases", lambda _: frozenset(f"A{n:04d}" for n in range(11)))
    with pytest.raises(ValueError, match="inclusion policy"):
        pipeline.requested_cases(None)


def test_only_exact_audited_registration_pairs_are_compatible(pipeline):
    for filename, pairs in pipeline.VTK_REGISTRATION_COMPATIBILITY.items():
        for old, current in pairs:
            assert pipeline.compatible_implementation(filename, old, current)
            assert not pipeline.compatible_implementation(filename, old, "future geometry code")
            assert not pipeline.compatible_implementation(filename, "unreviewed old code", current)
    assert not pipeline.compatible_implementation("geometry.py", "old", "new")
    assert pipeline.compatible_implementation("geometry.py", "unchanged", "unchanged")


def test_declared_six_gib_peak_limits_workers_and_prefetch(tmp_path, monkeypatch, pipeline):
    gib = 1024**3
    source = {"name": "A0001-A0001.zip", "size": gib}
    monkeypatch.setattr(pipeline.shutil, "disk_usage", lambda _: SimpleNamespace(free=500*gib))
    assert pipeline.case_concurrency(tmp_path, 16, 400) == 16
    assert not pipeline.prefetch_fits(tmp_path, source, 400, 16)
    monkeypatch.setattr(pipeline.shutil, "disk_usage", lambda _: SimpleNamespace(free=505*gib))
    assert pipeline.prefetch_fits(tmp_path, source, 400, 16)
    monkeypatch.setattr(pipeline.shutil, "disk_usage", lambda _: SimpleNamespace(free=417*gib))
    assert pipeline.case_concurrency(tmp_path, 16, 400) == 2
    monkeypatch.setattr(pipeline.shutil, "disk_usage", lambda _: SimpleNamespace(free=405*gib))
    with pytest.raises(ValueError, match="construction reserve"):
        pipeline.case_concurrency(tmp_path, 16, 400)


def test_resume_counts_only_remaining_download_bytes(tmp_path, pipeline):
    folder = tmp_path / "downloads/mug500_healthy"
    folder.mkdir(parents=True)
    source = {"name": "A0001-A0001.zip", "size": 100}
    assert pipeline.remaining_download_bytes(source, tmp_path) == 100
    (folder / (source["name"] + ".partial")).write_bytes(b"x"*30)
    assert pipeline.remaining_download_bytes(source, tmp_path) == 70
    (folder / source["name"]).write_bytes(b"x"*100)
    assert pipeline.remaining_download_bytes(source, tmp_path) == 0


def prepared_fixture(tmp_path, pipeline):
    source = {"name": "A0031-A0031.zip"}
    archive_path = tmp_path / "downloads/mug500_healthy" / source["name"]
    archive_path.parent.mkdir(parents=True)
    raw = tmp_path / "raw/mug500_healthy"
    raw.mkdir(parents=True)
    label = raw / "A0031.nrrd"
    nrrd.write(str(label), np.ones((2, 3, 4), dtype=np.uint8), header={
        "space": "left-posterior-superior", "space directions": np.diag([.5, .75, 1.25]),
        "space origin": np.array([5., 6., 7.])})
    contents = {"labels": ("A0031.nrrd", label.read_bytes()), "stl": ("A0031_clear.stl", b"original facets")}
    with zipfile.ZipFile(archive_path, "w") as zipped:
        for filename, content in contents.values():
            zipped.writestr("A0031/" + filename, content)
    archive = {"filename": source["name"], "sha256": pipeline.sha256(archive_path)}
    header = nrrd.read_header(str(label))
    entry = {"archive": archive, "label_header": {"space": header["space"],
        "sizes": header["sizes"].tolist(), "space_directions": header["space directions"].tolist(),
        "space_origin": header["space origin"].tolist()}}
    for kind, (filename, content) in contents.items():
        entry[kind] = {"member": "A0031/" + filename, "target": "raw/mug500_healthy/" + filename,
                       "bytes": len(content), "sha256": pipeline.hashlib.sha256(content).hexdigest()}
    return source, archive, entry


def test_complete_case_reuses_without_reexpanding_released_stl(tmp_path, monkeypatch, pipeline):
    source, archive, entry = prepared_fixture(tmp_path, pipeline)
    monkeypatch.setattr(pipeline, "reusable_package", lambda *a, **k: tmp_path / "validated-manifest.json")
    monkeypatch.setattr(pipeline, "extract_members", lambda *a, **k: pytest.fail("Reexpanded a completed source case"))
    inventory = {"cases": {"A0031": entry}}
    result = pipeline.prepare_archive(source, archive, tmp_path, set(), inventory, 0)
    assert result == [{"case": "A0031", "entry": entry, "already_complete": True}]
    assert not (tmp_path / entry["stl"]["target"]).exists()


def test_conflicting_case_directories_are_not_silently_overwritten(tmp_path, pipeline):
    source, archive, entry = prepared_fixture(tmp_path, pipeline)
    path = tmp_path / "downloads/mug500_healthy" / source["name"]
    with zipfile.ZipFile(path, "a") as zipped:
        zipped.writestr("wrong/A0031.nrrd", b"second label with same case ID")
    with pytest.raises(ValueError, match="case directories"):
        pipeline.prepare_archive(source, archive, tmp_path, set(), {"cases": {}}, 0)


def test_only_persistently_owned_unchanged_stl_is_released_after_resume(tmp_path, pipeline):
    source, archive, entry = prepared_fixture(tmp_path, pipeline)
    target = tmp_path / entry["stl"]["target"]
    target.write_bytes(b"original facets")
    state_path = tmp_path / "state.json"
    state = {"owned_stl": {}}
    identity = pipeline.file_identity(tmp_path / "downloads/mug500_healthy" / source["name"])
    pipeline.release_owned_stl("A0031", entry, tmp_path, state, state_path, identity)
    assert target.exists()  # An identical pre-existing original is not ours.
    pipeline.record_created_stl("A0031", target, entry["stl"], archive, state, state_path)
    resumed = json.loads(state_path.read_text())
    pipeline.release_owned_stl("A0031", entry, tmp_path, resumed, state_path, identity)
    assert not target.exists()
    assert resumed["owned_stl"][entry["stl"]["target"]]["status"] == "released"
    assert (tmp_path / "downloads/mug500_healthy" / source["name"]).is_file()


def test_changed_owned_source_is_preserved(tmp_path, pipeline):
    source, archive, entry = prepared_fixture(tmp_path, pipeline)
    target = tmp_path / entry["stl"]["target"]
    target.write_bytes(b"original facets")
    state_path = tmp_path / "state.json"
    state = {"owned_stl": {}}
    pipeline.record_created_stl("A0031", target, entry["stl"], archive, state, state_path)
    identity = pipeline.file_identity(tmp_path / "downloads/mug500_healthy" / source["name"])
    target.write_bytes(b"changed original")
    with pytest.raises(ValueError, match="preserved"):
        pipeline.release_owned_stl("A0031", entry, tmp_path, state, state_path, identity)
    assert target.read_bytes() == b"changed original"


def test_semantic_reuse_rejects_real_geometry_recipe_or_input_changes(tmp_path, monkeypatch, pipeline):
    source, archive, entry = prepared_fixture(tmp_path, pipeline)
    license_path = tmp_path / "licenses/license.json"
    license_path.parent.mkdir()
    license_path.write_bytes(b"original license")
    name = "mug500_source_mesh_a0031"
    recipe = {"id": name, "inputs": {"stl": entry["stl"]["target"], "license": "licenses/license.json"},
              "archives": [{**archive, "members": [entry["stl"]]}], "space": {"units": "mm"}}
    module_path = Path(__file__).parents[1] / "src/neuroimage"
    code = {filename: pipeline.sha256(module_path / filename) for filename in (
        "adapters.py", "build.py", "geometry.py", "contracts.py", "dataset_policy.py", "lessons.py", "model_geometry.py")}
    audited_old = "older audited registration-only implementation"
    monkeypatch.setattr(pipeline, "VTK_REGISTRATION_COMPATIBILITY", {
        "adapters.py": {(audited_old, code["adapters.py"])}})
    code["adapters.py"] = audited_old
    data = {"dataset_id": name, "build": {"recipe": deepcopy(recipe), "implementation": code,
        "libraries": {key: pipeline.version(key) for key in ("numpy", "scipy", "nibabel", "pynrrd", "scikit-image", "pydantic")},
        "inputs": [{"id": "stl", "path": entry["stl"]["target"], "bytes": entry["stl"]["bytes"], "sha256": entry["stl"]["sha256"]},
                   {"id": "license", "path": "licenses/license.json", "bytes": license_path.stat().st_size, "sha256": pipeline.sha256(license_path)}]}}
    manifest = tmp_path / "derivatives" / name / "old-signature/manifest.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(json.dumps(data))
    monkeypatch.setattr(pipeline, "load_recipe", lambda _: recipe)
    calls = []
    monkeypatch.setattr(pipeline, "validate_package", lambda path, **kw: calls.append(path))
    # Raw STL is absent, but its exact pinned archive member and exported
    # geometry have both survived. A registry edit alone cannot demand a rebuild.
    assert pipeline.reusable_package(name, tmp_path, entry) == manifest
    assert calls == [manifest]
    data["build"]["implementation"]["adapters.py"] = "unreviewed actual adapter change"
    manifest.write_text(json.dumps(data))
    assert pipeline.reusable_package(name, tmp_path, entry) is None
    data["build"]["implementation"]["adapters.py"] = audited_old
    data["build"]["implementation"]["geometry.py"] = "real geometry changed"
    manifest.write_text(json.dumps(data))
    assert pipeline.reusable_package(name, tmp_path, entry) is None
    data["build"]["implementation"]["geometry.py"] = code["geometry.py"]
    manifest.write_text(json.dumps(data))
    recipe["space"]["units"] = "meters"
    assert pipeline.reusable_package(name, tmp_path, entry) is None
    recipe["space"]["units"] = "mm"
    license_path.write_bytes(b"changed source license")
    assert pipeline.reusable_package(name, tmp_path, entry) is None


def test_partial_case_does_not_rebuild_its_complete_mask(tmp_path, monkeypatch, pipeline):
    calls = []
    monkeypatch.setattr(pipeline, "reusable_package", lambda name, *a, **k: tmp_path / "mask.json" if "healthy" in name else None)
    monkeypatch.setattr(pipeline, "build_atlas", lambda name, *a, **k: calls.append(name) or tmp_path / "mesh.json")
    monkeypatch.setattr(pipeline, "validate_package", lambda *a, **k: None)
    result = pipeline.construct_case({"case": "A0031", "root": str(tmp_path), "entry": {"stl": {}}, "workers": 2, "floor": 400})
    assert calls == ["mug500_source_mesh_a0031"]
    assert [item["reused"] for item in result["packages"]] == [True, False]


def test_pending_prefetch_does_not_block_other_batch_downloads(tmp_path, monkeypatch, pipeline):
    root = tmp_path / "data"
    record = root / "licenses/mug500_healthy/official-record-v20.json"
    record.parent.mkdir(parents=True)
    sources = [{"name": f"A{number:04d}-A{number:04d}.zip", "size": 2} for number in range(1, 7)]
    record.write_text(json.dumps({"version": 20, "id": 9616319, "license": {"name": "CC BY 4.0"}, "files": sources}))
    # The run's package/catalog publication stays inside this fixture.
    monkeypatch.setattr(pipeline, "__file__", str(tmp_path / "scripts/complete_mug500_cases.py"))
    catalog = tmp_path / "src/neuroimage/catalogs/mug500-cases.json"
    catalog.parent.mkdir(parents=True)
    catalog.write_text(json.dumps({"cases": {}}))
    later_started = threading.Event()
    calls = []

    def archive(source, root, *_):
        number = int(source["name"][1:5])
        calls.append(number)
        if number == 4:
            assert later_started.wait(3), "Prefetch was awaited before starting the other downloads"
        if number == 5:
            later_started.set()
        path = root / "downloads/mug500_healthy" / source["name"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"ok")
        return {"filename": source["name"], "sha256": pipeline.sha256(path)}

    def prepare(source, archive, *_):
        return [{"case": source["name"][:5], "entry": {"archive": archive}, "already_complete": False}]

    class LocalPool(ThreadPoolExecutor):
        def __init__(self, max_workers, mp_context):
            super().__init__(max_workers=max_workers)

    monkeypatch.setattr(pipeline, "archive_record", archive)
    monkeypatch.setattr(pipeline, "prepare_archive", prepare)
    monkeypatch.setattr(pipeline, "ProcessPoolExecutor", LocalPool)
    monkeypatch.setattr(pipeline, "construct_case", lambda job: {"case": job["case"], "packages": []})
    monkeypatch.setattr(pipeline, "case_concurrency", lambda *a: 3)
    monkeypatch.setattr(pipeline, "prefetch_fits", lambda *a: True)
    monkeypatch.setattr(pipeline, "capacity", lambda *a: None)
    monkeypatch.setattr(pipeline, "load_recipe", lambda *a: {"construction_peak_gib": 6})
    monkeypatch.setattr(pipeline, "selected_cases", lambda _: frozenset(f"A{number:04d}" for number in range(1, 7)))
    pipeline.run(SimpleNamespace(data_root=root, cases=[f"A{number:04d}" for number in range(1, 7)],
        minimum_free_gib=400, parallel_cases=16, workers=2, native_threads=1,
        download=True, build=True, no_prefetch=False, release_new_stl_copies=False))
    assert sorted(calls) == [1, 2, 3, 4, 5, 6]
    assert later_started.is_set()
