"""Import source categorical volumes through explicit numeric lookup tables."""
import csv
import json
import re


def read_freesurfer_lut(path, *, selected_values=None):
    """Retain original names and RGB values; numeric labels never imply anatomy."""
    entries = {}
    for number, line in enumerate(path.read_text().splitlines(), 1):
        fields = line.partition("#")[0].split()
        if not fields:
            continue
        if len(fields) != 6:
            raise ValueError(f"Expected label, name, RGB and alpha on LUT line {number}")
        try:
            value = int(fields[0])
            rgba = [int(item) for item in fields[2:]]
        except ValueError as exc:
            raise ValueError(f"Invalid integer on LUT line {number}") from exc
        if not 0 <= value <= 65535:
            raise ValueError(f"LUT values exceed the supported categorical or color range on line {number}")
        if (selected_values is None or value in selected_values) and any(not 0 <= item <= 255 for item in rgba):
            raise ValueError(f"Selected source label {value} has an invalid RGB or alpha value on line {number}")
        if value in entries:
            raise ValueError(f"Duplicate original source label {value}")
        entries[value] = {"source_name": fields[1], "color": rgba[:3]}
    if not entries:
        raise ValueError("The source lookup table is empty")
    return entries


def hierarchy_categories(path):
    """Use exact source-name matches; coordinates in this hierarchy stay unused."""
    result = {}
    groups = json.loads(path.read_text())
    if not isinstance(groups, list):
        raise ValueError("Expected a source hierarchy containing named parent groups")
    for group in groups:
        category = group.get("label")
        if not isinstance(category, str) or not category.strip():
            raise ValueError("A source hierarchy group requires a name")
        category = category.strip().replace("-", " ").replace("_", " ")
        for child in group.get("children", []):
            name = child.get("label")
            # Some delivered hierarchy records have a null name. They cannot
            # define the identity or category of a numeric source label.
            if name is None:
                continue
            if not isinstance(name, str) or not name.strip():
                raise ValueError("A named source hierarchy entry must be a string")
            key = name.strip().casefold()
            if category not in result.setdefault(key, []):
                result[key].append(category)
    return {name: " / ".join(categories) for name, categories in result.items()}


def read_index_name_color_tsv(path):
    """Read the publisher's explicit index, original name and hexadecimal color."""
    entries = {}
    with path.open(newline="") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        if reader.fieldnames != ["index", "name", "color"]:
            raise ValueError("Source TSV requires index, name and color columns in the declared order")
        for row in reader:
            if None in row or any(value is None for value in row.values()):
                raise ValueError("Source TSV has an incomplete or excess field")
            if not re.fullmatch(r"\d+", row["index"]) or not row["name"].strip():
                raise ValueError("Source TSV requires explicit nonnegative indices and names")
            value = int(row["index"])
            color = row["color"]
            if value > 65535 or value in entries or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                raise ValueError("Source TSV contains an invalid index, duplicate or RGB color")
            entries[value] = {"source_name": row["name"], "color": [int(color[i:i + 2], 16) for i in (1, 3, 5)]}
    if not entries:
        raise ValueError("The source lookup table is empty")
    return entries


def source_lut_catalog(recipe, paths):
    spec = recipe["label_table"]
    if spec.get("format") not in ("freesurfer-lut", "index-name-color-tsv"):
        raise ValueError("This adapter requires an explicitly supported source lookup table format")
    if recipe.get("representation") != "mri-labels" or not recipe.get("images"):
        raise ValueError("The source LUT adapter requires its declared native MRI reference")
    values = spec["values"]
    if (not values or any(type(value) is not int or not 0 < value <= 65535 for value in values)
            or len(values) != len(set(values))):
        raise ValueError("Selected source labels must be distinct positive categorical integers")
    entries = (read_freesurfer_lut(paths[spec["input"]], selected_values=set(values))
               if spec["format"] == "freesurfer-lut" else read_index_name_color_tsv(paths[spec["input"]]))
    missing = sorted(set(values) - entries.keys())
    if missing:
        raise ValueError(f"Original label values have no source LUT identity: {missing}")
    display_colors = spec.get("display_colors", {})
    if display_colors and not str(spec.get("display_color_evidence", "")).strip():
        raise ValueError("Display color overrides require an explicit presentation rationale")
    for key, color in display_colors.items():
        if (key not in {str(value) for value in values} or not isinstance(color, list)
                or len(color) != 3 or any(type(c) is not int or not 0 <= c <= 255 for c in color)):
            raise ValueError("Display colors must bind selected source labels to valid RGB values")
    categories = hierarchy_categories(paths[spec["hierarchy_input"]]) if spec.get("hierarchy_input") else {}
    numeric_categories = {}
    for group in spec.get("categories", []):
        for value in group["values"]:
            if type(value) is not int or value not in values or value in numeric_categories:
                raise ValueError("Source category values must identify distinct selected entries")
            numeric_categories[value] = group["title"]
    probability_specs = {}
    channels, volume_ids = set(), set()
    for probability in recipe.get("probabilities", []):
        value, channel = probability["label_value"], probability["channel"]
        if (type(value) is not int or value not in values or value in probability_specs
                or type(channel) is not int or channel < 0 or probability["input"] not in paths
                or probability["source_name"] != entries[value]["source_name"]
                or (probability["input"], channel) in channels or probability["id"] in volume_ids):
            raise ValueError("Source probability channels require distinct explicit LUT identities and available inputs")
        channels.add((probability["input"], channel))
        volume_ids.add(probability["id"])
        probability_specs[value] = probability
    result = []
    for value in sorted(values):
        entry = entries[value]
        source_name = entry["source_name"]
        name = re.sub(r"_+", " ", source_name)
        explicit = re.match(r"^ctx-(lh|rh)-(.+)$", source_name)
        side = "left" if explicit and explicit[1] == "lh" else "right" if explicit else "unspecified"
        if explicit:
            name = side.capitalize() + " " + explicit[2].replace("_", " ")
        sides = [side for prefix, side in spec.get("laterality_prefixes", {}).items() if source_name.startswith(prefix)]
        if len(sides) > 1 or any(side not in ("left", "right", "midline", "unspecified") for side in sides):
            raise ValueError("Source laterality prefixes require one explicit side per entry")
        if sides:
            side = sides[0]
        name = re.sub(r"\bca([1-4])\b", lambda match: "CA" + match[1], name, flags=re.IGNORECASE)
        name = name[0].upper() + name[1:]
        category = numeric_categories.get(value, categories.get(source_name.strip().casefold(), spec["default_category"]))
        if category == "Background":
            category = spec["default_category"]
        result.append({
            "id": f"{recipe['id']}:label:{value}", "label_value": value, "source_values": [value],
            "source_name": source_name, "name": name, "category": category,
            "laterality": side, "color": display_colors.get(str(value), entry["color"]), "evidence": spec["evidence"],
            "source_notes": [f"Original source label {value}; source LUT name: {source_name}.",
                             *spec.get("source_notes", [])],
        })
        if str(value) in display_colors:
            result[-1]["source_notes"].append(
                f"Original source RGB: {entry['color']}. Display RGB: {display_colors[str(value)]}. "
                + spec["display_color_evidence"])
        if value in probability_specs:
            probability = probability_specs[value]
            result[-1]["probability"] = {"volume_id": probability["id"], "source_input": probability["input"],
                "source_channel": probability["channel"], "interpretation": recipe["probability_interpretation"],
                "derivation": recipe["probability_derivation"]}
    return result
