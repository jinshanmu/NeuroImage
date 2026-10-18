"""Review pairs must preserve the actual recorded point and annotated meaning."""
from copy import deepcopy
import io
import json
from pathlib import Path
import zipfile

from PIL import Image
import pytest

from neuroimage.build import atomic_json
from neuroimage.notebook_review import prepare_notebook_review, read_notebook_plan
from neuroimage.review import check_assessment, scene_for
from neuroimage.validation import validate_package
from test_pipeline import source, build


def fixture_export(path, scene, manifest, renderer_digest="a" * 64):
    captured = deepcopy(scene)
    captured["provenance"]["renderer"] = {"build_sha256": renderer_digest, "mesh_projection_in_2d": False, "label_sampling": "nearest-neighbor"}
    image = io.BytesIO(); Image.new("RGB", (64, 64), "gray").save(image, format="PNG")
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("scene.json", json.dumps(captured))
        archive.writestr("provenance.json", json.dumps(manifest))
        archive.writestr("anatomy.png", image.getvalue())


def fixture_notebook(source):
    path = build(source); manifest = validate_package(path)
    scene = scene_for(manifest, manifest.structures[0])
    scene["state"]["annotations"] = [{"id": "regional-fixture", "text": "Generated observation region, not anatomy", "structure_id": None, "position_ras_mm": scene["state"]["position"]}]
    scene["state"]["selectionEvidence"] = {"kind": "teaching-marker", "candidates": []}
    book = {"schema_version": "1.0", "kind": "neuroimage-teaching-notebook", "id": "review-fixture", "title": "Generated regional review fixture",
            **{key: scene[key] for key in ("package_id", "package_version", "build_signature", "space_id")},
            "scenes": [{"id": "first", "title": "Generated image region", "prompt": "Check the source fixture only", "scene": scene}]}
    folder = source[0] / "exports/fixture"; folder.mkdir(parents=True)
    notebook = folder / "notebook.json"; atomic_json(notebook, book)
    original = json.loads(path.read_text())
    fixture_export(folder / "view-1.zip", scene, original)
    enlarged = deepcopy(scene)
    volume = original["volumes"][0]
    center = [row[3] + sum(row[i] * (size - 1) / 2 for i, size in enumerate(volume["shape"])) for row in volume["affine_ras_mm"][:3]]
    enlarged["state"]["pan"] = [value - 3 * enlarged["state"]["position"][axis] for axis, value in enumerate(center)] + [3]
    fixture_export(folder / "view-1-magnified.zip", enlarged, original)
    return notebook, folder, scene, enlarged, original


def test_review_pairs_reuse_exact_views_and_start_without_expert_decisions(source):
    notebook, folder, scene, enlarged, manifest = fixture_notebook(source)
    result = prepare_notebook_review(notebook, folder, source[0], minimum_free_gib=0)
    root = Path(result["packet"]); plan = read_notebook_plan(root)
    assert plan["cases"][0]["title"] == "Generated image region"
    assert plan["cases"][0]["magnified_image_file"] == "images/NI-N001-magnified.png"
    assert "Same source point, magnified" in (root / "index.html").read_text()
    assert prepare_notebook_review(notebook, folder, source[0], minimum_free_gib=0)["status"] == "reused"
    checked = check_assessment(root / "assessment-template.json", root)
    assert checked["criteria_assessed"] == 0 and checked["criteria_total"] == 4
    assert checked["assessment_completion"] == "incomplete"
    assessment = json.loads((root / "assessment-template.json").read_text())
    assessment["items"][0]["criteria"]["teaching"] = "acceptable"
    atomic_json(root / "reviewer-fixture.json", assessment)
    assert check_assessment(root / "reviewer-fixture.json", root)["criteria_assessed"] == 1
    (root / "images/NI-N001.png").write_bytes(b"Changed image")
    with pytest.raises(ValueError, match="image or scene changed"):
        read_notebook_plan(root)


@pytest.mark.parametrize("change", ["point", "marker", "pan", "space", "renderer"])
def test_review_rejects_changed_point_marker_zoom_center_or_native_space(source, change):
    notebook, folder, scene, enlarged, manifest = fixture_notebook(source)
    if change == "point": enlarged["state"]["position"][0] += 1
    elif change == "marker": enlarged["state"]["annotations"][0]["structure_id"] = scene["state"]["selected"]
    elif change == "pan": enlarged["state"]["pan"][1] += 1
    elif change == "space": enlarged["space_id"] = "another-space"
    fixture_export(folder / "view-1-magnified.zip", enlarged, manifest, renderer_digest=("b" if change == "renderer" else "a") * 64)
    with pytest.raises(ValueError):
        prepare_notebook_review(notebook, folder, source[0], minimum_free_gib=0)
    assert not list((source[0] / "benchmarks").glob("*/notebook-review-*"))
