"""Source coverage and teaching availability must follow actual package contents."""
import pytest

from neuroimage.adapters import load_recipe
from neuroimage.coverage import module_catalog, source_coverage, source_details, topic_catalog


EXCLUDED_IMAGE_DATASETS = ["ixi_mra", "hba_native", "mesoveins", "venat", "mouches_arteries", "inner_ear_ct_specimen1"]


def test_old_model_does_not_claim_new_specialist_labels():
    old = [{"id": "mida:label:14", "category": "Brainstem"},
           {"id": "mida:label:6", "category": "Ventricles"}]
    coverage = {entry["id"]: entry for entry in source_coverage("mida", old)}
    assert set(coverage) == {"brainstem", "ventricles"}
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
    assert {entry["id"] for entry in source_coverage("mida", old)} == {"brainstem", "ventricles"}
    assert source_details("inner_ear_ct_specimen1", []) == []
    structures = [{"id": f"inner_ear_ct_specimen1:label:{value}", "category": "Inner-ear fluid spaces"} for value in (1, 2, 3)]
    detail = source_details("inner_ear_ct_specimen1", structures)
    assert detail == []
    assert len({topic["id"] for topic in topic_catalog()}) == len(topic_catalog())


def test_image_region_coverage_requires_native_context_without_claiming_cistern_labels():
    entries = [{"id": f"spl_nac:label:{value}", "category": "Brainstem"} for value in (35, 40, 61)]
    coverage = {entry["id"]: entry for entry in source_coverage("spl_nac", entries)}
    assert coverage["cisternal-regions"]["structures"] == 0
    assert "cisternal-regions" not in {entry["id"] for entry in source_coverage("spl_nac", entries[:-1])}


@pytest.mark.parametrize("dataset,cerebrum", [
    ("spl_nac", "Cerebral cortex"),
    ("cerebra", "Cerebral cortex"),
    ("mida", "Cerebral tissue"),
])
def test_whole_brain_requires_labels_in_every_major_compartment(dataset, cerebrum):
    categories = [cerebrum, "Deep structures", "Ventricles", "Brainstem", "Cerebellum"]
    structures = [{"id": f"{dataset}:fixture:{index}", "category": category}
                  for index, category in enumerate(categories)]
    complete = {item["id"]: item for item in source_coverage(dataset, structures)}
    assert complete["general-anatomy"]["structure_ids"] == [item["id"] for item in structures]
    for missing in categories:
        regional = [item for item in structures if item["category"] != missing]
        assert "general-anatomy" not in {item["id"] for item in source_coverage(dataset, regional)}


def test_regional_atlases_do_not_offer_whole_brain():
    whole = next(item for item in module_catalog() if item["id"] == "general-anatomy")
    assert set(whole["sources"]) == {"spl_nac", "cerebra", "mida"}
    regional_sources = [
        "cit168_native", "brainstem_navigator_mni", "julich_selected", "bigbrain_layers",
    ]
    for dataset in regional_sources:
        groups = {item["id"] for item in source_coverage(dataset)}
        assert "general-anatomy" not in groups
        assert groups


@pytest.mark.parametrize("dataset", [
    "bigbrain_hippocampus",
])
def test_local_sources_remain_in_detailed_topics_without_claiming_primary_groups(dataset):
    assert source_coverage(dataset) == []
    assert source_details(dataset)


@pytest.mark.parametrize("dataset", EXCLUDED_IMAGE_DATASETS)
def test_excluded_image_and_statistical_packages_cannot_restore_anatomy_coverage(dataset):
    # Historical files remain intact, but source fields and old labels cannot
    # restore a source removed from both discovery catalogs.
    structures = [
        {"id": f"{dataset}:region:arterial_occurrence", "category": "Arterial population evidence"},
        {"id": f"{dataset}:label:1", "category": "Vascular anatomy"},
    ]
    assert source_coverage(dataset) == []
    assert source_details(dataset) == []
    assert source_coverage(dataset, structures) == []
    assert source_details(dataset, structures) == []


@pytest.mark.parametrize("dataset", ["mug500_healthy", "mug500_source_mesh"])
def test_whole_skull_background_does_not_claim_named_skull_base_anatomy(dataset):
    assert source_coverage(dataset) == []
    assert source_details(dataset) == []
    assert load_recipe(dataset)["id"] == dataset


@pytest.mark.parametrize("dataset", [
    *[f"nextbrain_case1_block{block}" for block in ("05", "07", "08", "25", "33", "41", "45")],
    *[f"nextbrain_case2_block{block}" for block in ("06", "07", "16", "38")],
])
def test_excluded_nextbrain_packages_cannot_restore_any_anatomy_coverage(dataset):
    # Existing files may remain on disk. Their old labels cannot restore a
    # removed source binding through either discovery API.
    structures = [{"id": f"{dataset}:label:{value}", "category": category}
                  for value, category in (
                      (7, "Cerebral White Matter"), (48, "Caudate"),
                      (218, "Thalamus"), (315, "VentralDC"),
                      (343, "Hippocampus"), (611, "Cerebellum White Matter / Brain stem"),
                      (2017, "Source regional anatomy"),
                  )]
    assert source_coverage(dataset) == []
    assert source_details(dataset) == []
    assert source_coverage(dataset, structures) == []
    assert source_details(dataset, structures) == []


def test_catalogs_exclude_removed_datasets_and_keep_empty_topics_honest():
    for item in [*module_catalog(), *topic_catalog()]:
        assert not any(dataset.startswith("nextbrain_") or dataset in EXCLUDED_IMAGE_DATASETS
                       for dataset in item["sources"])
        assert not any(dataset.startswith("nextbrain_") or dataset in EXCLUDED_IMAGE_DATASETS
                       for dataset in item.get("prefer", []))
    modules = module_catalog()
    assert len(modules) == 11
    assert sum(len(set(module["sources"]) - {"spl_nac_sulci"}) for module in modules) == 49
    topics = topic_catalog()
    assert len(topics) == 52
    assert sum(len(set(topic["sources"]) - {"spl_nac_sulci"}) for topic in topics) == 142
    empty = {topic["id"]: topic for topic in topics if not topic["sources"]}
    assert set(empty) == {
        "detail-regional-cortical-labels", "detail-brainstem-tract-sections",
        "detail-cerebellar-tissue-block", "detail-forebrain-tract-sections",
        "detail-regional-deep-nuclei", "variation-arterial-population",
    }
    for topic in empty.values():
        assert topic["prefer"] == []
        assert "No active sources are currently included" in topic["description"]


@pytest.mark.parametrize("group,expected_sources", [
    ("cerebral-cortex", {"spl_nac", "cerebra", "julich_selected", "bigbrain_layers", "z_anatomy"}),
    ("deep-nuclei", {"spl_nac", "cerebra", "cit168_native", "mida", "julich_selected", "z_anatomy"}),
    ("white-matter-pathways", {"hcp1065_tracts", "hcp1065_prob", "z_anatomy"}),
    ("ventricles", {"spl_nac", "cerebra", "mida", "z_anatomy"}),
    ("brainstem", {"spl_nac", "cerebra", "brainstem_navigator_mni", "mida", "z_anatomy"}),
    ("cerebellum", {"spl_nac", "cerebra", "mida", "suit_cerebellum", "z_anatomy"}),
    ("cranial-nerves", {"spl_nac", "mida", "hcp1065_tracts", "z_anatomy"}),
    ("vascular-anatomy", {
        "mida", "z_anatomy",
        "thu_mra_case001", "thu_mra_case006", "thu_mra_case007", "thu_mra_case009",
        "thu_mra_case010", "thu_mra_case014", "thu_mra_case021", "thu_mra_case030",
    }),
    ("skull-base-context", {"mida", "z_anatomy"}),
])
def test_primary_groups_only_offer_sources_with_declared_group_coverage(group, expected_sources):
    # Tissue blocks, standalone organ scans and unlabelled generic MRI must not
    # reappear as full regional atlas choices merely because they show a neighbor.
    module = next(item for item in module_catalog() if item["id"] == group)
    assert set(module["sources"]) - {"spl_nac_sulci"} == expected_sources


@pytest.mark.parametrize("dataset,retained,excluded", [
    ("spl_nac", "spl_nac:label:11", {"spl_nac:label:17", "spl_nac:label:53"}),
    ("cerebra", "cerebra:label:49", {
        "cerebra:label:17", "cerebra:label:68",  # Optic chiasm.
        "cerebra:label:48", "cerebra:label:99",  # Hippocampal cortex.
        "cerebra:label:26", "cerebra:label:77",  # Mixed ventral diencephalon.
    }),
    ("mida", "mida:label:7", {"mida:label:3", "mida:label:19", "mida:label:5"}),
])
def test_deep_nuclei_excludes_glands_hippocampus_and_mixed_non_nuclear_classes(dataset, retained, excluded):
    structures = [{"id": ident, "category": "Deep structures"} for ident in [retained, *sorted(excluded)]]
    groups = {item["id"]: item for item in source_coverage(dataset, structures)}
    assert groups["deep-nuclei"]["structure_ids"] == [retained]
    assert groups["deep-nuclei"]["structures"] == 1
    assert "deep-nuclei" not in {
        item["id"] for item in source_coverage(dataset, structures[1:])
    }


def test_z_anatomy_callosum_and_hippocampal_or_midbrain_models_keep_their_correct_topics():
    structures = load_recipe("z_anatomy")["objects"]
    groups = {item["id"]: item for item in source_coverage("z_anatomy", structures)}
    assert "z_anatomy:object:a9236e040eba" not in groups["cerebral-cortex"]["structure_ids"]
    assert "z_anatomy:object:93c5ab722fbf" in groups["cerebral-cortex"]["structure_ids"]
    assert not {
        "z_anatomy:object:0dd6c3900f43", "z_anatomy:object:a903410ed86b",  # Hippocampi.
        "z_anatomy:object:1062900a3407", "z_anatomy:object:05560374e331",  # Red nuclei.
    } & set(groups["deep-nuclei"]["structure_ids"])
    assert "z_anatomy:object:9ab895edfb89" in groups["deep-nuclei"]["structure_ids"]
    details = {item["id"]: item for item in source_details("z_anatomy", structures)}
    assert "z_anatomy:object:a9236e040eba" in details["detail-white-commissural"]["structure_ids"]
    assert "z_anatomy:object:0dd6c3900f43" in details["detail-medial-temporal"]["structure_ids"]
    assert "z_anatomy:object:1062900a3407" in details["detail-midbrain-nuclei"]["structure_ids"]


@pytest.mark.parametrize("group,local_ids", [
    ("cerebral-cortex", {"z_anatomy:object:93c5ab722fbf", "z_anatomy:object:51d6e4272db2"}),
    ("deep-nuclei", {"z_anatomy:object:f7ef3d00ca68", "z_anatomy:object:37cada537bd0"}),
])
def test_historical_z_anatomy_with_only_cingulate_or_geniculate_models_cannot_offer_primary_group(group, local_ids):
    # Older constructions contain only the two cingulate context models or
    # lateral geniculate bodies, despite sharing categories with the full model.
    structures = [item for item in load_recipe("z_anatomy")["objects"] if item["id"] in local_ids]
    assert {item["id"] for item in structures} == local_ids
    assert group not in {item["id"] for item in source_coverage("z_anatomy", structures)}
    if group == "cerebral-cortex":
        detail = next(item for item in source_details("z_anatomy", structures) if item["id"] == "detail-medial-cingulate")
        assert set(detail["structure_ids"]) == local_ids
        assert "supplied extent varies" in detail["coverage_note"]


def test_z_anatomy_deep_nuclear_scope_requires_bilateral_caudate_and_thalamus_models():
    core_ids = {
        "z_anatomy:object:9ab895edfb89", "z_anatomy:object:ab926d0f590a",  # Caudate nuclei.
        "z_anatomy:object:0408b7fa277f", "z_anatomy:object:21857d534637",  # Thalami.
    }
    structures = [item for item in load_recipe("z_anatomy")["objects"] if item["id"] in core_ids]
    assert {item["id"] for item in structures} == core_ids
    complete = next(item for item in source_coverage("z_anatomy", structures) if item["id"] == "deep-nuclei")
    assert set(complete["structure_ids"]) == core_ids
    for missing in core_ids:
        partial = [item for item in structures if item["id"] != missing]
        assert "deep-nuclei" not in {item["id"] for item in source_coverage("z_anatomy", partial)}


def test_catalog_navigation_entries_are_objects_when_supplied():
    for item in [*module_catalog(), *topic_catalog()]:
        for dataset, binding in item["sources"].items():
            if "entry" in binding:
                assert isinstance(binding["entry"], dict), (item["id"], dataset)


def test_subthalamic_subregions_are_not_brainstem_labels():
    subthalamic = [
        {"id": f"brainstem_navigator_mni:region:{name}", "category": "Source subregions"}
        for name in ("STh1_l", "STh1_r", "STh2_l", "STh2_r")
    ]
    red_nucleus = {"id": "brainstem_navigator_mni:region:RN1_l", "category": "Source subregions"}
    groups = {item["id"]: item for item in source_coverage("brainstem_navigator_mni", [*subthalamic, red_nucleus])}
    assert groups["brainstem"]["structure_ids"] == [red_nucleus["id"]]
    assert source_coverage("brainstem_navigator_mni", subthalamic) == []
    detail = next(item for item in source_details("brainstem_navigator_mni", subthalamic)
                  if item["id"] == "detail-thalamic-subthalamic")
    assert detail["structure_ids"] == [item["id"] for item in subthalamic]


def test_z_anatomy_primary_cranial_nerve_scope_contains_34_source_nerves_roots_and_meningeal_branches():
    structures = load_recipe("z_anatomy")["objects"]
    nerves = next(item for item in source_coverage("z_anatomy", structures) if item["id"] == "cranial-nerves")
    objects = {item["id"]: item for item in structures}
    assert nerves["structures"] == 34
    assert {objects[ident]["category"] for ident in nerves["structure_ids"]} == {"Cranial nerve models"}
    assert "z_anatomy:object:b82ab3094429" in nerves["structure_ids"]  # Optic nerve.
    assert "z_anatomy:object:a5e3b4802dfb" not in nerves["structure_ids"]  # Oculomotor nucleus.


def test_pathway_topics_do_not_promote_a_whole_tissue_class_to_named_tracts():
    topics = {item["id"] for item in topic_catalog() if item["parent_id"] == "white-matter-pathways"}
    assert topics
    # MIDA's complete cerebral white-matter class is not a named pathway.
    unspecified = [{"id": "mida:label:12", "category": "Cerebral tissue"}]
    assert not topics & {item["id"] for item in source_details("mida", unspecified)}


def test_coverage_records_preserve_source_scope_notes():
    main = next(item for item in source_coverage("mida", [{"id": "mida:label:6", "category": "Ventricles"}])
                if item["id"] == "ventricles")
    assert main["coverage_note"] == "A single source ventricular CSF class; individual ventricular compartments are not separated."
    local = next(item for item in source_details("mida", [
        {"id": "mida:label:116", "category": "Deep structures"},
    ]) if item["id"] == "detail-thalamic-subthalamic")
    assert local["coverage_note"] == "Source thalamus class only; no separate thalamic nuclei, geniculate or STN partitions."
