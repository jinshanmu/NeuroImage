"""Exercise independent-source course identity, concurrent saves and position recovery."""
import copy
import json
from pathlib import Path
import uuid

import pytest

from neuroimage import build as pipeline
from neuroimage.courses import TeachingCourse, course_records, get_course, open_course_entry, save_course
from neuroimage.teaching import prepare
from test_model_teaching import model_source
from test_pipeline import source


@pytest.fixture
def mixed_course(model_source, source):
    root, manifest, recipe = model_source
    recipe_path = root / "model-teaching.json"
    recipe_path.write_text(json.dumps(recipe))
    book = json.loads(Path(prepare(manifest, recipe_path, root, minimum_free_gib=0)["notebook"]).read_text())
    image_path = pipeline.build_atlas("synthetic", root, workers=1, minimum_free_gib=0)
    image = json.loads(image_path.read_text())
    scene = {"schema_version": "1.0", "kind": "neuroimage-scene", "title": "Synthetic image view",
             "package_id": image["package_id"], "package_version": image["package_version"],
             "build_signature": image["build"]["signature"], "space_id": image["space"]["id"],
             "state": {"position": [-7.6, -3.5, -4.0], "selected": "synthetic:label:11"},
             "provenance": {"sources": image["sources"], "processing": image["build"]}}
    return root, {"schema_version": "1.0", "kind": "neuroimage-teaching-course", "id": str(uuid.uuid4()),
                  "title": "Independent native source comparison", "author": "Test fixture", "objective": "Preserve each native space",
                  "created_utc": "2026-10-13T00:00:00Z", "updated_utc": "2026-10-13T00:00:00Z", "entries": [
                      {"id": "model", "title": "Original model", "prompt": "Inspect native XYZ", "scene": book["scenes"][0]["scene"]},
                      {"id": "image", "title": "Original image", "prompt": "Inspect native RAS", "scene": scene}]}


def test_mixed_course_preserves_sources_and_recovers_position(mixed_course):
    root, course = mixed_course
    saved = save_course(course, root, minimum_free_gib=0)
    assert save_course(course, root, minimum_free_gib=0)["status"] == "reused"
    assert course_records(root)["courses"][0]["source_count"] == 2
    loaded = get_course(root, course["id"])
    assert loaded["course"]["entries"] == course["entries"]
    assert [item["representation"] for item in loaded["locations"]] == ["surface-model", "mri-labels"]
    registered = []
    def register(path):
        registered.append(Path(path))
        return Path(path).parent.name
    opened = open_course_entry(root, course["id"], "image", saved["revision"], register)
    assert opened["content"] == course["entries"][1]["scene"] and opened["position"] == 1
    assert len(registered) == 1 and registered[0].parent.parent.name == "synthetic"
    assert get_course(root, course["id"])["position"] == 1
    preview = open_course_entry(root, course["id"], "model", saved["revision"], register, persist_position=False)
    assert preview["content"] == course["entries"][0]["scene"]
    assert get_course(root, course["id"])["position"] == 1
    changed = copy.deepcopy(course)
    changed["entries"].reverse()
    with pytest.raises(ValueError, match="another saved revision"):
        save_course(changed, root, minimum_free_gib=0)
    updated = save_course(changed, root, expected_revision=saved["revision"], minimum_free_gib=0)
    assert get_course(root, course["id"])["position"] == 0  # Preserve the entry identity after reordering.
    previous = root / "exports/courses" / course["id"] / "previous-course.json"
    assert json.loads(previous.read_text()) == course
    with pytest.raises(ValueError, match="saved course has changed"):
        open_course_entry(root, course["id"], "model", saved["revision"], register)
    assert open_course_entry(root, course["id"], "model", updated["revision"], register)["content"] == course["entries"][0]["scene"]


def test_missing_source_preserves_portable_course_without_substitution(mixed_course):
    root, course = mixed_course
    course["entries"][0]["scene"]["package_version"] = "historical-missing"
    saved = save_course(course, root, minimum_free_gib=0)
    assert get_course(root, course["id"])["locations"][0]["status"] == "source_required"
    with pytest.raises(ValueError, match="Matching package"):
        open_course_entry(root, course["id"], "model", saved["revision"], lambda _: pytest.fail("A newer source was substituted"))


def test_course_contract_rejects_mixed_identity_damage_and_unsafe_storage(mixed_course, tmp_path):
    root, course = mixed_course
    bad = copy.deepcopy(course)
    bad["entries"][1]["id"] = "model"
    with pytest.raises(ValueError, match="unique"):
        TeachingCourse.model_validate(bad)
    bad = copy.deepcopy(course)
    bad["entries"][1]["scene"].pop("provenance")
    with pytest.raises(ValueError, match="attribution"):
        TeachingCourse.model_validate(bad)
    with pytest.raises(ValueError, match="saved course identifier"):
        get_course(root, "../../outside")
    outside = root.parent / "external-course-store"
    outside.mkdir()
    link = root / "exports/courses"
    link.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="escapes"):
        save_course(course, root, minimum_free_gib=0)
