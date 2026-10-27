"""Recipe-driven adapters with one import contract, independent of license type."""
from dataclasses import dataclass
from pathlib import Path
import csv
import json
import re
from .dataset_policy import dataset_is_excluded, require_supported_dataset
from .browse_policy import source_is_browsable
from .thu_cases import thu_recipe, thu_recipe_names
from .mug_cases import mug_recipe, mug_recipe_names


@dataclass
class ImportedDataset:
    recipe: dict
    input_paths: dict[str, Path]
    structures: list[dict]


def recipe_names():
    names = {p.stem for p in Path(__file__).with_name("recipes").glob("*.json")}
    names.update(thu_recipe_names())
    names.update(mug_recipe_names())
    return sorted(name for name in names if not dataset_is_excluded(name) and source_is_browsable(name))


def load_recipe(name):
    require_supported_dataset(name)
    if not isinstance(name, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", name) is None:
        raise ValueError("Choose a safe installed source recipe name")
    path = Path(__file__).with_name("recipes") / f"{name}.json"
    recipe = json.loads(path.read_text()) if path.is_file() else thu_recipe(name) or mug_recipe(name)
    if recipe is None:
        raise ValueError(f"Unknown recipe {name!r}; choose from {', '.join(recipe_names())}")
    require_supported_dataset(recipe["id"], (source["id"] for source in recipe["sources"]))
    return recipe


def source_path(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise FileNotFoundError(f"Missing source file: {relative}. Follow the recipe acquisition instructions.")
    return path


def side_of(name):
    name = name.lower().split()
    return "left" if "left" in name else "right" if "right" in name else "midline"


def import_dataset(name: str, data_root: Path) -> ImportedDataset:
    recipe = load_recipe(name)
    paths = {key: source_path(data_root, relative) for key, relative in recipe["inputs"].items()}
    if recipe["adapter"] == "spl-nac-nrrd":
        structures = spl_catalog(recipe, paths)
    elif recipe["adapter"] == "cerebra-nifti":
        structures = cerebra_catalog(recipe, paths)
    elif recipe["adapter"] == "siibra-labelled-map":
        from .label_mapping import labelled_map_catalog
        structures = labelled_map_catalog(recipe, paths)
    elif recipe["adapter"] == "source-lut-nifti":
        from .source_lut import source_lut_catalog
        structures = source_lut_catalog(recipe, paths)
    elif recipe["adapter"] == "mida-nifti":
        structures = mida_catalog(recipe, paths)
    elif recipe["adapter"] == "source-label-volume":
        if recipe.get("representation") != "label-model" or recipe.get("images") or "labels" not in paths:
            raise ValueError("A source label adapter requires original labels without an invented reference image")
        structures = source_label_catalog(recipe)
    elif recipe["adapter"] == "source-mri-label-volume":
        if (recipe.get("representation") != "mri-labels" or not recipe.get("images")
                or "labels" not in paths or any(image["id"] not in paths for image in recipe["images"])):
            raise ValueError("A source MRI label adapter requires explicit original labels and matching images")
        structures = source_label_catalog(recipe)
    elif recipe["adapter"] == "source-hdf5-ct-labels":
        fields = recipe.get("images", [])
        definitions = recipe.get("hdf5_volumes", {})
        if (recipe.get("representation") != "ct-labels" or not fields or "labels" not in paths
                or set(definitions) != {"labels", *(field["id"] for field in fields)}
                or any(field["id"] not in paths for field in fields)):
            raise ValueError("An HDF5 CT adapter requires original images, paired labels and explicit source grids")
        from .hdf5_source import validate_hdf5_labels
        validate_hdf5_labels(paths["labels"], definitions["labels"], recipe["selection"])
        structures = source_label_catalog(recipe)
    elif recipe["adapter"] == "cit168-nifti":
        structures = cit168_catalog(recipe, paths)
    elif recipe["adapter"] == "trackvis-bundles":
        return ImportedDataset(recipe, paths, streamline_catalog(recipe))
    elif recipe["adapter"] == "independent-nifti-regions":
        return ImportedDataset(recipe, paths, independent_catalog(recipe))
    elif recipe["adapter"] == "native-nifti-volume":
        if recipe.get("representation") != "mri-volume" or len(recipe.get("images", [])) != 1:
            raise ValueError("The native image adapter requires one image in its own declared space")
        if recipe["images"][0]["id"] not in paths:
            raise ValueError("The native image input is unavailable")
        return ImportedDataset(recipe, paths, [])
    elif recipe["adapter"] == "native-nifti-scalars":
        fields = recipe.get("images", [])
        if recipe.get("representation") != "scalar-fields" or not fields or len({v["id"] for v in fields}) != len(fields):
            raise ValueError("Native scalar fields require distinct explicit source fields")
        from .contracts import ScalarEvidence
        for field in fields:
            evidence = ScalarEvidence(**field["scalar"])
            if field["id"] not in paths or evidence.source_input != field["id"]:
                raise ValueError("Scalar field source identity must match its native input")
        return ImportedDataset(recipe, paths, [])
    elif recipe["adapter"] == "native-nifti-frame":
        fields = recipe.get("images", [])
        if recipe.get("representation") != "mri-volume" or len(fields) != 1:
            raise ValueError("The native frame adapter requires one explicit source frame")
        field = fields[0]
        if field.get("source_input") not in paths or type(field.get("source_frame")) is not int or field["source_frame"] < 0:
            raise ValueError("The native frame adapter requires a declared input and zero-based frame")
        return ImportedDataset(recipe, paths, [])
    elif recipe["adapter"] in {"blender-source-surfaces", "stl-source-surfaces", "gifti-source-surfaces", "vtk-source-surfaces"}:
        from .model_build import model_catalog
        return ImportedDataset(recipe, paths, model_catalog(recipe))
    else:
        raise ValueError(f"No adapter for {recipe['adapter']}")
    if len({s["label_value"] for s in structures}) != len(structures):
        raise ValueError("Recipe has duplicate output label values")
    used = [v for s in structures for v in s["source_values"]]
    if len(used) != len(set(used)):
        raise ValueError("Overlapping source labels need a multilayer package, not schema 1.0")
    return ImportedDataset(recipe, paths, structures)


def source_label_catalog(recipe):
    """Describe explicit published categorical values without subdivision."""
    selection = recipe.get("selection", [])
    if not selection:
        raise ValueError("A source label adapter requires a nonempty source-defined selection")
    result = []
    for spec in selection:
        value = spec["value"]
        if type(value) is not int or not 0 < value <= 65535:
            raise ValueError("Source label values must be positive categorical integers")
        if not spec.get("evidence") or not spec.get("source_name"):
            raise ValueError("Source labels require their original definition and evidence")
        result.append({"id": f"{recipe['id']}:label:{value}", "label_value": value, "source_values": [value],
            "source_name": spec["source_name"], "name": spec["name"], "category": spec["category"],
            "laterality": spec.get("laterality", "unspecified"), "color": spec["color"],
            "evidence": spec["evidence"], "source_notes": list(spec.get("notes", []))})
    return result


def independent_catalog(recipe):
    rule = recipe["mask_rule"]
    units = recipe.get("probability_units", "fraction")
    maximum = {"fraction": 1, "percent": 100}.get(units)
    origin = rule.get("origin", "source")
    if maximum is None or origin not in ("source", "derived-from-probability"):
        raise ValueError("Require explicit supported probability units and mask origin")
    if rule.get("operator") != ">=" or not 0 < rule.get("threshold", 0) <= maximum:
        raise ValueError("Independent source masks require an explicit inclusive probability threshold")
    structures = []
    for region in recipe["regions"]:
        keys = ("mask_input", "probability_input") if origin == "source" else ("probability_input",)
        if any(region.get(key) not in recipe["inputs"] for key in keys):
            raise ValueError("Independent region references an unavailable source input")
        if origin != "source" and region.get("mask_input"):
            raise ValueError("Derived display masks cannot also claim a supplied binary source")
        ident = region["source_name"]
        structures.append({"kind": "independent-region", "id": f"{recipe['id']}:region:{ident}",
            **{key: region[key] for key in ("source_name", "name", "category", "laterality", "color")},
            "mask": {"volume_id": ident + "_mask", "source_input": region["mask_input"] if origin == "source" else region["probability_input"], "threshold": rule["threshold"],
                     "threshold_operator": rule["operator"], "derivation": rule["source"], "origin": origin},
            "probability": {"volume_id": ident + "_probability", "source_input": region["probability_input"],
                            "source_channel": None, "interpretation": recipe["probability_interpretation"],
                            "derivation": recipe["probability_derivation"], "units": units},
            "evidence": recipe["region_evidence"], "source_notes": [*recipe["region_notes"], *region.get("notes", [])]})
    if len({s["id"] for s in structures}) != len(structures):
        raise ValueError("Duplicate independent source region IDs")
    return structures


def streamline_catalog(recipe):
    structures = []
    for bundle in recipe["bundles"]:
        if bundle["input"] not in recipe["inputs"]:
            raise ValueError("A streamline bundle references an unavailable source input")
        structures.append({"kind": "streamline-bundle", "id": f"{recipe['id']}:bundle:{bundle['source_name']}",
            "source_input": bundle["input"], "source_name": bundle["source_name"], "name": bundle["name"],
            "category": bundle["category"], "laterality": bundle["laterality"], "color": bundle["color"],
            "evidence": recipe["streamline_evidence"], "source_notes": [*recipe["streamline_notes"], *bundle.get("notes", [])]})
    if len({s["id"] for s in structures}) != len(structures):
        raise ValueError("Duplicate source streamline bundle IDs")
    return structures


def cit168_catalog(recipe, paths):
    rows = dict(line.split() for line in paths["label_table"].read_text().splitlines() if line.strip())
    palette = [[230, 174, 77], [106, 197, 206], [187, 141, 226], [222, 125, 153], [126, 194, 140], [221, 151, 102]]
    result = []
    for spec in recipe["probabilities"]:
        channel, value = spec["channel"], spec["label_value"]
        if rows.get(str(channel)) != spec["source_name"] or value != channel + 1:
            raise ValueError("CIT168 channel names differ from the pinned source table")
        result.append({"id": f"cit168_native:label:{value}", "label_value": value, "source_values": [value],
                       "name": spec["name"], "source_name": spec["source_name"], "category": spec["category"],
                       "laterality": "unspecified", "color": palette[channel % len(palette)],
                       "evidence": "Population-template observer assignments; the delivered 25% maximum-probability label is a navigation boundary, not individual anatomical certainty.",
                       "source_notes": ["Both hemispheres share this source label value; the project does not infer a hemispheric partition.",
                                        "Left labels average 24 observer delineations. The source authors inferred right labels by reflection, affine and diffeomorphic mapping with interpolation. The project applies none of these transforms.",
                                        *spec.get("notes", [])],
                       "probability": {"volume_id": spec["id"], "source_input": spec["input"], "source_channel": channel,
                                       "interpretation": recipe["probability_interpretation"], "derivation": recipe["probability_derivation"]}})
    return result


def spl_catalog(recipe, paths):
    with paths["label_table"].open(newline="") as f:
        rows = {int(r["value"]): r for r in csv.DictReader(f, delimiter="\t")}
    with paths["metadata_table"].open(newline="") as f:
        metadata = {int(r["value"]): r for r in csv.DictReader(f, delimiter="\t")}
    result = []
    for group in recipe["selection"]:
        for value in group["values"]:
            row = rows[value]
            meta = metadata.get(value, {})
            notes = [f"Source metadata: {meta['notes']}"] if meta.get("notes") else []
            if meta.get("label") and meta["label"] != row["label"]:
                notes.append(f"The separate metadata table calls this label '{meta['label']}'. The delivered lookup table name is retained; expert reconciliation is pending.")
            result.append({"id": f"spl_nac:label:{value}", "label_value": value, "source_values": [value],
                           "name": row["label"][0].upper() + row["label"][1:], "source_name": row["label"],
                           "category": group["category"], "laterality": side_of(row["label"]),
                           "color": [int(v) for v in re.findall(r"\d+", row["color"])[:3]],
                           "source_notes": notes, "evidence": "Source automatic parcellation with manual refinements; no independent project anatomy review."})
    for group in recipe.get("unions", []):
        result.append({"id": f"spl_nac:group:{group['label_value']}", **group,
                       "source_name": "Union of delivered label values " + ", ".join(map(str, group["source_values"])),
                       "evidence": "Computed union of existing source parcellations, without interpolation or added boundaries.",
                       "source_notes": ["A source parcellation union is a navigation aid; its extent is limited to the included source labels."]})
    return result


def mida_catalog(recipe, paths):
    rows = {}
    for line in paths["label_table"].read_text(encoding="cp1252").splitlines():
        fields = line.split("\t")
        if len(fields) == 5 and fields[0].isdigit():
            rows[int(fields[0])] = fields
    result = []
    for spec in recipe["selection"]:
        value = spec["value"]
        fields = rows[value]
        if fields[4] != spec["source_name"]:
            raise ValueError(f"MIDA label {value} differs from the pinned source definition")
        result.append({"id": f"mida:label:{value}", "label_value": value, "source_values": [value],
                       "name": spec["name"], "source_name": fields[4], "category": spec["category"],
                       "laterality": spec.get("laterality", "unspecified"), "color": [round(float(v) * 255) for v in fields[1:4]],
                       "evidence": "Delivered MIDA voxel model derived from multimodal imaging and source delineation; original MRI is not included.",
                       "source_notes": ["The source value is not split into left and right structures. No hemispheric partition is inferred.",
                                        "The displayed surface is computed from this voxel label; original vendor STL surfaces are not used because their voxel correspondence is unverified.",
                                        *spec.get("notes", [])]})
    return result


def cerebra_catalog(recipe, paths):
    result = []
    with paths["label_table"].open(newline="") as f:
        for row in csv.DictReader(f):
            mb = int(row["Mindboggle ID"])
            category = ("Cerebral cortex" if mb >= 2000 else "Ventricles" if mb in (14, 15, 43, 44)
                        else "Cerebellum" if mb in (45, 46, 630, 631, 632)
                        else "Brainstem" if mb == 16 else "Deep structures")
            for side, key in (("right", "RH Label"), ("left", "LH Labels")):
                value = int(row[key])
                # Colors are UI choices; source label numbers and names are unchanged.
                palette = [[95, 190, 215], [223, 172, 75], [148, 124, 223], [113, 190, 144], [215, 113, 146], [220, 148, 91]]
                notes = [row["Notes"]] if row["Notes"] else []
                if mb in (14, 15, 16, 630, 631, 632):
                    notes.append("The source assigns separate left/right values to this region. These values do not establish anatomically separate organs.")
                result.append({"id": f"cerebra:label:{value}", "label_value": value, "source_values": [value],
                               "name": f"{side.capitalize()} {row['Label Name']}", "source_name": row["Label Name"],
                               "category": category, "laterality": side, "color": palette[mb % len(palette)],
                               "source_notes": notes, "evidence": "Manually corrected atlas labels in a population template; not one individual anatomy."})
    return result
