"""Keep the complete IIT source fields separate from the original MNI configuration."""

import hashlib
import json
from pathlib import Path

from neuroimage.adapters import independent_catalog, load_recipe


ROOT = Path(__file__).resolve().parents[1]
AUDIT_PATH = ROOT / "config/brainstem-navigator-iit-source-inventory-2026-10-26.json"


def _audit():
    return json.loads(AUDIT_PATH.read_text())


def test_iit_keeps_all_original_region_definitions_without_mni_source_files():
    iit = load_recipe("brainstem_navigator_iit")
    mni = load_recipe("brainstem_navigator_mni")
    assert len(iit["regions"]) == len(mni["regions"]) == 86
    assert iit["regions"] == mni["regions"]
    assert iit["space"]["id"] != mni["space"]["id"]
    assert iit["images"] == mni["images"]
    assert len(iit["inputs"]) == 177
    for value in iit["inputs"].values():
        assert "_MNI/" not in value and "2c.Templates_MNI" not in value
    assert "/1c.Templates_IIT/images_BIlab/" in iit["inputs"]["t2"]
    assert "/1c.Templates_IIT/images_BIlab/" in iit["inputs"]["fa"]
    assert sum("1a.BrainstemNucleiAtlas_IIT/labels_probabilistic/" in value
               for value in iit["inputs"].values()) == 76
    assert sum("1b.DiencephalicNucleiAtlas_IIT/labels_probabilistic/" in value
               for value in iit["inputs"].values()) == 10


def test_iit_catalog_is_source_bound_and_does_not_split_compound_fields():
    recipe = load_recipe("brainstem_navigator_iit")
    structures = independent_catalog(recipe)
    assert len(structures) == len({item["id"] for item in structures}) == 86
    assert all(item["id"] == "brainstem_navigator_iit:region:" + item["source_name"]
               for item in structures)
    assert {item["source_name"] for item in structures} == {
        region["source_name"] for region in recipe["regions"]
    }
    lookup = {item["source_name"]: item for item in structures}
    assert lookup["RN_l"]["laterality"] == "left"
    assert lookup["RN_r"]["laterality"] == "right"
    assert "LDTg_CGPn_l" in lookup and "LDTg_CGPn_r" in lookup
    assert lookup["RN_l"]["mask"]["origin"] == "source"
    assert all(item["mask"]["threshold"] == .35
               and item["mask"]["threshold_operator"] == ">=" for item in structures)


def test_iit_all_source_pairs_and_templates_have_verified_exact_native_grids():
    audit = _audit()
    recipe = load_recipe("brainstem_navigator_iit")
    assert audit["shape"] == [256, 256, 256] and audit["units"] == "mm"
    assert audit["region_count"] == 86
    assert audit["source_brainstem_fields"] == 76
    assert audit["source_diencephalic_fields"] == 10
    assert [item["source_name"] for item in audit["regions"]] == [
        item["source_name"] for item in recipe["regions"]
    ]
    assert all(item["mask_voxels"] > 0 and item["exact_image_mask_probability_grid"]
               and item["inclusive_0_35_threshold_mismatch_voxels"] == 0
               for item in audit["regions"])
    assert {item["input"] for item in audit["images"]} == {"t2", "fa"}
    assert all(item["shape"] == audit["shape"] and item["native_affine"] == audit["native_affine"]
               and item["units"] == "mm" for item in audit["images"])
    assert audit["transformation_applied"] == "none; original source grids retained"


def test_iit_archive_members_pin_the_verified_source_bytes_and_mni_recipe_is_unchanged():
    recipe = load_recipe("brainstem_navigator_iit")
    audit = _audit()
    members = {item["target"]: item for archive in recipe["archives"] for item in archive["members"]}
    assert set(members) == set(recipe["inputs"].values())
    assert len(members) == 177
    for item in audit["images"]:
        assert members[item["file"]]["sha256"] == item["sha256"]
    for item in audit["regions"]:
        assert members[item["mask_file"]]["sha256"] == item["mask_sha256"]
        assert members[item["probability_file"]]["sha256"] == item["probability_sha256"]
    assert all(item["target"] == "raw/brainstem_navigator/" + item["member"]
               for item in members.values())
    mni_path = ROOT / "src/neuroimage/recipes/brainstem_navigator_mni.json"
    assert hashlib.sha256(mni_path.read_bytes()).hexdigest() == audit["legacy_mni_recipe_sha256"]
