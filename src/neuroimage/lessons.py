"""Source-grounded exploration lessons; independent expert review remains pending."""
from urllib.parse import urlparse

# Each task asks the learner to inspect the delivered labels and real MRI. It does
# not claim that every label boundary can be resolved independently in the MRI.
LESSONS = [
    ("NI-L001", "Orientation and laterality", "Use the RAS coordinates and side markers to identify the same labelled structure in three planes.",
     ["left caudate", "right caudate", "left putamen", "right putamen"],
     "Compare the RAS X coordinate of the left and right targets. Move one crosshair and follow its location in all views; the display convention changes screen placement, not anatomical side."),
    ("NI-L002", "The ventricular spaces", "Trace the source-labelled ventricular spaces in MRI and 3D, without treating an absent connection as proof of anatomical obstruction.",
     ["left lateral ventricle", "right lateral ventricle", "third ventricle", "aqueduct", "fourth ventricle"],
     "Inspect the CSF spaces on both T1 and T2. Compare adjacent slices. Thin connections may be limited by source sampling; this lesson does not establish their patency."),
    ("NI-L003", "Deep gray structures", "Distinguish source-labelled deep structures and compare their positions relative to the ventricular spaces.",
     ["left caudate", "left putamen", "left globus pallidus", "left pallidum", "left thalam"],
     "Inspect shape and position in the coronal and axial views, then rotate the 3D scene. A segmentation boundary is source evidence, not a claim that the boundary is fully visible on this MRI."),
    ("NI-L004", "The central cortical region", "Compare precentral and postcentral source parcellations in three planes and on the cortical surface.",
     ["left precentral", "left postcentral", "right precentral", "right postcentral"],
     "Locate each labelled cortical ribbon and inspect its neighboring folds. Parcellation conventions are source-specific, and these labels do not define individual functional maps."),
    ("NI-L005", "Medial temporal structures", "Identify hippocampal, amygdalar and parahippocampal labels and follow their extents across slices.",
     ["left hippocamp", "left amygdala", "left parahippocamp", "right hippocamp"],
     "Follow the anterior-to-posterior extent in coronal MRI. Compare both sides without assuming perfect symmetry or subfield coverage."),
    ("NI-L006", "Brainstem and posterior fossa", "Locate the represented brainstem and cerebellar structures and compare them with the fourth ventricle.",
     ["part of midbrain", "pons", "medulla", "left brainstem", "fourth ventricle", "left cerebell"],
     "Rotate to a lateral view and inspect sagittal MRI. The source may represent only a part or residual region of a named structure; read its source notes before interpreting its extent."),
    ("NI-L007", "Cortical spatial survey", "Compare frontal, temporal, parietal and occipital source parcellations in the same native anatomy.",
     ["left superior frontal", "left superior temporal", "left superior parietal", "left cuneus", "left insula"],
     "Use isolation and transparency to inspect the selected cortex in relation to deeper structures. These parcellations have different spatial extents from whole-lobe labels."),
    ("NI-L008", "Cerebellar representation", "Compare cerebellar source regions and white matter, paying attention to grouping and sampling limits.",
     ["left cerebellar lobules", "right cerebellar lobules", "white matter of left hemisphere of cerebellum", "left cerebellum gray", "left cerebellum white", "vermal"],
     "Inspect the source notes for each region. A union combines existing labels without adding tissue; it does not prove that the source covers every folium, nucleus or boundary."),
]

MODEL_LESSONS = [
    ("NI-M001", "Orienting the source model", "Follow one physical location through the three model sections and the surface view.",
     ["caudate", "putamen", "brain gray matter", "cerebellum gray"],
     "Use RAS coordinates and the orientation markers. The source combines both sides within many values; an unsplit label does not establish a left or right subdivision."),
    ("NI-M002", "Deep structures in the model", "Compare the delivered deep gray regions and their relative positions.",
     ["caudate", "putamen", "globus pallidus", "thalamus", "nucleus accumbens"],
     "Inspect adjacent categorical sections and rotate the visible surfaces. Read each source definition; the supplied model cannot independently demonstrate the original MRI boundary."),
    ("NI-M003", "Ventricular model relationships", "Compare the combined ventricular CSF region with nearby source-labelled structures.",
     ["ventricular csf", "caudate", "thalamus"],
     "Follow the combined CSF label through the model. This source does not provide separately selectable ventricular subdivisions. Sampling and source delineation limit any interpretation of thin connections."),
    ("NI-M004", "Brainstem model components", "Identify the delivered midbrain, pontine and medullary regions and the separately labelled adjacent components.",
     ["midbrain", "pons", "medulla", "substantia nigra", "cerebral peduncles"],
     "Use transparency and isolation to inspect the represented spatial relationships. Each categorical value excludes other separately labelled structures; it is not an exhaustive account of every brainstem nucleus or pathway."),
    ("NI-M005", "Cerebellar tissue representation", "Inspect the model's cerebellar gray and white matter tissue classes.",
     ["cerebellum gray", "cerebellum white", "pons"],
     "Compare the model sections with their computed surfaces. These tissue classes do not subdivide lobules, folia or deep cerebellar nuclei."),
    ("NI-M006", "Medial temporal and diencephalic context", "Inspect the source hippocampal, amygdalar and diencephalic regions in their shared native model space.",
     ["hippocampus", "amygdala", "hypothalamus", "mammillary", "thalamus"],
     "Follow each source label through the sections. Keep the same orientation while rotating the model, and avoid inferring nuclei, subfields or connections that are not separately represented."),
]


PROBABILITY_LESSONS = [
    ("NI-P001", "Observer support and navigation boundaries", "Distinguish source probability support from the thresholded navigation label.",
     ["caudate", "putamen", "nucleus accumbens"],
     "Keep the selected probability channel active while moving through neighboring voxels. Compare the 0 to 1 support readout with the categorical overlay and the 3D surface. A threshold boundary is not a precise individual tissue boundary."),
    ("NI-P002", "Striatal and pallidal relationships", "Compare the represented striatal and pallidal regions within one population template.",
     ["caudate", "putamen", "nucleus accumbens", "globus pallidus, external", "globus pallidus, internal", "ventral pallidum"],
     "Compare T1-weighted and T2-weighted sections at the same position. Inspect changes in observer support near neighboring regions and read each source definition."),
    ("NI-P003", "Midbrain nuclei and uncertain boundaries", "Inspect the source-defined midbrain regions while retaining uncertainty at their boundaries.",
     ["red nucleus", "substantia nigra, pars compacta", "substantia nigra, pars reticulata", "parabrachial", "ventral tegmental"],
     "Use the red nucleus as a source landmark in both contrasts. Follow probability changes at adjoining labels; population averaging and implicit delineation do not resolve microscopic interdigitations."),
    ("NI-P004", "Diencephalic source regions", "Compare the delivered hypothalamic, mammillary, habenular and subthalamic labels.",
     ["hypothalamus", "mammillary", "habenular", "subthalamic"],
     "Inspect adjacent sections and compare the same target in both MRI contrasts. These labels do not provide all constituent nuclei or their connections."),
    ("NI-P005", "Bilateral source inference", "Recognize the different evidence used for the source atlas's two hemispheres.",
     ["putamen", "red nucleus"],
     "Follow the selected channel across both sides. Left-side assignments were manually delineated; right-side assignments were inferred by the source authors using a reflection warp. This package preserves that supplied field and performs no new transform."),
]


def make_lessons(recipe, structures):
    lessons = []
    if recipe.get("teaching_sequences"):
        known = {s["id"] for s in structures}
        for spec in recipe["teaching_sequences"]:
            selected = spec["structure_ids"]
            if not selected or len(set(selected)) != len(selected) or any(sid not in known for sid in selected):
                raise ValueError("A source teaching sequence requires unique available structure IDs")
            steps = spec["steps"] if "steps" in spec else [{"structure_id": sid, "prompt": spec["step_prompt"], "question": spec["step_question"]} for sid in selected]
            if not steps or any(step.get("structure_id") not in selected or not step.get("prompt") or not step.get("question") for step in steps):
                raise ValueError("Source teaching steps require available targets, prompts and questions")
            references = spec.get("references", [])
            if not isinstance(references, list) or len(references) > 16 or any(
                    not isinstance(item, dict) or not isinstance(item.get("title"), str) or not item["title"].strip()
                    or not isinstance(item.get("url"), str) or urlparse(item["url"]).scheme != "https"
                    or not urlparse(item["url"]).netloc for item in references):
                raise ValueError("Lesson references require a title and an HTTPS source URL")
            lessons.append({**{key: spec[key] for key in ("id", "title", "objective", "instruction", "evidence_limit")},
                "structure_ids": selected, "review_status": "draft_not_expert_reviewed",
                "steps": steps,
                **({"references": references} if references else {}),
                "sources": [source["url"] for source in recipe["sources"]]})
        if len({lesson["id"] for lesson in lessons}) != len(lessons):
            raise ValueError("Source teaching sequence IDs must be unique")
        return {"schema_version": "1.0", "language": "en", "dataset_id": recipe["id"], "lessons": lessons}
    if recipe.get("representation") == "mri-regions":
        groups = list(dict.fromkeys(s["category"] for s in structures))
        for number, category in enumerate(groups, 1):
            selected = [s["id"] for s in structures if s["category"] == category]
            lessons.append({"id": f"NI-B{number:03}", "title": category + " source regions",
                "objective": "Identify the independent source regions and compare their locations in the supplied MRI template.",
                "instruction": "Keep a region selected while inspecting its full source probability field. Compare the delivered binary navigation mask and its unsmoothed 3D surface. Inspect both supplied MRI contrasts at the same physical location. Read the source definition and coverage limits.",
                "structure_ids": selected, "review_status": "draft_not_expert_reviewed",
                "steps": [{"structure_id": sid, "prompt": "Follow this source region through the three MRI planes and its 3D mask boundary.",
                           "question": "Which region and source-defined side are selected, and how do population support and the binary navigation boundary differ?"} for sid in selected],
                "sources": [s["url"] for s in recipe["sources"]],
                "evidence_limit": "Independent source regions may overlap. The delivered threshold is a navigation convention, not an individual anatomical boundary. Partial MRI coverage and native sampling limit interpretation; this lesson has not undergone expert review."})
        return {"schema_version": "1.0", "language": "en", "dataset_id": recipe["id"], "lessons": lessons}
    if recipe.get("representation") == "mri-streamlines":
        by_name = {s["source_name"]: s["id"] for s in structures}
        sequences = [("NI-T001", "Source trajectories and reference MRI", list(by_name),
                      "Relate computational trajectories to their documented template while distinguishing displayed samples from complete source data."),
                     ("NI-T002", "Paired source bundles", [name for name in ("AF_L", "AF_R", "CST_L", "CST_R") if name in by_name],
                      "Compare source-defined sides and spatial courses without treating unequal streamline counts as anatomical asymmetry."),
                     ("NI-T003", "Commissural and cerebellar source courses", [name for name in ("CC", "MCP") if name in by_name],
                      "Inspect midline-spanning source bundles and their relation to template sections; trajectory endpoints do not prove connections.")]
        for ident, title, names, objective in sequences:
            if not names:
                continue
            selected = [by_name[name] for name in names]
            lessons.append({"id": ident, "title": title, "objective": objective,
                "instruction": "Inspect the 3D trajectories and the nearby portions intersecting each physical section slab. Change display sampling and read its exact count. Return to the source point before comparing recorded views.",
                "structure_ids": selected, "review_status": "draft_not_expert_reviewed",
                "steps": [{"structure_id": sid, "prompt": "Follow this source-defined bundle through the template and compare the 2D section intersections with its 3D course.",
                           "question": "Which bundle is selected, what side does its source name describe, and what can these estimated trajectories not establish?"} for sid in selected],
                "sources": [s["url"] for s in recipe["sources"]],
                "evidence_limit": "Unreviewed source exploration. Streamlines are computational estimates, not observed axons or anatomical counts. Display sampling has no probability interpretation; no connection or individual variability is established."})
        return {"schema_version": "1.0", "language": "en", "dataset_id": recipe["id"], "lessons": lessons}
    model = recipe.get("representation") == "label-model"
    probabilistic = bool(recipe.get("probabilities"))
    if probabilistic and recipe["id"] != "cit168_native":
        # CIT168's observer counts, population template and reflected right side
        # are source-specific teaching facts, not generic probability semantics.
        available = [structure["id"] for structure in structures if structure.get("probability")]
        for start in range(0, len(available), 8):
            selected = available[start:start + 8]
            lessons.append({"id": f"NI-P{start // 8 + 1:03}", "title": f"Explore source probability evidence {start // 8 + 1}",
                            "objective": "Relate each delivered probability channel to its source definition and native image context.",
                            "instruction": "Keep a channel selected while inspecting nearby voxels. Read its recorded interpretation and derivation, then compare it with the delivered categorical navigation layer.",
                            "review_status": "draft_not_expert_reviewed", "structure_ids": selected,
                            "steps": [{"structure_id": ident, "prompt": "Inspect the active source channel in all three image planes and compare it with the navigation surface.",
                                       "question": "Which source region is active, and what does its probability value represent?"} for ident in selected],
                            "sources": [source["url"] for source in recipe["sources"]],
                            "evidence_limit": "Interpret values according to this source's documented method and uncertainty. Engineering validation and source citations do not constitute expert approval of a lesson."})
        return {"schema_version": "1.0", "language": "en", "dataset_id": recipe["id"], "lessons": lessons}
    for ident, title, objective, terms, instruction in PROBABILITY_LESSONS if probabilistic else MODEL_LESSONS if model else LESSONS:
        selected = []
        for term in terms:
            match = next((s for s in structures if term in s["name"].lower() and s["id"] not in selected), None)
            if match:
                selected.append(match["id"])
        if len(selected) < 2:
            continue
        lessons.append({"id": ident, "title": title, "objective": objective, "instruction": instruction,
                        "review_status": "draft_not_expert_reviewed", "structure_ids": selected,
                        "steps": [{"structure_id": sid, "prompt": "Identify the highlighted source region in the orthogonal slices, then inspect its 3D shape.",
                                   "question": "What source region is represented, and does its definition specify a side?" if model or probabilistic else "What is the name and side of the selected source-labelled structure?"} for sid in selected],
                        "sources": [s["url"] for s in recipe["sources"]],
                        "evidence_limit": ("Colored model sections are categorical labels, not measured MRI intensity. Original MRI is not included. " if model else "Population-template probabilities describe observer support, with source-inferred right-side labels; they do not quantify individual anatomy. " if probabilistic else "") + "Exploration of this source package; engineering validation and source citations do not constitute expert approval of a lesson."})
    return {"schema_version": "1.0", "language": "en", "dataset_id": recipe["id"], "lessons": lessons}
