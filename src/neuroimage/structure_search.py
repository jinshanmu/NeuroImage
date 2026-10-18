"""Search source definitions without merging anatomy or loading imaging arrays."""
from pathlib import Path
import json

from .coverage import source_coverage
from .library import BINDING_BYTES_LIMIT, library_records


def search_structures(data_root, query, *, dataset="", module="", offset=0, limit=100):
    """Return exact package-bound name matches; opening still validates all assets."""
    if not isinstance(query, str) or not 2 <= len(query.strip()) <= 160:
        raise ValueError("Enter an anatomy name, source abbreviation or stable ID using 2 to 160 characters")
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise ValueError("Search offset must be a nonnegative integer")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 100:
        raise ValueError("Search page size must be between 1 and 100")
    if not isinstance(dataset, str) or not isinstance(module, str) or max(len(dataset), len(module)) > 160:
        raise ValueError("Choose a valid source or module filter")
    terms = query.strip().casefold().split()
    matches, indexed, unavailable = [], 0, 0
    for record in library_records(data_root, dataset=dataset or None):
        if record["status"] != "available":
            unavailable += 1
            continue
        try:
            path = Path(record["manifest"])
            if path.is_symlink() or path.stat().st_size > BINDING_BYTES_LIMIT:
                raise ValueError("The source manifest cannot be indexed")
            manifest = json.loads(path.read_text())
            if module and not any(item["id"] == module for item in source_coverage(record["dataset_id"], manifest["structures"])):
                continue
            indexed += 1
            for structure in manifest["structures"]:
                text = " ".join(str(structure.get(key, "")) for key in ("name", "source_name", "id", "category", "laterality")).casefold()
                if not all(term in text for term in terms):
                    continue
                matches.append({
                    "atlas_key": record["package_id"] + "-" + record["package_version"],
                    "dataset_id": record["dataset_id"], "package_version": record["package_version"],
                    "title": record["title"], "space_name": record["space_name"],
                    "representation": record["representation"],
                    "structure_id": structure["id"], "name": structure["name"],
                    "source_name": structure["source_name"], "category": structure["category"],
                    "laterality": structure["laterality"], "kind": structure.get("kind", "label"),
                })
        except (OSError, ValueError, KeyError, TypeError):
            unavailable += 1
    matches.sort(key=lambda item: (item["name"].casefold(), item["dataset_id"], item["package_version"], item["structure_id"]))
    return {"schema_version": "1.0", "query": query.strip(), "offset": offset, "limit": limit,
            "total": len(matches), "matches": matches[offset:offset + limit],
            "indexed_packages": indexed, "unavailable_packages": unavailable,
            "scope": "Source-specific names and IDs, including historical versions. No cross-source equivalence is inferred. Metadata and sizes checked; opening verifies assets and geometry."}
