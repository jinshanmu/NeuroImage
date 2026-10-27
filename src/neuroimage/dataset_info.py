"""Source descriptions available before acquiring or opening an atlas.

The short introductions below summarize the bundled source recipes and their
citations. Evidence, limitations and coordinate statements come from the recipe;
configuration names, representation types and package versions are not cases.
"""

from copy import deepcopy
import re

from .dataset_policy import require_supported_dataset


# Each entry names the representation actually selected by the bundled recipe,
# rather than promising everything available from the upstream resource.
_INTRODUCTIONS = {
    "spl_nac": (
        "The SPL/NAC selection pairs the source volunteer's native T1- and T2-weighted MRI with anatomical labels for cortical, deep, ventricular, brainstem and cerebellar regions.",
        "Native T1/T2 and anatomical labels",
    ),
    "cerebra": (
        "CerebrA supplies regional anatomical labels with the matching MNI ICBM152 2009c symmetric T1/T2 population templates. Its source method registers and manually corrects Mindboggle-101 labels.",
        "Template MRI and regional labels",
    ),
    "cit168_native": (
        "CIT168 provides source subcortical probability channels, categorical navigation labels and native T1/T2 population templates. Observer-assignment support and source-inferred right-hemisphere definitions have distinct meanings.",
        "Subcortical probabilities and labels",
    ),
    "brainstem_navigator_mni": (
        "Brainstem Navigator supplies independent brainstem and diencephalic probability fields and binary source masks, with the publisher's matched T2-weighted and fractional-anisotropy group averages.",
        "Nuclear probabilities and source masks",
    ),
    "julich_selected": (
        "The selected Julich-Brain release provides cytoarchitectonic regional assignments and source GapMaps in the original maximum-probability map, with the matching population-reference MRI. A categorical assignment is distinct from an individual probability channel.",
        "Cytoarchitectonic maximum-probability map",
    ),
    "mida": (
        "MIDA supplies selected categorical head-and-neck model classes, including intracranial tissues, cranial nerves and skull-base context. The distributed selection contains source labels rather than original measured MRI or separately named vascular branches.",
        "Categorical head and neck model",
    ),
    "suit_cerebellum": (
        "SUIT supplies cerebellar lobular, vermal and deep-nuclear assignments, their original probability channels and the source T1 template. Lobular and nuclear definitions come from separate source participant groups.",
        "Cerebellar labels and probabilities",
    ),
    "hcp1065_tracts": (
        "The HCP1065 streamline atlas provides population computational trajectory collections with the publisher-declared ICBM 2009a asymmetric reference MRI. These source trajectories are distinct from individual axons or voxel probability fields.",
        "Streamline bundles",
    ),
    "hcp1065_prob": (
        "The HCP1065 probability selection provides independent, potentially overlapping white-matter fields from source population tractography. They are a different representation from the source streamline collections.",
        "White-matter probability fields",
    ),
    "bigbrain_layers": (
        "The BigBrain cortical-layer release supplies bilateral histology-derived boundary surfaces. These are source reconstructed layer boundaries rather than layer volumes, MRI segmentations or separate cases.",
        "Cortical layer-boundary surfaces",
    ),
    "bigbrain_hippocampus": (
        "The BigBrain hippocampal release supplies bilateral CA1–CA4, dentate gyrus, subiculum and midsurface models derived from the source histological reconstruction. Subfields and midsurfaces retain their separate source definitions.",
        "Hippocampal subfield surfaces",
    ),
    "inner_ear_ct_specimen1": (
        "The selected inner-ear resource pairs Dataset A cadaveric temporal-bone CT with the source cochlear, vestibular and semicircular-canal fluid-space annotations. It does not import the separate clinical Dataset B.",
        "CT and inner-ear fluid-space labels",
    ),
    "mug500_healthy": (
        "This MUG500+ representation contains the original binary skull mask for source-designated healthy skull A0101. It is the same source skull as the separately supplied author-cleaned surface, not a second case; original CT intensities are absent.",
        "Original skull mask",
    ),
    "mug500_source_mesh": (
        "This MUG500+ representation contains the source author's cleaned A0101 skull mesh. It represents the same source skull as the original binary mask, with a different author-processed surface extent and independent source coordinates.",
        "Author-cleaned skull surface",
    ),
    "z_anatomy": (
        "Z-Anatomy supplies independent educational surface models of cranial anatomy, including cortical, nuclear, ventricular, nerve, vascular and skull-base objects. The source is a conceptual model without an original MRI or CT volume.",
        "Cranial anatomy model",
    ),
}


def metadata_paragraphs(*values):
    """Project current source prose without archived source-opening advice.

    Original recipes and citations remain unchanged. This filter can also be
    applied to manifest scope notes before projecting them into dataset pages.
    """
    excluded_advice = re.compile(
        r"\b(?:ixi(?:_mra)?|humanbrainatlas|hba_native|meso[- ]vein(?: mri)?|mesoveins|venat|"
        r"mouches(?:_arteries)?|arterial[- ]occurrence(?: atlas)?)\b", re.I)
    opening_advice = re.compile(
        r"^(?:open|browse|choose|select|compare|use|switch|download|acquire|build|activate)\b"
        r"|\b(?:is|are|remain|remains)\s+available\b", re.I)
    result = []
    for value in values:
        items = value if isinstance(value, (list, tuple)) else [value]
        for item in items:
            if (isinstance(item, str) and item.strip() and "nextbrain" not in item.casefold()
                    and not (excluded_advice.search(item) and opening_advice.search(item.strip()))
                    and item.strip() not in result):
                result.append(item.strip())
    return result


def dataset_info(recipe):
    """Return JSON metadata without reading input files or constructing an atlas."""
    ident = recipe["id"]
    require_supported_dataset(ident, (source["id"] for source in recipe.get("sources", [])))
    introduction, atlas_label = _INTRODUCTIONS.get(ident, (recipe["title"], recipe["title"]))
    source_case = recipe.get("source_case", {})
    case = source_case.get("case")
    case_id = str(case) if isinstance(case, (str, int)) and not isinstance(case, bool) else None
    case_label = "Case " + case_id if case_id is not None else None
    if ident.startswith("thu_mra_case"):
        introduction = (
            "This THU Cerebral MRA selection pairs an original author-processed volunteer MRA "
            "with its supplied numeric arterial segments. Project arterial names retain their "
            "correspondence to the source diagram; missing annotations do not establish anatomical absence."
        )
        atlas_label = "Source MRA and arterial segments"
        case_label = "Volunteer " + case_id if case_id is not None else None
    elif ident in {"mug500_healthy", "mug500_source_mesh"} or ident.startswith(("mug500_healthy_a", "mug500_source_mesh_a")):
        # A cleaned mesh and its original binary mask represent one source case.
        case_id = case_id or "A0101"
        case_label = "Skull " + case_id
        mesh = ident.startswith("mug500_source_mesh")
        introduction, atlas_label = _INTRODUCTIONS["mug500_source_mesh" if mesh else "mug500_healthy"]
        introduction = introduction.replace("A0101", case_id)
    elif ident == "inner_ear_ct_specimen1" and case_id is not None:
        case_label = "Specimen " + case_id

    label_table = recipe.get("label_table", {})
    selection = recipe.get("selection", [])
    description = metadata_paragraphs(
        introduction, recipe.get("description"), recipe.get("model_evidence"),
        recipe.get("streamline_evidence"), recipe.get("probability_interpretation"),
        recipe.get("probability_derivation"), recipe.get("region_evidence"),
        label_table.get("evidence"), [item.get("evidence") for item in selection],
    )
    scope_notes = metadata_paragraphs(
        recipe.get("scope_notes"), recipe.get("model_notes"), recipe.get("streamline_notes"),
        recipe.get("region_notes"), recipe.get("region_source_notes"),
        label_table.get("source_notes"),
        [note for item in selection for note in item.get("notes", [])],
    )
    image_evidence = []
    for image in recipe.get("images", []):
        if isinstance(image.get("image_evidence"), dict):
            image_evidence.append(deepcopy(image["image_evidence"]))
        scalar = image.get("scalar", {})
        if scalar.get("interpretation"):
            description = metadata_paragraphs(description, image["name"] + ": " + scalar["interpretation"])
        if scalar.get("derivation"):
            scope_notes = metadata_paragraphs(scope_notes, scalar["derivation"])

    source_space = recipe.get("space", {})
    space = {key: source_space.get(key, "") for key in ("name", "correspondence")}
    if source_space.get("unit_basis"):
        space["unit_basis"] = source_space["unit_basis"]
    result = {
        "description": description,
        "scope_notes": scope_notes,
        "space": space,
        "representation": recipe.get("representation", "mri-labels"),
        "case_id": case_id,
        "case_label": case_label,
        "atlas_label": atlas_label,
    }
    if image_evidence:
        result["image_evidence"] = image_evidence
    return result


def manifest_dataset_info(manifest):
    """Describe an exact stored package using its own metadata and recipe.

    Accept either raw manifest JSON or the validated Pydantic Manifest. Never
    substitute the currently installed recipe for an older package's snapshot.
    """
    value = manifest.model_dump(mode="json") if hasattr(manifest, "model_dump") else manifest
    require_supported_dataset(value["dataset_id"],
                              (value.get("package_id"), *[source["id"] for source in value.get("sources", [])]))
    recipe = {"id": value["dataset_id"], "title": value["title"],
              **value.get("build", {}).get("recipe", {})}
    info = dataset_info(recipe)
    actual_space = value.get("space", {})
    info["space"] = {key: actual_space.get(key, "") for key in ("name", "correspondence")}
    if actual_space.get("unit_basis"):
        info["space"]["unit_basis"] = actual_space["unit_basis"]
    info["representation"] = value.get("representation", info["representation"])
    warnings = [warning for warning in value.get("validation", {}).get("warnings", [])
                if isinstance(warning, str)
                and not re.search(r"expert review|anatomical review|unreviewed", warning, re.I)]
    info["scope_notes"] = metadata_paragraphs(info["scope_notes"], warnings)
    image_evidence = []
    for volume in value.get("volumes", []):
        evidence = volume.get("image_evidence")
        if isinstance(evidence, dict) and evidence and evidence not in image_evidence:
            image_evidence.append(deepcopy(evidence))
    # A recipe snapshot may predate or differ from the serialized image record.
    # The actual manifest volumes are authoritative for this exact package.
    if image_evidence:
        info["image_evidence"] = image_evidence
    else:
        info.pop("image_evidence", None)
    return info
