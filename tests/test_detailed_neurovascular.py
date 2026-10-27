"""Neurovascular detail choices must contain the named anatomical subject.

Bundled source definitions and small inventories reproduce old/incomplete
packages without acquired images, atlas builds, or an external data directory.
"""

import pytest
import json
from pathlib import Path

from neuroimage.adapters import load_recipe
from neuroimage.coverage import source_details, topic_catalog


def _details(dataset, structures):
    return {item["id"]: item for item in source_details(dataset, structures)}


def _topic(ident):
    return next(item for item in topic_catalog() if item["id"] == ident)


def _labels(dataset, values):
    return [{"id": f"{dataset}:label:{value}", "category": "Source regional anatomy"}
            for value in values]


def _objects(id_suffixes):
    wanted = {f"z_anatomy:object:{suffix}" for suffix in id_suffixes}
    objects = [item for item in load_recipe("z_anatomy")["objects"]
               if item["id"] in wanted]
    assert {item["id"] for item in objects} == wanted
    return objects


RING_TRUNKS = {
    "42fc7aec5543", "56eae1ccf132",  # Anterior cerebral arteries.
    "22a0c5797060", "bd73b4c09e74",  # Internal carotid arteries.
    "0970415ca3c0", "acab27ca2358",  # MCA M1 models.
    "1dfc6cbfd700", "83382f78ad0a",  # Posterior cerebral arteries.
    "50f951997ce4", "560448f814d0",  # Posterior communicating arteries.
    "18bf6f680376", "1ac6e528d516",  # Anterior communicating and basilar.
}

NONPROXIMAL_BRANCHES = {
    "2ed3769113d2", "32ea39ac2e01",  # Lateral pontine branches.
    "b45362e5c185", "095a14395cda",  # Medial pontine branches.
    "2af7c8c0de64", "5638b3c917ff",  # Orbitofrontal ACA branches.
    "255c7e61547b", "6ca7965d2a2e",  # Parietal MCA branches.
    "25377c03ab91", "911e325fc529",  # Temporal MCA branches.
    "bf3d76813d6c", "8e9b657f992c",  # Insular MCA M2 models.
    "e7e9852c2936", "9a49cc420e90",  # MCA M3 models.
}

CORTICAL_CEREBELLAR_BRANCHES = {
    "b499f25c98b4", "7873a7cb90ff",  # Anterior inferior cerebellar.
    "b75511fb5d01", "2e30b5ae1e8d",  # Posterior inferior cerebellar.
    "b70459c528ff", "1c8872e93051",  # Superior cerebellar.
    "2af7c8c0de64", "5638b3c917ff",  # Orbitofrontal ACA branches.
    "255c7e61547b", "6ca7965d2a2e",  # Parietal MCA branches.
    "25377c03ab91", "911e325fc529",  # Temporal MCA branches.
    "bf3d76813d6c", "8e9b657f992c",  # Insular MCA M2 models.
    "e7e9852c2936", "9a49cc420e90",  # MCA M3 models.
    "d7b4091d6a9e", "85745bc6cb18",  # Pericallosal arteries.
    "6914c516b3b5", "458db427d512",  # Callosomarginal arteries.
    "80eb874b5325", "47e2b4757b4f",  # Frontal callosomarginal branches.
}


def test_proximal_arterial_topic_excludes_fourteen_distal_or_pontine_models():
    structures = load_recipe("z_anatomy")["objects"]
    selected = _details("z_anatomy", structures)["detail-arterial-ring"]["structure_ids"]
    expected = {item["id"] for item in _objects(RING_TRUNKS)}
    excluded = {item["id"] for item in _objects(NONPROXIMAL_BRANCHES)}
    assert len(expected) == 12 and len(excluded) == 14
    assert set(selected) == expected
    assert not set(selected) & excluded
    assert "detail-arterial-ring" not in _details(
        "z_anatomy", _objects(NONPROXIMAL_BRANCHES))


def test_cortical_cerebellar_topic_contains_all_52_original_named_branches():
    structures = load_recipe("z_anatomy")["objects"]
    selected = _details("z_anatomy", structures)["detail-arterial-branches"]["structure_ids"]
    original = json.loads((Path(__file__).resolve().parents[1] /
                           "config/source-recipe-history/z_anatomy-1.0.0-detail.json").read_text())
    original_ids = {item["id"] for item in original["objects"]}
    additions = [item for item in structures if item["id"] not in original_ids
                 and item["category"] == "Arterial model branches"]
    assert len(additions) == 30
    expected = [*_objects(CORTICAL_CEREBELLAR_BRANCHES), *additions]
    assert len(expected) == 52
    assert set(selected) == {item["id"] for item in expected}
    assert all("ophthalmic" not in item["name"].lower() for item in expected)

    # Main trunks and orbital arteries cannot become cortical branches through
    # their broad source category, nor can brainstem perforating branches.
    nonbranches = RING_TRUNKS | {
        "62b8d7864382", "dac46cbe67b0",  # Vertebral arteries.
        "c337c15070eb", "08e9e313f68d",  # Ophthalmic arteries.
        "2ed3769113d2", "32ea39ac2e01",  # Lateral pontine branches.
        "b45362e5c185", "095a14395cda",  # Medial pontine branches.
    }
    assert "detail-arterial-branches" not in _details(
        "z_anatomy", _objects(nonbranches))


@pytest.mark.parametrize("topic_id,nuclei", [
    ("detail-cn-ocular-motor", {"a5e3b4802dfb", "07c670e26191", "4f35326108ab", "9ab2f458aeb0"}),
    ("detail-cn-facial-auditory", {"401a98e61e67", "e5d0f666a450", "ee74d5d43b2f", "fc97e83e4ee6"}),
    ("detail-cn-lower", {"d99160d9a4f1", "a727e2d6c058", "b15e00d5f9a5", "b78b6e96c3df"}),
])
def test_nuclear_models_keep_nuclear_context_without_substituting_for_nerves(topic_id, nuclei):
    structures = _objects(nuclei)
    details = _details("z_anatomy", structures)
    assert topic_id not in details
    assert set(details["detail-cranial-nuclear-context"]["structure_ids"]) == {
        item["id"] for item in structures
    }


@pytest.mark.parametrize("topic_id,subject", [
    ("detail-cn-ocular-motor", "167ae977a854"),
    ("detail-cn-trigeminal", "02130795e077"),
    ("detail-cn-trigeminal", "80d4e7e5eb30"),
    ("detail-cn-facial-auditory", "bc48828b47d0"),
    ("detail-cn-lower", "52def54c491b"),
])
def test_real_nerve_or_root_models_remain_valid_partial_sources(topic_id, subject):
    structures = _objects({subject})
    details = _details("z_anatomy", structures)
    assert details[topic_id]["structure_ids"] == [structures[0]["id"]]


@pytest.mark.parametrize("dataset,ident", [
    ("mug500_healthy", "mug500_healthy:label:1"),
    ("mug500_source_mesh", "mug500_source_mesh:object:a0101-clear"),
])
def test_whole_skull_masks_and_meshes_cannot_offer_named_skull_base_bones(dataset, ident):
    assert dataset not in _topic("detail-skull-base-bones")["sources"]
    structures = [{"id": ident, "category": "Skull-base source context"}]
    assert "detail-skull-base-bones" not in _details(dataset, structures)


@pytest.mark.parametrize("topic_id,dataset", [
    ("variation-paired-a1", "thu_mra_case030"),
    ("variation-paired-a1", "thu_mra_case007"),
    ("variation-anterior-communicating", "thu_mra_case001"),
    ("variation-anterior-communicating", "thu_mra_case021"),
    ("variation-posterior-communicating", "thu_mra_case001"),
])
def test_five_sources_without_topic_subject_annotations_are_not_offered(topic_id, dataset):
    assert dataset not in _topic(topic_id)["sources"]
    # Even an older package with a broad inventory cannot resurrect a binding
    # excluded by the anatomical source audit.
    assert topic_id not in _details(dataset, _labels(dataset, range(1, 21)))


def test_paired_a1_requires_both_annotated_sides_instead_of_adjacent_vessels():
    dataset, ident = "thu_mra_case009", "variation-paired-a1"
    context = [5, 6, 7, 15, 16]
    for values in [context, [1, *context], [2, *context]]:
        assert ident not in _details(dataset, _labels(dataset, values))
    actual = _details(dataset, _labels(dataset, [1, 2]))[ident]
    assert set(actual["structure_ids"]) == {f"{dataset}:label:1", f"{dataset}:label:2"}


def test_anterior_communicating_topic_requires_its_own_annotation():
    dataset, ident = "thu_mra_case009", "variation-anterior-communicating"
    assert ident not in _details(dataset, _labels(dataset, [1, 2, 6, 7]))
    assert _details(dataset, _labels(dataset, [5]))[ident]["structure_ids"] == [f"{dataset}:label:5"]


@pytest.mark.parametrize("side", [8, 9])
def test_either_real_pcom_is_sufficient_but_pca_and_ica_context_is_not(side):
    dataset, ident = "thu_mra_case009", "variation-posterior-communicating"
    context = [10, 11, 12, 13, 15, 16]
    assert ident not in _details(dataset, _labels(dataset, context))
    assert _details(dataset, _labels(dataset, [side]))[ident]["structure_ids"] == [f"{dataset}:label:{side}"]


@pytest.mark.parametrize("dataset,side", [
    ("thu_mra_case009", 10), ("thu_mra_case009", 11), ("thu_mra_case007", 11),
])
def test_p1_basilar_requires_a_real_p1_and_the_basilar_segment(dataset, side):
    ident = "variation-p1-basilar"
    assert ident not in _details(dataset, _labels(dataset, [8, 9, 12, 13, 14]))
    assert ident not in _details(dataset, _labels(dataset, [side, 8, 9, 12, 13]))
    assert set(_details(dataset, _labels(dataset, [side, 14]))[ident]["structure_ids"]) == {
        f"{dataset}:label:{side}", f"{dataset}:label:14"
    }


def test_unannotated_vessel_notes_do_not_infer_anatomical_absence():
    for ident in ["variation-paired-a1", "variation-anterior-communicating",
                  "variation-posterior-communicating", "variation-p1-basilar"]:
        for binding in _topic(ident)["sources"].values():
            note = binding["coverage_note"].lower()
            assert "anatomical absence" in note
            assert "does not establish" in note or "is not anatomical absence" in note
    pcom = _topic("variation-posterior-communicating")["sources"]
    assert "left pcom is not annotated" in pcom["thu_mra_case006"]["coverage_note"].lower()
    assert "right pcom is not annotated" in pcom["thu_mra_case010"]["coverage_note"].lower()


def test_inner_ear_adds_four_real_cochlear_and_vestibular_surface_models():
    ear = _objects({"2d95626c6302", "c0a62e69cbd4", "1062c7e6d10d", "9ef26fa076b2"})
    assert {item["name"] for item in ear} == {
        "Left Cochlea", "Right Cochlea", "Left Vestibule", "Right Vestibule"
    }
    actual = _details("z_anatomy", load_recipe("z_anatomy")["objects"])["detail-inner-ear"]
    assert set(actual["structure_ids"]) == {item["id"] for item in ear}
    assert "no semicircular-canal fluid segmentation" in actual["coverage_note"]
    # Vestibulocochlear nerves are adjacent context, not an inner-ear organ.
    adjacent = _objects({"2a80eed2f169", "f95851dc2e07"})
    assert "detail-inner-ear" not in _details("z_anatomy", adjacent)


def test_lateral_geniculate_context_cannot_substitute_for_optic_nerve_chiasm_or_tract():
    context = _objects({"f7ef3d00ca68", "37cada537bd0"})
    assert all("Lateral geniculate body" in item["name"] for item in context)
    assert "detail-cn-visual" not in _details("z_anatomy", context)
    # A genuinely delivered local optic component is sufficient; legitimate
    # downstream context stays visible when the actual subject is also present.
    nerve = _objects({"b82ab3094429"})
    actual = _details("z_anatomy", context + nerve)["detail-cn-visual"]
    assert set(actual["structure_ids"]) == {item["id"] for item in context + nerve}
