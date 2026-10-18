from copy import deepcopy
from pathlib import Path

import pytest

from neuroimage.review_queue import assessment_template, canonical_hash, read_queue, validate_suitability
from neuroimage.build import atomic_json, sha256


def plan():
    return {"queue_id": "source-bound-queue", "cases": [
        {"id": "source-a:packet-1:NI-N001", "image_set": [{"sha256": "a" * 64}, {"sha256": "b" * 64}]},
        {"id": "source-b:packet-2:NI-N001", "image_set": [{"sha256": "c" * 64}]}]}


def test_suitability_preserves_source_identity_and_limited_scope():
    queue = plan()
    record = assessment_template(queue)
    record["reviewer"] = "Neurosurgical instructor"
    record["items"][0]["decision"] = "preliminary_suitable"
    result = validate_suitability(record, queue)
    assert result["counts"] == {"needs_revision": 0, "not_reviewed": 1, "preliminary_suitable": 1, "unresolved": 0}
    assert result["anatomical_correctness"] == "Not verified by software"
    assert result["expert_review_in_software_denominator"] is False
    for mutation in ("hash", "duplicate", "scope", "reviewer"):
        altered = deepcopy(record)
        if mutation == "hash":
            altered["items"][0]["image_sha256"][0] = "d" * 64
        elif mutation == "duplicate":
            altered["items"][1] = altered["items"][0]
        elif mutation == "scope":
            altered["scope"] = "The complete atlas is approved"
        else:
            altered["reviewer"] = ""
        with pytest.raises(ValueError):
            validate_suitability(altered, queue)


def test_revisions_require_actionable_notes():
    queue = plan()
    record = assessment_template(queue)
    record["reviewer"] = "Instructor"
    record["items"][0]["decision"] = "needs_revision"
    with pytest.raises(ValueError, match="notes"):
        validate_suitability(record, queue)
    record["items"][0]["notes"] = "The marked position needs a clearer full-section context."
    assert validate_suitability(record, queue)["counts"]["needs_revision"] == 1


def test_queue_check_rejects_modified_image_and_identity(tmp_path):
    folder = tmp_path / "queue"
    packet = tmp_path / "packet"
    folder.mkdir(); packet.mkdir()
    image = packet / "image.png"
    image.write_bytes(b"original source image bytes")
    atomic_json(packet / "review-plan.json", {"case": "one"})
    value = {"kind": "neuroimage-review-queue", "schema_version": "1.0", "cases": [
        {"packet": "packet", "plan_sha256": sha256(packet / "review-plan.json"),
         "image_set": [{"path": "packet/image.png", "sha256": sha256(image)}]}]}
    value["queue_id"] = canonical_hash(value)[:16]
    atomic_json(folder / "queue.json", value)
    assert read_queue(folder, tmp_path)["queue_id"] == value["queue_id"]
    image.write_bytes(b"changed image")
    with pytest.raises(ValueError, match="image changed"):
        read_queue(folder, tmp_path)
    value["queue_id"] = "altered"
    atomic_json(folder / "queue.json", value)
    with pytest.raises(ValueError, match="identity changed"):
        read_queue(folder, tmp_path)
