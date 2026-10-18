"""Prepare mixed native sources reproducibly and resume without replacing user edits."""
import copy
import json
from pathlib import Path

import pytest

from neuroimage import course_plans as plans
from neuroimage.courses import get_course, save_course
from neuroimage.workspace import JobRequest, Workspace
from test_model_teaching import model_source
from test_pipeline import source, build


@pytest.fixture
def plan_fixture(model_source, source, monkeypatch):
    root, model_path, model_recipe = model_source
    image_path = build(source)
    image_recipe = {"schema_version": "1.0", "id": "fixture-image", "dataset_id": "synthetic",
        "required_source": {"id": "synthetic", "version": "1"}, "title": "Synthetic image",
        "author": "Generated fixture", "objective": "Verify native scene retention", "review_status": "draft_not_expert_reviewed",
        "scenes": [{"id": "left", "title": "Synthetic left object", "selected": "synthetic:label:11",
                    "visible": ["synthetic:label:11"], "background": "t1", "prompt": "Inspect generated test geometry", "note": "Synthetic test fixture"}]}
    for name, recipe in [("fixture-image", image_recipe), ("fixture-model", model_recipe)]:
        (root / (name + ".json")).write_text(json.dumps(recipe))
    monkeypatch.setattr(plans, "curriculum_names", lambda: ["fixture-image", "fixture-model"])
    monkeypatch.setattr(plans, "curriculum_path", lambda name: root / (name + ".json"))
    plan = {"schema_version": "1.0", "kind": "neuroimage-course-plan", "id": "native-fixture",
            "title": "Independent native fixture", "author": "Generated fixture", "objective": "Verify source version choices",
            "views": [{"id": "model-first", "curriculum": "fixture-model", "view": "whole"},
                      {"id": "image-second", "curriculum": "fixture-image", "view": "left"},
                      {"id": "model-again", "curriculum": "fixture-model", "view": "cutaway", "prompt": "Recorded source model cut"}]}
    path = root / "course-plan.json"; path.write_text(json.dumps(plan))
    manifests = [json.loads(item.read_text()) for item in [model_path, image_path]]
    keys = {item["dataset_id"]: item["package_id"] + "-" + item["package_version"] for item in manifests}
    return root, path, plan, keys


def test_installed_plans_reference_real_curriculum_views():
    catalog = plans.plan_catalog()
    assert len(catalog) == 26 and sum(item["views"] for item in catalog) == 580
    assert {source["dataset_id"] for item in catalog for source in item["requirements"]} >= {"spl_nac", "cerebra", "cit168_native", "julich_selected", "brainstem_navigator_mni", "hcp1065_tracts", "ixi_mra", "venat", "mesoveins", "mouches_arteries", "mida", "z_anatomy", "mug500_source_mesh", "mug500_healthy", "hba_native"}


def test_interrupted_preparation_retains_notebooks_native_spaces_and_user_revisions(plan_fixture):
    root, path, plan, keys = plan_fixture
    def interrupt(event):
        assert event["completed"] == 1
        raise KeyboardInterrupt("Synthetic interruption after the first saved notebook")
    with pytest.raises(KeyboardInterrupt):
        plans.prepare_course(path, keys, root, minimum_free_gib=0, progress=interrupt)
    state_path = next((root / "exports/course-preparations").glob("*/*/progress.json"))
    state = json.loads(state_path.read_text())
    assert list(state["completed"]) == ["fixture-model"]
    first_path = root / state["completed"]["fixture-model"]["path"]
    first_bytes, first_stamp = first_path.read_bytes(), first_path.stat().st_mtime_ns
    events = []
    result = plans.prepare_course(path, keys, root, minimum_free_gib=0, progress=events.append)
    assert [event["status"] for event in events] == ["reused", "prepared"]
    assert first_path.read_bytes() == first_bytes and first_path.stat().st_mtime_ns == first_stamp
    course = get_course(root, result["course_id"])
    assert [entry["id"] for entry in course["course"]["entries"]] == [view["id"] for view in plan["views"]]
    assert [entry["scene"]["space_id"] for entry in course["course"]["entries"]] == ["synthetic-xyz", "synthetic-ras", "synthetic-xyz"]
    model_book = json.loads(first_bytes)
    assert course["course"]["entries"][0]["scene"] == model_book["scenes"][0]["scene"]
    assert course["course"]["entries"][2]["scene"] == model_book["scenes"][1]["scene"]
    assert course["course"]["entries"][2]["prompt"] == "Recorded source model cut"
    saved_path = Path(result["course"]); stamp = saved_path.stat().st_mtime_ns
    assert plans.prepare_course(path, keys, root, minimum_free_gib=0)["status"] == "reused"
    assert saved_path.stat().st_mtime_ns == stamp
    # Recover the narrow window after saving the course but before its receipt.
    Path(result["receipt"]).unlink()
    assert plans.prepare_course(path, keys, root, minimum_free_gib=0)["course_id"] == result["course_id"]
    assert saved_path.stat().st_mtime_ns == stamp
    edited = copy.deepcopy(course["course"]); edited["title"] = "Instructor adaptation"
    save_course(edited, root, expected_revision=course["revision"], minimum_free_gib=0)
    with pytest.raises(ValueError, match="has been edited"):
        plans.prepare_course(path, keys, root, minimum_free_gib=0)
    assert json.loads(saved_path.read_text())["title"] == "Instructor adaptation"


def test_course_source_choices_fail_before_creating_output(plan_fixture):
    root, path, plan, keys = plan_fixture
    for choices in [{}, {**keys, "synthetic": "unavailable-version"}, {**keys, "another-source": "invented"}]:
        with pytest.raises(ValueError):
            plans.prepare_course(path, choices, root, minimum_free_gib=0)
    assert not (root / "exports/course-preparations").exists()
    plan["views"][0]["view"] = "unknown-source-view"
    path.write_text(json.dumps(plan))
    with pytest.raises(ValueError, match="unavailable"):
        plans.prepare_course(path, keys, root, minimum_free_gib=0)


def test_workspace_course_request_and_recovery_file_boundaries(plan_fixture, monkeypatch):
    root, path, plan, keys = plan_fixture
    monkeypatch.setattr(plans, "plan_names", lambda: ["native-fixture"])
    monkeypatch.setattr(plans, "plan_path", lambda _: path)
    manager = Workspace(root, root.parent / (root.name + "-workspace"), data_floor_gib=0, state_floor_gib=0)
    request = {"action": "prepare-course", "course_plan": "native-fixture", "package_keys": keys}
    try:
        assert manager._request(request) == request
        for invalid in [{**request, "recipe": "synthetic"}, {"action": "prepare-course", "course_plan": "native-fixture"}]:
            with pytest.raises(ValueError):
                JobRequest.model_validate(invalid)
    finally:
        manager.close()
    result = plans.prepare_course(path, keys, root, minimum_free_gib=0)
    receipt = Path(result["receipt"]); original = root / "preserved-original.json"
    original.write_text("Original retained")
    receipt.unlink(); receipt.symlink_to(original)
    with pytest.raises(ValueError, match="regular metadata"):
        plans.prepare_course(path, keys, root, minimum_free_gib=0)
    assert original.read_text() == "Original retained"
