"""Detailed anatomy choices must select their actual source subjects.

These fixtures use bundled recipes or small labelled inventories. They need no
acquired images, constructed atlas packages, or external medical-data directory.
"""

import pytest

from neuroimage.adapters import load_recipe
from neuroimage.coverage import source_coverage, source_details, topic_catalog


def _details(dataset, structures):
    return {item["id"]: item for item in source_details(dataset, structures)}


def _navigator(names):
    recipe = load_recipe("brainstem_navigator_mni")
    regions = {item["source_name"]: item for item in recipe["regions"]}
    return [{**regions[name], "id": f"brainstem_navigator_mni:region:{name}"}
            for name in names]


@pytest.mark.parametrize("topic", topic_catalog(), ids=lambda topic: topic["id"])
def test_context_only_package_cannot_advertise_a_detailed_subject(topic):
    for dataset, binding in topic["sources"].items():
        if binding.get("image_regions"):
            # Image observations/statistical fields declare their evidence
            # instead of claiming a segmented anatomical object.
            assert binding.get("coverage_note"), (topic["id"], dataset)
            continue
        primary = set(binding.get("required_any_ids", []))
        assert primary, (topic["id"], dataset)
        # Even every declared context object, with every matching category,
        # cannot substitute for a missing actual subject in an older package.
        categories = binding.get("categories", ["Source regional anatomy"])
        context = [{"id": ident, "category": category}
                   for ident in set(binding.get("structure_ids", []) + binding.get("required_ids", [])) - primary
                   for category in categories]
        assert topic["id"] not in _details(dataset, context), (topic["id"], dataset)


def test_runtime_coverage_identifies_subjects_separately_from_visible_context():
    subject = "z_anatomy:object:0408b7fa277f"  # Left thalamus.
    context = "z_anatomy:object:d420645e96f6"  # Left stria medullaris.
    structures = [item for item in load_recipe("z_anatomy")["objects"]
                  if item["id"] in {subject, context}]
    assert {item["id"] for item in structures} == {subject, context}
    coverage = _details("z_anatomy", structures)["detail-thalamic-subthalamic"]
    assert coverage["structure_ids"] == [item["id"] for item in structures]
    assert coverage["primary_structure_ids"] == [subject]


PEDUNCLE_IDS = {
    "z_anatomy:object:1e12a040ef3f",  # Left floccular peduncle.
    "z_anatomy:object:9e0926c7b485",  # Right floccular peduncle.
    "z_anatomy:object:594191852a4b",  # Left superior cerebellar peduncle.
    "z_anatomy:object:46485639a093",  # Right superior cerebellar peduncle.
}


def test_cerebellar_peduncles_are_available_as_pathways_and_not_lobules():
    structures = load_recipe("z_anatomy")["objects"]
    details = _details("z_anatomy", structures)
    lobules = set(details["detail-cerebellar-lobules"]["structure_ids"])
    pathways = set(details["detail-white-cerebellar"]["structure_ids"])
    assert not PEDUNCLE_IDS & lobules
    assert PEDUNCLE_IDS <= pathways
    assert "z_anatomy:object:9008f53986fc" in lobules  # A true cortical lobule.


def test_a_package_with_only_peduncles_cannot_offer_cerebellar_lobules():
    structures = [item for item in load_recipe("z_anatomy")["objects"]
                  if item["id"] in PEDUNCLE_IDS]
    assert {item["id"] for item in structures} == PEDUNCLE_IDS
    details = _details("z_anatomy", structures)
    assert "detail-cerebellar-lobules" not in details
    assert set(details["detail-white-cerebellar"]["structure_ids"]) == PEDUNCLE_IDS


def test_surface_brainstem_context_does_not_advertise_fine_pontomedullary_nuclei():
    structures = load_recipe("z_anatomy")["objects"]
    details = _details("z_anatomy", structures)
    assert "detail-pontomedullary-regions" not in details
    # The original surface models are still available through the main group.
    assert "brainstem" in {
        item["id"] for item in source_coverage("z_anatomy", structures)
    }


def test_superior_olivary_complex_is_regional_and_not_a_cranial_nerve_nucleus():
    structures = _navigator(["SOC_l", "SOC_r"])
    details = _details("brainstem_navigator_mni", structures)
    assert "detail-cranial-nuclear-context" not in details
    assert set(details["detail-pontomedullary-regions"]["structure_ids"]) == {
        item["id"] for item in structures
    }


def test_actual_vestibular_and_viscerosensory_motor_complexes_keep_nuclear_context():
    structures = _navigator(["Ve_l", "Ve_r", "VSM_l", "VSM_r"])
    details = _details("brainstem_navigator_mni", structures)
    selected = details["detail-cranial-nuclear-context"]["structure_ids"]
    assert set(selected) == {item["id"] for item in structures}
    # The supplied compound labels stay compound; no individual nucleus is
    # manufactured from the vestibular or VSM source mask.
    assert all(ident.rsplit(":", 1)[-1] in {"Ve_l", "Ve_r", "VSM_l", "VSM_r"}
               for ident in selected)


def test_mesencephalic_reticular_fields_are_midbrain_not_pontomedullary():
    names = [f"{region}_{side}" for region in ("mRt", "mRta", "mRtd", "mRtl")
             for side in ("l", "r")]
    structures = _navigator(names)
    details = _details("brainstem_navigator_mni", structures)
    assert "detail-pontomedullary-regions" not in details
    assert set(details["detail-midbrain-nuclei"]["structure_ids"]) == {
        item["id"] for item in structures
    }


def test_mida_general_or_ventricular_csf_does_not_substitute_for_a_cisternal_image_anchor():
    structures = [
        {"id": "mida:label:32", "category": "Meninges and CSF"},
        {"id": "mida:label:6", "category": "Ventricles"},
    ]
    details = _details("mida", structures)
    # MIDA supplies categorical CSF classes, with no MRI observation anchor or
    # named cisternal boundary. Both remain useful in the broader CSF group.
    assert "detail-cisternal-observation" not in details
    assert "detail-cisternal-observation" not in _details("mida", structures[:1])
    assert "detail-cisternal-observation" not in _details("mida", structures[1:])
    groups = {item["id"]: item for item in source_coverage("mida", structures)}
    assert groups["ventricles"]["structure_ids"] == ["mida:label:6"]
    assert "mida:label:32" in groups["cisternal-regions"]["structure_ids"]


def test_whole_midbrain_surface_models_do_not_substitute_for_named_nuclei():
    regional_ids = {
        "z_anatomy:object:b065572dae55", "z_anatomy:object:146bc9ae51df"
    }
    structures = [item for item in load_recipe("z_anatomy")["objects"]
                  if item["id"] in regional_ids]
    assert {item["id"] for item in structures} == regional_ids
    assert "detail-midbrain-nuclei" not in _details("z_anatomy", structures)
