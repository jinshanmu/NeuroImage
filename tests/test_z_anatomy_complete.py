"""Keep the bounded full source selection traceable without expanding scope."""
import hashlib
import json
from pathlib import Path

from neuroimage.adapters import load_recipe
from neuroimage.model_build import model_catalog

ROOT = Path(__file__).resolve().parents[1]
LEGACY_PATH = ROOT / "config/source-recipe-history/z_anatomy-1.0.0-detail.json"


def test_complete_selection_retains_original_objects_and_native_source_contract():
    original = json.loads(LEGACY_PATH.read_bytes())
    complete = load_recipe("z_anatomy")
    assert complete["id"] == "z_anatomy" and complete["version"] == "1.1.0-detail"
    assert complete["title"] == original["title"]
    assert len(original["objects"]) == 350
    assert len(complete["objects"]) == 398
    assert complete["objects"][:350] == original["objects"]
    for field in ("inputs", "archives", "files", "sources", "space", "blender_version",
                  "source_scale_length", "mesh_geometry_stage", "source_version"):
        assert complete[field] == original[field]
    assert len(model_catalog(complete)) == 398
    assert complete["space"]["coordinate_system"] == "SOURCE_XYZ"
    assert len({obj["id"] for obj in complete["objects"]}) == 398
    assert len({obj["source_name"] for obj in complete["objects"]}) == 398
    for obj in complete["objects"]:
        assert obj["id"] == "z_anatomy:object:" + hashlib.sha256(obj["source_name"].encode()).hexdigest()[:12]


def test_added_objects_are_explicit_source_surfaces_and_not_locators_or_specialist_expansion():
    added = load_recipe("z_anatomy")["objects"][350:]
    counts = {}
    for obj in added:
        counts[obj["category"]] = counts.get(obj["category"], 0) + 1
        assert obj["source_type"] in {"MESH", "CURVE"}
        assert not obj["source_name"].endswith(".j")
        expected_side = "left" if obj["source_name"].endswith(".l") else "right" if obj["source_name"].endswith(".r") else "midline"
        assert obj["laterality"] == expected_side
    assert counts == {"Arterial model branches": 30, "Cranial nerve models": 2,
                      "Cerebellar source model": 2, "Cerebral cortical source model": 8,
                      "Cerebral white matter model context": 2, "Skull-base model bones": 2,
                      "Skull cavity model context": 2}
    names = {obj["source_name"] for obj in added}
    assert {"Parietal bone.l", "Parietal bone.r", "Sinus of frontal bone", "Sinus of sphenoid bone"} <= names
    assert not names.intersection({"Central canal'", "Ophthalmic nerve.l", "Maxillary nerve.r",
                                   "Nucleus of accessory nerve.l", "Anterior spinal artery.r",
                                   "Lens.l", "Tympanic membrane.r", "Mandible", "?x.l"})
    for obj in added:
        if obj["category"] == "Cerebral white matter model context":
            assert "not a separately reconstructed tract" in " ".join(obj["notes"])
        if obj["category"] == "Skull cavity model context":
            assert "not a measured CT air segmentation" in " ".join(obj["notes"])


def test_full_native_source_audit_accounts_for_every_object_and_accepted_geometry():
    audit = json.loads((ROOT / "config/z-anatomy-complete-scope-2026-10-26.json").read_text())
    complete = load_recipe("z_anatomy")
    assert audit["source_object_count"] == 7184
    assert audit["source_mesh_curve_count"] == 5520
    assert len(audit["objects"]) == sum(audit["partitions"].values()) == 7184
    assert len({obj["source_name"] for obj in audit["objects"]}) == 7184
    assert not audit["embedded_scripts_enabled"]
    accepted = {obj["source_name"] for obj in audit["objects"]
                if obj["classification"] in {"retained_legacy_source_object", "added_verified_intracranial_or_cranial_context"}}
    assert accepted == {obj["source_name"] for obj in complete["objects"]}
    for obj in audit["objects"]:
        assert obj["reason"]
        if obj["classification"] == "added_verified_intracranial_or_cranial_context":
            geometry = obj["evaluated_geometry"]
            assert geometry["valid_finite_triangle_geometry"]
            assert geometry["vertices"] >= 3 and geometry["triangles"] >= 1
    assert hashlib.sha256(LEGACY_PATH.read_bytes()).hexdigest() == audit["original_recipe_sha256"]
