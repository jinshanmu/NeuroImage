"""Compatibility entry point; preparation is included in the installed NeuroImage CLI."""
import argparse
import json
from pathlib import Path
from neuroimage.teaching import prepare


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--storage-policy", type=Path)
    args = parser.parse_args()
    policy = json.loads(args.storage_policy.read_text()) if args.storage_policy else {}
    print(json.dumps(prepare(args.manifest, args.recipe, args.data_root, policy.get("hdd_minimum_free_gib", 400)), indent=2))
