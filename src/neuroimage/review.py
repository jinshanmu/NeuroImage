"""Prepare source-bound review material without claiming expert approval."""
from datetime import datetime, timezone
import hashlib
import html
import io
import json
import math
import re
from pathlib import Path
import shutil
import zipfile
from PIL import Image
from .build import GIB, atomic_json, sha256
from .validation import validate_package
from .contracts import Manifest, Structure, StreamlineStructure, IndependentRegion
from .dataset_policy import require_supported_dataset
from .provenance import processing_record

DECISIONS = {"not_assessed", "acceptable", "needs_revision", "not_resolvable", "not_applicable"}
STRUCTURE_CRITERIA = {
    "orientation": "Laterality and orientation markers agree with the source anatomy",
    "definition": "The represented label extent matches its stated source definition",
    "image_correspondence": "Image-to-label correspondence is adequate for the stated anatomical interpretation",
    "uncertainty": "Sampling limits, source inference and incomplete coverage are explained",
}
REVIEW_TERMS = [
    "left caudate", "right caudate", "left putamen", "right putamen", "left thalam", "right thalam",
    "left hippocamp", "right hippocamp", "left amygdala", "right amygdala", "left lateral ventricle", "right lateral ventricle",
    "third ventricle", "fourth ventricle", "pons", "medulla", "left precentral", "left postcentral", "left cerebell", "right cerebell",
    "left brainstem", "right brainstem", "left superior frontal", "right superior frontal",
]


def now():
    return datetime.now(timezone.utc).isoformat()


def review_structures(manifest, limit):
    selected = []
    for term in REVIEW_TERMS:
        match = next((s for s in manifest.structures if term in s.name.lower() and s.id not in {v.id for v in selected}), None)
        if match:
            selected.append(match)
    selected.extend(s for s in manifest.structures if s.id not in {v.id for v in selected})
    return selected[:limit]


def scene_for(manifest, structure):
    if manifest.representation in ("mri-volume", "scalar-fields"):
        image = manifest.volumes[0]
        center = [row[3] + sum(row[i] * (size - 1) / 2 for i, size in enumerate(image.shape)) for row in image.affine_ras_mm[:3]]
        return {"schema_version": "1.0", "kind": "neuroimage-scene", "title": "Native source image observation", "saved_utc": now(),
                "package_id": manifest.package_id, "package_version": manifest.package_version, "build_signature": manifest.build["signature"],
                "space_id": manifest.space.id, "state": {"selected": None, "visible": [], "position": center,
                "background": image.id, "overlay": "none", "labelOpacity": 0, "meshOpacity": 1, "radiological": True, "layout": "quad",
                "camera": [110, 15, 1.4], "pan": [0, 0, 0, 1], "imageContext": True, "window": [image.cal_min, image.cal_max],
                "annotations": [], "showMarkers": True, "note": "Original source scalar evidence; no MRI or segmented structures." if manifest.representation == "scalar-fields" else "Original native image; no segmented structure labels.",
                "selectionEvidence": {"kind": "image-cursor", "candidates": []}},
                "provenance": {"sources": [source.model_dump() for source in manifest.sources], "processing": processing_record(manifest.build), "anatomical_review": "not_performed"}}
    model = manifest.representation == "label-model"
    streamlines = manifest.representation == "mri-streamlines"
    image = next(v for v in manifest.volumes if v.kind == ("labels" if model else "image"))
    region_span = max(1, *(high - low for high, low in zip(structure.bounds_ras_mm[1], structure.bounds_ras_mm[0])))
    image_span = max(size * spacing for size, spacing in zip(image.shape, image.voxel_size_mm))
    region_zoom = max(1.4, min(8, image_span / (2 * region_span)))
    pan = [0, 0, 0, 1]
    paired_name = structure.name.replace("Left", "Right", 1).replace("left", "right", 1) if structure.laterality == "left" else structure.name.replace("Right", "Left", 1).replace("right", "left", 1)
    paired = next((s for s in manifest.structures if s.name == paired_name and s.id != structure.id), None)
    visible = [structure.id] + ([paired.id] if paired else [])
    return {"schema_version": "1.0", "kind": "neuroimage-scene", "title": f"Review: {structure.name}", "saved_utc": now(),
            "package_id": manifest.package_id, "package_version": manifest.package_version, "build_signature": manifest.build["signature"],
            "space_id": manifest.space.id, "state": {"selected": structure.id, "visible": visible, "position": list(structure.target_ras_mm),
            "background": image.id, "overlay": "streamlines" if streamlines else "probability" if structure.probability else "labels", "labelOpacity": 1 if model or streamlines else .45, "meshOpacity": 1, "radiological": True, "layout": "quad",
            "camera": [110, 15, 1.4 if streamlines else region_zoom if manifest.representation == "mri-regions" else 2], "pan": pan, "imageContext": False, "window": [image.cal_min, image.cal_max],
            "annotations": [], "note": "Prepared for independent anatomical review; no reviewer judgment has been recorded.",
            "selectionEvidence": {"kind": "source-target", "candidates": [structure.id]},
            **({"focus3D": list(structure.target_ras_mm)} if manifest.representation == "mri-regions" else {}),
            **({"streamlineLevel": "standard", "streamlineSlabMm": 1} if streamlines else {})},
            "provenance": {"sources": [s.model_dump() for s in manifest.sources], "processing": processing_record(manifest.build), "anatomical_review": "not_performed"}}


def prepare_review(manifest_path, data_root, *, limit=20, minimum_free_gib=400):
    if not 1 <= limit <= 60:
        raise ValueError("A review packet must contain 1 to 60 structures")
    manifest_path = Path(manifest_path).resolve()
    declared = Manifest.model_validate_json(manifest_path.read_bytes())
    require_supported_dataset(declared.dataset_id, [declared.package_id, *(source.id for source in declared.sources)])
    manifest = validate_package(manifest_path)
    require_supported_dataset(manifest.dataset_id, [manifest.package_id, *(source.id for source in manifest.sources)])
    data_root = Path(data_root).resolve()
    if not data_root.is_dir():
        raise ValueError("The selected data root must already exist")
    selected = review_structures(manifest, limit)
    if not selected:
        raise ValueError("This package has no source structures. Inspect the original image in the anatomy browser.")
    implementation = [sha256(Path(__file__)), sha256(Path(__file__).with_name("templates") / "review.html")]
    signature = hashlib.sha256(json.dumps({"manifest": sha256(manifest_path), "cases": [s.id for s in selected], "implementation": implementation}, sort_keys=True).encode()).hexdigest()
    root = data_root / "benchmarks" / manifest.dataset_id / ("review-" + signature[:12])
    if not root.resolve().is_relative_to(data_root):
        raise ValueError("Review output escapes the selected data root")
    if (root / "review-plan.json").exists():
        return root
    peak_bytes = len(selected) * 8 * 1024 ** 2 + 10 * 1024 ** 2
    if shutil.disk_usage(data_root).free < minimum_free_gib * GIB + peak_bytes:
        raise ValueError("Insufficient data-drive capacity including the review packet safety floor")
    for folder in (root, root / "scenes", root / "images", root / "captures", root / "licenses"):
        folder.mkdir(parents=True, exist_ok=True)
    plan = {"schema_version": "1.0", "kind": "neuroimage-review-packet", "packet_version": signature[:12], "created_utc": now(),
            "package_id": manifest.package_id, "package_version": manifest.package_version, "build_signature": manifest.build["signature"],
            "space_id": manifest.space.id, "space_name": manifest.space.name, "source_manifest_sha256": sha256(manifest_path),
            "anatomical_review": "not_performed", "estimated_peak_additional_bytes": peak_bytes,
            "capture_rendering_requirements": {"mesh_projection_in_2d": False, "label_sampling": "nearest-neighbor"},
            "structure_criteria": {**STRUCTURE_CRITERIA, **({"image_correspondence": "The absence of original MRI is explicit; categorical model sections are clearly distinguished from MRI"} if manifest.representation == "label-model" else {})}, "cases": [],
            "sources": [s.model_dump() for s in manifest.sources]}
    if any(s.probability for s in selected):
        plan["structure_criteria"].update(image_correspondence="Source probabilities and categorical navigation labels are correctly related to the supplied MRI in its declared native space",
                                          uncertainty="The source's probability interpretation, uncertainty and computational derivations are explicit and distinguished from direct observations")
    if manifest.representation == "mri-streamlines":
        plan["structure_criteria"].update(definition="The displayed source bundle and its course are appropriate for preliminary spatial identification",
            image_correspondence="The source-declared template relationship and physical section intersections are adequate for the stated anatomical interpretation",
            uncertainty="Estimated trajectories, display sampling, endpoints and source-count limitations are distinguished from observed axons and validated connections")
    for index, structure in enumerate(selected, 1):
        ident = f"NI-R{index:03}"
        scene = f"scenes/{ident}.json"
        plan["cases"].append({"id": ident, "structure": structure.model_dump(), "scene_file": scene, "image_file": f"images/{ident}.png"})
        atomic_json(root / scene, scene_for(manifest, structure))
        if structure.probability:
            comparison = scene_for(manifest, structure)
            comparison["state"]["overlay"] = "mask" if manifest.representation == "mri-regions" else "labels"
            relative = f"scenes/{ident}-labels.json"
            atomic_json(root / relative, comparison)
            plan["cases"][-1]["categorical_scene_file"] = relative
    items = [{"item_id": c["id"], "kind": "structure", "criteria": {key: "not_assessed" for key in STRUCTURE_CRITERIA}, "notes": ""} for c in plan["cases"]]
    assessment = {"schema_version": "1.0", "kind": "neuroimage-manual-assessment", "packet_version": plan["packet_version"],
                  "package_id": manifest.package_id, "package_version": manifest.package_version, "build_signature": manifest.build["signature"], "space_id": manifest.space.id,
                  "reviewer": {"name": "", "qualifications": "", "affiliation": "", "date": ""}, "items": items, "overall_notes": ""}
    shutil.copyfile(manifest_path, root / "source-manifest.json")
    for asset in manifest.assets:
        if asset.role == "license":
            destination = root / asset.path; destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(manifest_path.parent / asset.path, destination)
    atomic_json(root / "assessment-template.json", assessment)
    atomic_json(root / "review-plan.json", plan)
    render_review(root)
    return root


def validate_capture(path, plan, case):
    with zipfile.ZipFile(path) as archive:
        if any(archive.getinfo(name).file_size > maximum for name, maximum in (("scene.json", 4 * 1024 ** 2), ("provenance.json", 16 * 1024 ** 2), ("anatomy.png", 32 * 1024 ** 2))):
            raise ValueError("Capture exceeds the review image or metadata size limit")
        scene = json.loads(archive.read("scene.json"))
        provenance = json.loads(archive.read("provenance.json"))
        renderer = scene.get("provenance", {}).get("renderer", {})
        if any(renderer.get(key) != value for key, value in plan.get("capture_rendering_requirements", {}).items()) or not re.fullmatch(r"[0-9a-f]{64}", renderer.get("build_sha256", "")):
            raise ValueError("Capture does not declare the required voxel-section rendering policy and viewer build")
        for field in ("package_id", "package_version"):
            if scene[field] != plan[field] or provenance[field] != plan[field]:
                raise ValueError(f"Capture has a different {field}: {case['id']}")
        if (scene["space_id"] != plan["space_id"] or scene["build_signature"] != plan["build_signature"]
                or provenance["space"]["id"] != plan["space_id"] or provenance["build"]["signature"] != plan["build_signature"]):
            raise ValueError("Capture has a different native space or construction signature")
        if scene["state"]["selected"] != case["structure"]["id"]:
            raise ValueError(f"Capture has the wrong target: {case['id']}")
        if case["structure"].get("probability") and scene["state"].get("overlay") != "probability":
            raise ValueError("A probability review capture must retain its source probability overlay")
        position = scene["state"]["position"]
        if len(position) != 3 or any(not isinstance(a, (int, float)) or not math.isfinite(a) or abs(a-b) > .02 for a, b in zip(position, case["structure"]["target_ras_mm"])):
            raise ValueError(f"Capture has moved away from its source target: {case['id']}")
        image = archive.read("anatomy.png")
        if not image.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("Capture does not contain a PNG image")
        with Image.open(io.BytesIO(image)) as picture:
            if max(picture.size) > 8192:
                raise ValueError("Review image dimensions exceed the capture limit")
            picture.verify()
        return image, scene


def read_plan(root):
    root = Path(root).resolve()
    plan = json.loads((root / "review-plan.json").read_text())
    if plan.get("kind") != "neuroimage-review-packet" or plan.get("schema_version") != "1.0" or sha256(root / "source-manifest.json") != plan.get("source_manifest_sha256"):
        raise ValueError("Review packet identity or source manifest was changed")
    if plan.get("lessons"):
        raise ValueError("Open historical lesson review packets with the testing branch. The original packet is unchanged.")
    source = json.loads((root / "source-manifest.json").read_text())
    if any(plan.get(key) != source.get(key) for key in ("package_id", "package_version")) or plan.get("space_id") != source["space"]["id"] or plan.get("build_signature") != source["build"]["signature"]:
        raise ValueError("Review plan no longer matches its source package identity")
    structures = {s["id"]: s for s in source["structures"]}
    seen = set()
    for case in plan["cases"]:
        ident = case["id"]
        if not re.fullmatch(r"NI-R\d{3}", ident) or ident in seen or case["scene_file"] != f"scenes/{ident}.json" or case["image_file"] != f"images/{ident}.png":
            raise ValueError("Review case identity or output paths were changed")
        original = structures.get(case["structure"]["id"])
        model = StreamlineStructure if case["structure"].get("kind") == "streamline-bundle" else IndependentRegion if case["structure"].get("kind") == "independent-region" else Structure
        if original is None or model.model_validate(case["structure"]) != model.model_validate(original):
            raise ValueError("Review case no longer matches the source structure")
        if "categorical_scene_file" in case and case["categorical_scene_file"] != f"scenes/{ident}-labels.json":
            raise ValueError("Review categorical comparison path was changed")
        seen.add(ident)
    return plan


def assemble_review(packet, *, keep_captures=False):
    root = Path(packet).resolve(); plan = read_plan(root)
    state_path = root / "capture-state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {"packet_version": plan["packet_version"], "completed": {}}
    if state.get("packet_version") != plan["packet_version"]:
        raise ValueError("Capture checkpoint belongs to a different review packet")
    state["completed"] = {key: value for key, value in state["completed"].items() if key in {case["id"] for case in plan["cases"]}}
    for case in plan["cases"]:
        from .acquire import destination
        image_path = destination(root, case["image_file"])
        scene_path = destination(root, case["scene_file"])
        previous = state["completed"].get(case["id"])
        if previous and image_path.is_file() and scene_path.is_file() and sha256(image_path) == previous["image_sha256"] and sha256(scene_path) == previous["scene_sha256"]:
            continue
        state["completed"].pop(case["id"], None)
        archive = root / "captures" / (case["id"] + ".zip")
        if not archive.is_file():
            continue
        image, scene = validate_capture(archive, plan, case)
        image_path.write_bytes(image)
        atomic_json(scene_path, scene)
        state["completed"][case["id"]] = {"image_sha256": sha256(image_path), "scene_sha256": sha256(scene_path), "capture_sha256": sha256(archive)}
        atomic_json(state_path, state)
        if not keep_captures:
            archive.unlink()  # Only this verified, reproducible capture ZIP is removed.
    atomic_json(state_path, state)
    render_review(root)
    return {"status": "complete" if len(state["completed"]) == len(plan["cases"]) else "partial", "captured": len(state["completed"]),
            "required": len(plan["cases"]), "anatomical_review": "not_performed", "index": str(root / "index.html")}


def check_assessment(assessment_path, packet):
    root = Path(packet); plan = read_plan(root)
    data = json.loads(Path(assessment_path).read_text())
    if data.get("kind") != "neuroimage-manual-assessment" or data.get("schema_version") != "1.0":
        raise ValueError("Unsupported manual assessment format")
    for field in ("packet_version", "package_id", "package_version", "build_signature", "space_id"):
        if data.get(field) != plan[field]:
            raise ValueError(f"Assessment belongs to a different review packet: {field}")
    expected = {c["id"]: ("structure", set(STRUCTURE_CRITERIA)) for c in plan["cases"]}
    seen = set(); assessed = total = revisions = unresolved = 0
    for item in data.get("items", []):
        ident = item.get("item_id")
        if ident not in expected or ident in seen:
            raise ValueError("Assessment has unknown or duplicate review items")
        kind, criteria = expected[ident]
        if item.get("kind") != kind or set(item.get("criteria", {})) != criteria or not isinstance(item.get("notes"), str):
            raise ValueError("Assessment item does not match its review criteria")
        for decision in item["criteria"].values():
            if decision not in DECISIONS:
                raise ValueError("Unknown review decision")
            total += 1; assessed += decision != "not_assessed"; revisions += decision == "needs_revision"; unresolved += decision == "not_resolvable"
        seen.add(ident)
    if seen != set(expected):
        raise ValueError("Assessment is missing review items")
    reviewer = data.get("reviewer", {})
    if any(not isinstance(reviewer.get(key), str) for key in ("name", "qualifications", "affiliation", "date")) or not isinstance(data.get("overall_notes"), str):
        raise ValueError("Invalid reviewer information or overall notes")
    complete = assessed == total and all(reviewer[key].strip() for key in ("name", "qualifications", "date"))
    return {"format_status": "valid", "assessment_completion": "complete" if complete else "incomplete", "criteria_assessed": assessed,
            "criteria_total": total, "needs_revision": revisions, "not_resolvable": unresolved, "reviewer_declared": reviewer,
            "scope": "Checks record identity and completeness only; reviewer qualifications and anatomical judgments are not independently verified"}


def render_review(root):
    root = Path(root); plan = read_plan(root); assessment = json.loads((root / "assessment-template.json").read_text())
    esc = html.escape
    sections = []
    for case in plan["cases"]:
        s = case["structure"]
        probability = s.get("probability")
        probability_note = (f'<p>{esc(probability["interpretation"])}</p><p>{esc(probability["derivation"])}</p>' if probability else '')
        comparison_link = (f'<p><a href="{esc(case["categorical_scene_file"])}" download>Download the categorical comparison scene</a></p>' if case.get("categorical_scene_file") else '')
        picture = f'<img src="{esc(case["image_file"])}" alt="Source-bound sections and surface view of {esc(s["name"])}">' if (root / case["image_file"]).is_file() else '<div class="pending">Image capture pending. Open the accompanying scene in the matching local atlas.</div>'
        sections.append(f'<article id="{case["id"]}"><div class="eyebrow">{case["id"]} · STRUCTURE</div><h2>{esc(s["name"])}</h2><p>{esc(s["laterality"])} · {esc(s["category"])} · <code>{esc(s["id"])}</code></p>{picture}<p>{esc(s["evidence"])}</p>{probability_note}<ul>' + ''.join(f'<li>{esc(note)}</li>' for note in s['source_notes']) + f'</ul><a href="{esc(case["scene_file"])}" download>Download the exact review scene</a>{comparison_link}<div class="criteria" data-item="{case["id"]}"></div></article>')
    sources = ''.join(f'<li><strong>{esc(s["title"])}</strong><p>{esc(s["citation"])}</p><a href="{esc(s["license_file"])}">Local source license: {esc(s["license_name"])}</a></li>' for s in plan['sources'])
    template = (Path(__file__).with_name('templates') / 'review.html').read_text()
    replacements = {"@@TITLE@@": esc(plan['space_name']), "@@VERSION@@": esc(plan['package_version']), "@@CONTENT@@": ''.join(sections), "@@SOURCES@@": sources,
                    "@@PLAN@@": json.dumps(plan).replace('<', '\\u003c'), "@@ASSESSMENT@@": json.dumps(assessment).replace('<', '\\u003c')}
    for key, value in replacements.items():
        template = template.replace(key, value)
    (root / 'index.html').write_text(template)
