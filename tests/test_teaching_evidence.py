"""Keep discussion topics bound to actual recipes and attributable references."""
import json
from pathlib import Path
from urllib.parse import urlparse


def test_evidence_topics_resolve_to_available_sources():
    root = Path(__file__).resolve().parents[1] / "src" / "neuroimage"
    sources = {json.loads(path.read_text())["id"] for path in (root / "recipes").glob("*.json")}
    catalog = json.loads((root / "catalogs" / "teaching-evidence.json").read_text())
    topics = catalog["topics"]
    assert catalog["language"] == "en"
    assert len({topic["id"] for topic in topics}) == len(topics)
    for topic in topics:
        assert topic["source_ids"] and set(topic["source_ids"]) <= sources | {"*"}
        assert all(topic[field].strip() for field in ("observation", "limit", "question", "answer"))
        assert topic["references"]
        for reference in topic["references"]:
            parsed = urlparse(reference["url"])
            assert parsed.scheme == "https" and parsed.netloc
            assert reference["title"].strip() and reference["basis"].strip()


def test_individual_variation_observations_match_original_recipe_inventories():
    root = Path(__file__).resolve().parents[1] / "src" / "neuroimage"
    observations = json.loads((root / "catalogs/normal-variation-observations.json").read_text())
    for item in observations["cases"]:
        recipe = json.loads((root / "recipes" / (item["dataset_id"] + ".json")).read_text())
        actual = {entry["value"] for entry in recipe["selection"]}
        assert actual == set(item["present_values"])
        assert set(item["unlabelled_values"]) == set(range(1, 21)) - actual
        assert item["variant_adjudication"] == "not_performed"
        assert recipe["source_case"]["case"] == item["case"]
