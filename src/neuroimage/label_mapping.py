"""Read explicit source-labelled map definitions without inferring label order."""
import json
import re


def labelled_map_catalog(recipe, paths):
    mapping = json.loads(paths["label_mapping"].read_text())
    expected = recipe["label_mapping"]
    if (mapping.get("@id") != expected["id"] or mapping.get("space", {}).get("@id") != expected["source_space_id"]
            or len(mapping.get("volumes", [])) != 1
            or mapping["volumes"][0].get("providers", {}).get("nii") != expected["source_volume_url"]):
        raise ValueError("Source map identity, native space or original labelled volume differs from the recipe")
    result = []
    entries = mapping.get("indices")
    if not isinstance(entries, dict) or not entries:
        raise ValueError("Source map requires an explicit name-to-label inventory")
    palette = [[97, 184, 203], [224, 167, 85], [169, 142, 213], [130, 191, 142], [218, 134, 170], [209, 179, 125]]
    for name, indices in entries.items():
        if not isinstance(name, str) or not isinstance(indices, list) or len(indices) != 1:
            raise ValueError("Each named entry must declare exactly one original source label")
        index = indices[0]
        if (index.get("volume") != 0 or type(index.get("volume")) is not int or index.get("fragment") is not None
                or type(index.get("label")) is not int or not 0 < index["label"] <= 65535):
            raise ValueError("Source map entries require an integer label in the declared original volume")
        match = re.fullmatch(r"(.+) - (left|right) hemisphere", name)
        if match is None:
            raise ValueError("This recipe requires explicit source hemisphere names")
        base, side, value = match[1], match[2], index["label"]
        rules = [rule for rule in expected["categories"] if any(text in base for text in rule["contains"])]
        if len(rules) > 1:
            raise ValueError("Source category rules overlap; record an unambiguous teaching category")
        category = rules[0]["title"] if rules else expected["default_category"]
        gap = "(GapMap)" in base
        result.append({"id": f"{recipe['id']}:label:{value}", "label_value": value, "source_values": [value],
            "name": f"{side.capitalize()} {base}", "source_name": name, "category": category, "laterality": side,
            "color": [137, 151, 157] if gap else palette[(value % 1000) % len(palette)],
            "evidence": expected["gap_evidence"] if gap else expected["region_evidence"],
            "source_notes": ["Original source label " + str(value) + "; the source inventory explicitly assigns the " + side + " hemisphere.",
                             "Source MPM grid and supplied ICBM 2009c asymmetric reference are retained in millimeters."]})
    if len({item["label_value"] for item in result}) != len(result):
        raise ValueError("Source mapping assigns the same categorical value to multiple names")
    return sorted(result, key=lambda item: item["label_value"])
