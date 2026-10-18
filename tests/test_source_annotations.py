"""Verify author-tip transforms, source identity and interrupted annotation reuse."""
import copy
import json
from pathlib import Path

import numpy as np
import pytest

from neuroimage import source_annotations as annotations
from neuroimage.model_teaching import ModelSourceAnnotation
from neuroimage.teaching import prepare
from neuroimage.validation import validate_package
from test_model_teaching import model_source


@pytest.fixture
def source(model_source, monkeypatch):
    root, path, recipe = model_source
    manifest = validate_package(path).model_copy(deep=True)
    manifest.build["recipe"].update(adapter="blender-source-surfaces", mesh_geometry_stage="author-viewport", source_scale_length=1.0)
    manifest.build["libraries"]["blender_embedded_runtime"] = "Synthetic runtime"
    context = manifest.structures[0]
    context.geometry.source_type = "MESH"
    context.geometry.source_stage = "author-viewport"
    specs = [dict(id=name, mapping="blender-hooked-label-tip-v1", source_input=context.geometry.source_input,
                  source_object=name + ".j", source_vertex_index=1, context_structure_id=context.id,
                  reference="Generated annotation fixture; no anatomical interpretation") for name in ("first", "second")]
    monkeypatch.setattr(annotations, "blender_runtime", lambda recipe: ("synthetic-blender", "Synthetic runtime"))
    return root, path, recipe, manifest, specs


def record_for(spec, manifest, signature):
    matrix = [[0, -1000, 0, 500], [1000, 0, 0, -200], [0, 0, 1000, 1600], [0, 0, 0, 1]]
    points = np.array([[.001, .002, .003], [.004, .005, .006]])
    native = points @ np.array(matrix)[:3, :3].T + np.array(matrix)[:3, 3]
    context = annotations.annotation_context(spec, manifest)
    original = next(item for item in manifest.build["inputs"] if item["id"] == spec["source_input"])
    return dict(signature=signature, source_sha256=original["sha256"], spec=spec,
                coordinate_system="SOURCE_XYZ", units="mm", source_stage="author-viewport", embedded_script_execution=False,
                context_object=context.geometry.source_object, context_transform_to_native_mm=context.geometry.transform_to_native_mm,
                source_vertices=points.tolist(), transform_to_native_mm=matrix, points_native_mm=native.tolist(),
                edge_indices=[[0, 1]], polygon_count=0, hook_vertex_indices=[1])


def test_tip_transform_uses_declared_endpoint_and_metric_affine(source):
    _, _, _, manifest, specs = source
    record = record_for(specs[0], manifest, "a" * 64)
    checked = annotations.validate_annotation(record, specs[0], manifest, record["source_sha256"], "a" * 64)
    assert checked["position_native_mm"] == [495, -196, 1606]
    assert record["points_native_mm"][0] == [498, -199, 1603]


@pytest.mark.parametrize("field,value", [
    ("source_sha256", "b" * 64), ("context_object", "Another object"), ("hook_vertex_indices", [0]),
    ("source_stage", "base"), ("embedded_script_execution", True), ("context_transform_to_native_mm", None),
    ("points_native_mm", [[0, 0, 0], [1, 2, 3]]), ("polygon_count", 1),
])
def test_changed_source_mapping_is_rejected(source, field, value):
    _, _, _, manifest, specs = source
    record = record_for(specs[0], manifest, "a" * 64)
    source_hash = record["source_sha256"]
    record[field] = value
    with pytest.raises(ValueError, match="Source annotation"):
        annotations.validate_annotation(record, specs[0], manifest, source_hash, "a" * 64)


def test_text_endpoint_or_boolean_index_cannot_be_selected(source):
    *_, specs = source
    for index in (0, True, 1.0):
        with pytest.raises(ValueError):
            ModelSourceAnnotation.model_validate({**specs[0], "source_vertex_index": index})


def extractor(monkeypatch, manifest, interrupted=False):
    calls = []

    class Process:
        def __init__(self, command):
            request = json.loads(Path(command[-1]).read_text())
            calls.append([item["spec"]["id"] for item in request["annotations"]])
            self.status = 1 if interrupted and len(calls) == 1 else 0
            for item in request["annotations"][:1] if self.status else request["annotations"]:
                path = Path(request["output"]) / (item["key"] + ".json")
                path.write_text(json.dumps(record_for(item["spec"], manifest, request["signature"])))
                path.with_suffix(".sha256").write_text(annotations.sha256(path))

        def wait(self, **kwargs):
            return self.status

        def poll(self):
            return self.status

    monkeypatch.setattr(annotations.subprocess, "Popen", Process)
    return calls


def test_completed_annotations_resume_without_rewriting_after_interruption(source, monkeypatch):
    root, _, _, manifest, specs = source
    calls = extractor(monkeypatch, manifest, interrupted=True)
    steps = [{"source_annotation": spec} for spec in specs]
    with pytest.raises(ValueError, match="interrupted"):
        annotations.prepare_source_annotations(manifest, steps, root, 0)
    first = next((root / "cache").glob("*/source-annotations/*/*.sha256")).with_suffix(".json")
    saved = first.read_bytes(), first.stat().st_mtime_ns
    result = annotations.prepare_source_annotations(manifest, steps, root, 0)
    assert set(result) == {"first", "second"}
    assert calls == [["first", "second"], ["second"]]
    assert annotations.prepare_source_annotations(manifest, steps, root, 0) == result
    assert len(calls) == 2 and (first.read_bytes(), first.stat().st_mtime_ns) == saved
    first.write_text("{}")
    with pytest.raises(ValueError, match="Cached source annotation changed"):
        annotations.prepare_source_annotations(manifest, steps, root, 0)


def test_shared_notebook_retains_each_source_record_and_reuses_without_runtime(source, monkeypatch):
    root, path, recipe, manifest, specs = source
    monkeypatch.setattr("neuroimage.teaching.validate_package", lambda *args, **kwargs: manifest)
    calls = extractor(monkeypatch, manifest)
    for step, spec in zip(recipe["scenes"], specs):
        step["source_annotation"] = spec
        step["display"].update(show_markers=True, center_on_target=True)
    recipe_path = root / "annotations.json"
    recipe_path.write_text(json.dumps(recipe))
    result = prepare(path, recipe_path, root, 0)
    book_path = Path(result["notebook"])
    saved = book_path.read_bytes(), book_path.stat().st_mtime_ns
    for entry in json.loads(saved[0])["scenes"]:
        scene = entry["scene"]; marker = scene["state"]["annotations"][0]
        assert marker["source_annotation"] == scene["provenance"]["source_annotations"][0]
        assert marker["position_native_mm"] == scene["state"]["position_native_mm"] == scene["state"]["focus_native_mm"]
        assert marker["source_annotation"]["source_sha256"]
    monkeypatch.setattr(annotations, "blender_runtime", lambda *args: pytest.fail("A completed notebook should reuse without Blender"))
    assert prepare(path, recipe_path, root, 0)["status"] == "reused"
    assert (book_path.read_bytes(), book_path.stat().st_mtime_ns) == saved
    assert len(calls) == 1
