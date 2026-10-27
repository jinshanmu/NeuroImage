"""Normal source discovery, independent of immutable historical package access."""
import json
from pathlib import Path


_POLICY = json.loads((Path(__file__).with_name("catalogs") / "source-browse.json").read_text())
RETIRED_PARALLEL_RECIPES = _POLICY["retired_parallel_recipes"]


def source_is_browsable(dataset_id):
    """Hide superseded parallel configurations without excluding their packages."""
    return dataset_id not in RETIRED_PARALLEL_RECIPES
