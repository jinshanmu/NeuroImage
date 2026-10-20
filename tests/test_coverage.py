"""Source coverage and teaching availability must follow actual package contents."""
from copy import deepcopy

from neuroimage.coverage import source_coverage, source_details, topic_catalog


def test_old_model_does_not_claim_new_specialist_labels():
    old = [{"id": "mida:label:14", "category": "Brainstem"},
           {"id": "mida:label:6", "category": "Ventricles"}]
    coverage = {entry["id"]: entry for entry in source_coverage("mida", old)}
    assert set(coverage) == {"general-anatomy", "brainstem", "ventricles"}
    assert coverage["brainstem"]["structure_ids"] == ["mida:label:14"]
    assert coverage["ventricles"]["structure_ids"] == ["mida:label:6"]
    extended = old + [{"id": "mida:label:103", "category": "Cranial nerves"},
                      {"id": "mida:label:32", "category": "Meninges and CSF"}]
    actual = {entry["id"]: entry for entry in source_coverage("mida", extended)}
    assert actual["cranial-nerves"]["structures"] == 1
    assert actual["cisternal-regions"]["structures"] == 2
    assert "skull-base-context" not in actual
    assert source_coverage("unknown", extended) == []


def test_subordinate_topics_require_actual_source_objects_and_keep_primary_groups():
    old = [{"id": "mida:label:14", "category": "Brainstem"},
           {"id": "mida:label:6", "category": "Ventricles"}]
    assert {entry["id"] for entry in source_coverage("mida", old)} == {"general-anatomy", "brainstem", "ventricles"}
    assert source_details("inner_ear_ct_specimen1", []) == []
    structures = [{"id": f"inner_ear_ct_specimen1:label:{value}", "category": "Inner-ear fluid spaces"} for value in (1, 2, 3)]
    detail = source_details("inner_ear_ct_specimen1", structures)
    assert len(detail) == 1 and detail[0]["id"] == "detail-inner-ear"
    assert detail[0]["parent_id"] == "skull-base-context"
    assert detail[0]["structure_ids"] == [item["id"] for item in structures]
    assert len({topic["id"] for topic in topic_catalog()}) == len(topic_catalog())


def test_image_region_coverage_requires_native_context_without_claiming_cistern_labels():
    entries = [{"id": f"spl_nac:label:{value}", "category": "Brainstem"} for value in (35, 40, 61)]
    coverage = {entry["id"]: entry for entry in source_coverage("spl_nac", entries)}
    assert coverage["cisternal-regions"]["structures"] == 0
    assert "cisternal-regions" not in {entry["id"] for entry in source_coverage("spl_nac", entries[:-1])}
