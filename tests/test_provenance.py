"""Portable views keep construction evidence without duplicating the recipe."""
from neuroimage.provenance import processing_record


def test_processing_summary_preserves_binding_inputs_and_original_manifest():
    full = {"signature": "exact", "software_version": "1.0.0", "inputs": [{"sha256": "original"}],
            "parameters": {"threshold": .5}, "recipe": {"objects": ["source-one", "source-two"]}}
    compact = processing_record(full)
    assert compact["signature"] == full["signature"]
    assert compact["inputs"] == full["inputs"] and compact["parameters"] == full["parameters"]
    assert compact["recipe_reference"] == "manifest.json#/build/recipe" and "recipe" not in compact
    assert len(full["recipe"]["objects"]) == 2
