"""Detailed cerebral topics must follow named anatomy, not loose substrings."""

import pytest

from neuroimage.adapters import load_recipe
from neuroimage.coverage import source_details, topic_catalog


def _details(dataset, structures):
    return {item["id"]: item for item in source_details(dataset, structures)}


def _labels(dataset, values, category):
    return [{"id": f"{dataset}:label:{value}", "category": category}
            for value in values]


def test_cit_subthalamic_and_hypothalamic_subjects_keep_their_distinct_topics():
    structures = _labels("cit168_native", [14, 15, 16], "Deep structures")
    actual = _details("cit168_native", structures)
    assert actual["detail-thalamic-subthalamic"]["structure_ids"] == ["cit168_native:label:16"]
    assert set(actual["detail-hypothalamic-basal-forebrain"]["structure_ids"]) == {
        "cit168_native:label:14", "cit168_native:label:15",
    }


@pytest.mark.parametrize("dataset,ident", [
    ("cit168_native", "cit168_native:label:13"),
    ("z_anatomy", "z_anatomy:object:02b037e87ce1"),
])
def test_habenula_is_explicit_epithalamic_content_not_hypothalamic_content(dataset, ident):
    if dataset == "z_anatomy":
        structures = [item for item in load_recipe(dataset)["objects"] if item["id"] == ident]
        assert len(structures) == 1 and structures[0]["name"] == "Habenula"
    else:
        structures = [{"id": ident, "category": "Deep structures"}]
    actual = _details(dataset, structures)
    assert actual["detail-thalamic-subthalamic"]["structure_ids"] == [ident]
    assert "habenul" in actual["detail-thalamic-subthalamic"]["title"].lower()
    assert "detail-hypothalamic-basal-forebrain" not in actual


@pytest.mark.parametrize("value", [151, 1151])
def test_julich_bed_nucleus_is_a_true_basal_forebrain_subject(value):
    # The bed nucleus of stria terminalis is gray matter despite its name
    # referring to an adjacent pathway. Preserve each actual source side.
    structures = _labels("julich_selected", [value], "Subcortical cytoarchitectonic regions")
    topic = _details("julich_selected", structures)["detail-hypothalamic-basal-forebrain"]
    assert topic["structure_ids"] == [structures[0]["id"]]


def test_thalamic_fiber_context_cannot_alone_qualify_a_nuclear_topic():
    context_ids = {"z_anatomy:object:d420645e96f6", "z_anatomy:object:8378981ae726"}
    structures = [item for item in load_recipe("z_anatomy")["objects"]
                  if item["id"] in context_ids]
    assert {item["id"] for item in structures} == context_ids
    assert "detail-thalamic-subthalamic" not in _details("z_anatomy", structures)


def test_entorhinal_cortex_is_in_medial_temporal_anatomy_without_mixed_diencephalon():
    structures = _labels("cerebra", [36, 87], "Cerebral cortex")
    structures += _labels("cerebra", [26, 77], "Deep structures")
    actual = _details("cerebra", structures)["detail-medial-temporal"]
    assert set(actual["structure_ids"]) == {"cerebra:label:36", "cerebra:label:87"}


def test_orbital_surface_topic_excludes_whole_superior_frontal_gyri():
    structures = load_recipe("z_anatomy")["objects"]
    superior_frontal = {"z_anatomy:object:21552444a6d6", "z_anatomy:object:0a4af6588e2a"}
    actual = _details("z_anatomy", structures)["detail-orbital-frontal"]
    assert not superior_frontal & set(actual["structure_ids"])
    assert {"z_anatomy:object:93bf8c09c1c6", "z_anatomy:object:a06e7a4b44ec"} <= set(actual["structure_ids"])

    context_only = [item for item in structures if item["id"] in superior_frontal]
    assert len(context_only) == 2
    assert "detail-orbital-frontal" not in _details("z_anatomy", context_only)


@pytest.mark.parametrize("topic_id,primary,context_ids", [
    ("detail-central-sulci", "z_anatomy:object:3742982918d8", {
        "z_anatomy:object:000693f70b3e", "z_anatomy:object:aa7ea3e17246",
        "z_anatomy:object:67d21c903861",
    }),
    ("detail-orbital-frontal", "z_anatomy:object:9c52a395c62b", {
        "z_anatomy:object:c1ae492d8bb4", "z_anatomy:object:21552444a6d6",
    }),
    ("detail-superior-temporal", "z_anatomy:object:64fda20b45b4", {
        "z_anatomy:object:2259f9037229", "z_anatomy:object:93763c954cae",
        "z_anatomy:object:6eb869a3ba3c",
    }),
    ("detail-inferior-temporal", "z_anatomy:object:e94fad339dfa", {
        "z_anatomy:object:1e3fab57e504", "z_anatomy:object:aa3da22c4906",
        "z_anatomy:object:26aefbf06f7e", "z_anatomy:object:749ca82610aa",
    }),
    ("detail-occipital-surface", "z_anatomy:object:5cab4cdd0b52", {
        "z_anatomy:object:d67cd647706e", "z_anatomy:object:9819465ea2a7",
        "z_anatomy:object:8a26ee4b8094", "z_anatomy:object:b0de45bdfd87",
    }),
])
def test_detailed_surface_accepts_one_real_subject_but_not_old_adjacent_context(topic_id, primary, context_ids):
    source_objects = load_recipe("z_anatomy")["objects"]
    subject = [item for item in source_objects if item["id"] == primary]
    context = [item for item in source_objects if item["id"] in context_ids]
    assert len(subject) == 1
    assert {item["id"] for item in context} == context_ids
    assert _details("z_anatomy", subject)[topic_id]["structure_ids"] == [primary]
    assert topic_id not in _details("z_anatomy", context)


@pytest.mark.parametrize("topic_id,values", [
    ("detail-medial-temporal", [4, 5]),
    ("detail-striatal-pallidal", [7, 8, 16, 17]),
    ("detail-thalamic-subthalamic", [116]),
    ("detail-hypothalamic-basal-forebrain", [20, 21]),
])
def test_mida_detailed_nuclear_sources_use_actual_named_classes(topic_id, values):
    recipe = load_recipe("mida")
    structures = [{"id": f"mida:label:{item['value']}", "category": item["category"]}
                  for item in recipe["selection"]]
    actual = _details("mida", structures)[topic_id]
    assert set(actual["structure_ids"]) == {f"mida:label:{value}" for value in values}
    # Pineal body and pituitary gland are not substitutes for these structures.
    assert not {"mida:label:3", "mida:label:19"} & set(actual["structure_ids"])


def test_cerebral_detailed_audit_keeps_existing_topic_identities():
    topics = topic_catalog()
    assert len(topics) == 52
    assert len({item["id"] for item in topics}) == 52
    assert len([item for item in topics if item["parent_id"] in {"cerebral-cortex", "deep-nuclei"}]) == 16
