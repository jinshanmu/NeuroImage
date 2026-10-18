"""Verify explicit source label identities and complete categorical coverage."""
import copy
import json

import pytest

from neuroimage.label_mapping import labelled_map_catalog
from test_pipeline import source, build


@pytest.fixture
def mapping(tmp_path):
    original = {"@id": "source-map", "space": {"@id": "source-space"},
                "volumes": [{"providers": {"nii": "https://example.org/source.nii.gz"}}],
                "indices": {"Region (Synthetic) - right hemisphere": [{"volume": 0, "label": 19}],
                            "Region (Synthetic) - left hemisphere": [{"volume": 0, "label": 207}],
                            "Context (GapMap) - left hemisphere": [{"volume": 0, "label": 305}]}}
    recipe = {"id": "synthetic-map", "label_mapping": {"id": "source-map", "source_space_id": "source-space",
        "source_volume_url": "https://example.org/source.nii.gz", "default_category": "Synthetic region",
        "categories": [{"title": "Synthetic gap", "contains": ["(GapMap)"]}],
        "region_evidence": "Synthetic mapping fixture", "gap_evidence": "Synthetic gap fixture"}}
    path = tmp_path / "mapping.json"
    path.write_text(json.dumps(original))
    return original, recipe, path


def test_explicit_names_and_labels_define_sides_without_numeric_inference(mapping):
    _, recipe, path = mapping
    records = labelled_map_catalog(recipe, {"label_mapping": path})
    assert [(item["label_value"], item["laterality"]) for item in records] == [(19, "right"), (207, "left"), (305, "left")]
    assert [item["source_values"] for item in records] == [[19], [207], [305]]
    assert records[2]["category"] == "Synthetic gap"
    assert records[2]["evidence"] == "Synthetic gap fixture"
    assert records[0]["source_name"] == "Region (Synthetic) - right hemisphere"


@pytest.mark.parametrize("change", ["space", "provider", "duplicate", "fragment", "multiple", "boolean", "side"])
def test_incompatible_mapping_requires_explicit_source_resolution(mapping, change):
    original, recipe, path = mapping
    changed = copy.deepcopy(original)
    first = next(iter(changed["indices"]))
    if change == "space": changed["space"]["@id"] = "other-space"
    elif change == "provider": changed["volumes"][0]["providers"]["nii"] = "https://example.org/other.nii.gz"
    elif change == "duplicate": changed["indices"]["Other - left hemisphere"] = changed["indices"][first]
    elif change == "fragment": changed["indices"][first][0]["fragment"] = "left"
    elif change == "multiple": changed["indices"][first].append({"volume": 0, "label": 208})
    elif change == "boolean": changed["indices"][first][0]["label"] = True
    else: changed["indices"]["Unknown side"] = changed["indices"].pop(first)
    path.write_text(json.dumps(changed))
    with pytest.raises(ValueError):
        labelled_map_catalog(recipe, {"label_mapping": path})


def test_full_inventory_rule_rejects_silent_dropped_source_labels(source):
    source[1].recipe["require_full_label_inventory"] = True
    source[1].structures.pop()
    with pytest.raises(ValueError, match="cover every original nonzero label"):
        build(source)
