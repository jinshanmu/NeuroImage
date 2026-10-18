"""Assemble reviewable notebook views from exact source-bound teaching exports."""
import hashlib
import html
import io
import json
import math
from pathlib import Path
import shutil
import zipfile

from PIL import Image

from .build import atomic_json, sha256, GIB, utc_now
from .library import content_binding, locate_content

VIEW_CRITERIA = {
    "orientation": "Display orientation and laterality agree with the native source",
    "placement": "The recorded observation point and contextual anatomy are appropriate for this view",
    "teaching": "The prompt and view are suitable for the stated preliminary teaching purpose",
    "limitations": "Source coverage, sampling and inferred or annotated content are explicit",
}
BINDING = ("package_id", "package_version", "build_signature", "space_id")


def read_export(path, expected, manifest, *, magnified=False):
    """Accept the exact recorded view, or its coordinate-preserving magnification."""
    with zipfile.ZipFile(path) as archive:
        for name, maximum in (("scene.json", 4 * 1024 ** 2), ("provenance.json", 16 * 1024 ** 2), ("anatomy.png", 32 * 1024 ** 2)):
            if archive.getinfo(name).file_size > maximum:
                raise ValueError("Teaching export exceeds the review size limit")
        scene = json.loads(archive.read("scene.json"))
        provenance = json.loads(archive.read("provenance.json"))
        if any(scene.get(key) != expected.get(key) for key in BINDING) or provenance != manifest:
            raise ValueError("Teaching export belongs to another source package or native space")
        renderer = scene.get("provenance", {}).get("renderer", {})
        digest = renderer.get("build_sha256", "")
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest) or renderer.get("mesh_projection_in_2d") is not False or renderer.get("label_sampling") != "nearest-neighbor":
            raise ValueError("Teaching export does not declare its verified rendering policy")
        actual, wanted = scene["state"], expected["state"]
        for key, value in wanted.items():
            if key == "pan" and magnified:
                continue
            if actual.get(key) != value:
                raise ValueError(f"Teaching export changed the recorded {key}")
        if magnified:
            pan = actual.get("pan", [])
            if len(pan) != 4 or any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in pan) or not 1 < pan[3] <= 10:
                raise ValueError("Magnified review requires a finite display zoom greater than one")
            volume = next(volume for volume in manifest["volumes"] if volume["id"] == actual["background"])
            center = [row[3] + sum(row[i] * (size - 1) / 2 for i, size in enumerate(volume["shape"])) for row in volume["affine_ras_mm"][:3]]
            if any(abs(pan[axis] - (center[axis] - pan[3] * actual["position"][axis])) > .001 for axis in range(3)):
                raise ValueError("Magnified review is not centered on the same source point")
        picture = archive.read("anatomy.png")
        with Image.open(io.BytesIO(picture)) as image:
            if image.format != "PNG" or max(image.size) > 8192:
                raise ValueError("Review image format or dimensions are unsupported")
            image.verify()
        return picture, scene


def read_notebook_plan(root):
    root = Path(root)
    plan = json.loads((root / "review-plan.json").read_text())
    if plan.get("kind") != "neuroimage-notebook-review-packet" or plan.get("schema_version") != "1.0":
        raise ValueError("Unsupported notebook review packet")
    if plan.get("lesson_criteria") != VIEW_CRITERIA:
        raise ValueError("Notebook review criteria changed")
    if sha256(root / "source-manifest.json") != plan["source_manifest_sha256"] or sha256(root / "source-notebook.json") != plan["source_notebook_sha256"]:
        raise ValueError("Notebook review source identity changed")
    book = json.loads((root / "source-notebook.json").read_text())
    if any(plan[key] != book[key] for key in BINDING) or len(plan["cases"]) != len(book["scenes"]):
        raise ValueError("Notebook review no longer matches its source content")
    for index, (case, entry) in enumerate(zip(plan["cases"], book["scenes"]), 1):
        if case["id"] != f"NI-N{index:03}" or case["notebook_scene_id"] != entry["id"] or case["title"] != entry["title"]:
            raise ValueError("Notebook review case identity changed")
        for key in ("image_file", "scene_file", "magnified_image_file", "magnified_scene_file"):
            if key in case:
                suffix = "-magnified" if key.startswith("magnified") else ""
                folder, extension = ("images", "png") if "image" in key else ("scenes", "json")
                if case[key] != f"{folder}/{case['id']}{suffix}.{extension}":
                    raise ValueError("Notebook review output paths changed")
                path = root / case[key]
                if not path.is_file() or path.is_symlink() or sha256(path) != case[key + "_sha256"]:
                    raise ValueError("A notebook review image or scene changed")
    return plan


def prepare_notebook_review(notebook_path, captures, data_root, *, minimum_free_gib=400):
    notebook_path, captures, data_root = Path(notebook_path).resolve(), Path(captures).resolve(), Path(data_root).resolve()
    if not notebook_path.is_relative_to(data_root) or not captures.is_relative_to(data_root):
        raise ValueError("Notebook and teaching exports must stay on the configured data drive")
    content_binding(notebook_path)
    book = json.loads(notebook_path.read_text())
    if book.get("kind") != "neuroimage-teaching-notebook" or not 1 <= len(book.get("scenes", [])) <= 50:
        raise ValueError("Select a source-bound notebook containing 1 to 50 scenes")
    match = locate_content(notebook_path, data_root)
    manifest_path = Path(match["manifest"])
    manifest = json.loads(manifest_path.read_text())
    files = []
    for index in range(1, len(book["scenes"]) + 1):
        original = captures / f"view-{index}.zip"
        if not original.is_file():
            raise ValueError(f"Export scene {index} as {original.name} before assembling this review")
        files.append(original)
        enlarged = captures / f"view-{index}-magnified.zip"
        if enlarged.is_file():
            files.append(enlarged)
    hashes = {path.name: sha256(path) for path in files}
    signature = hashlib.sha256(json.dumps({"notebook": sha256(notebook_path), "manifest": sha256(manifest_path), "exports": hashes,
        "implementation": sha256(Path(__file__)), "template": sha256(Path(__file__).with_name("templates") / "review.html")}, sort_keys=True).encode()).hexdigest()
    root = data_root / "benchmarks" / manifest["dataset_id"] / ("notebook-review-" + signature[:12])
    if (root / "review-plan.json").exists():
        read_notebook_plan(root)
        return {"status": "reused", "packet": str(root), "index": str(root / "index.html")}
    peak = 32 * 1024 ** 2 * len(files) + 16 * 1024 ** 2
    if shutil.disk_usage(data_root).free < minimum_free_gib * GIB + peak:
        raise ValueError("Insufficient capacity for review images and the data safety floor")
    # Verify every view before creating an output packet. A moved annotation or
    # mismatched magnification must never be published as the recorded view.
    verified = []
    renderers = set()
    for index, entry in enumerate(book["scenes"], 1):
        full = read_export(captures / f"view-{index}.zip", entry["scene"], manifest)
        enlarged_path = captures / f"view-{index}-magnified.zip"
        enlarged = read_export(enlarged_path, entry["scene"], manifest, magnified=True) if enlarged_path.is_file() else None
        renderers.add(full[1]["provenance"]["renderer"]["build_sha256"])
        if enlarged:
            renderers.add(enlarged[1]["provenance"]["renderer"]["build_sha256"])
        verified.append((entry, full, enlarged))
    if len(renderers) != 1:
        raise ValueError("Teaching review exports come from different viewer builds")
    for folder in (root, root / "images", root / "scenes", root / "licenses"):
        folder.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(notebook_path, root / "source-notebook.json")
    shutil.copyfile(manifest_path, root / "source-manifest.json")
    for asset in manifest["assets"]:
        if asset["role"] == "license":
            target = root / asset["path"]; target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(manifest_path.parent / asset["path"], target)
    plan = {"schema_version": "1.0", "kind": "neuroimage-notebook-review-packet", "packet_version": signature[:12],
            "created_utc": utc_now(), **{key: book[key] for key in BINDING}, "space_name": manifest["space"]["name"],
            "source_manifest_sha256": sha256(manifest_path), "source_notebook_sha256": sha256(notebook_path),
            "notebook_title": book["title"], "sources": manifest["sources"], "lesson_criteria": VIEW_CRITERIA, "cases": [],
            "viewer_build_sha256": next(iter(renderers)),
            "exports_sha256": hashes, "expert_review": "not_performed", "estimated_peak_additional_bytes": peak}
    for index, (entry, full, enlarged) in enumerate(verified, 1):
        ident = f"NI-N{index:03}"
        case = {"id": ident, "title": entry["title"], "notebook_scene_id": entry["id"], "prompt": entry["prompt"]}
        for pair, suffix, prefix in ((full, "", ""), (enlarged, "-magnified", "magnified_")):
            if pair is None:
                continue
            picture, scene = pair
            for name, folder, extension in (("image", "images", "png"), ("scene", "scenes", "json")):
                field = prefix + name + "_file"; relative = f"{folder}/{ident}{suffix}.{extension}"
                if name == "image": (root / relative).write_bytes(picture)
                else: atomic_json(root / relative, scene)
                case[field], case[field + "_sha256"] = relative, sha256(root / relative)
        plan["cases"].append(case)
    assessment = {"schema_version": "1.0", "kind": "neuroimage-manual-assessment", "packet_version": plan["packet_version"],
                  **{key: book[key] for key in BINDING}, "reviewer": {"name": "", "qualifications": "", "affiliation": "", "date": ""},
                  "items": [{"item_id": case["id"], "kind": "notebook-view", "criteria": {key: "not_assessed" for key in VIEW_CRITERIA}, "notes": ""} for case in plan["cases"]], "overall_notes": ""}
    atomic_json(root / "assessment-template.json", assessment)
    esc = html.escape
    sections = []
    for case, entry in zip(plan["cases"], book["scenes"]):
        images = ""
        for key, label in (("image_file", "Recorded source view"), ("magnified_image_file", "Same source point, magnified")):
            if key in case:
                images += f'<h3>{label}</h3><a href="{case[key]}" target="_blank"><img src="{case[key]}" alt="{esc(case["title"])}: {label}"></a>'
        sections.append(f'<article id="{case["id"]}"><div class="eyebrow">{case["id"]} · NOTEBOOK VIEW</div><h2>{esc(case["title"])}</h2><p>{esc(case["prompt"])}</p>{images}<details><summary>Teaching notes and source context</summary><p>{esc(entry["scene"]["state"].get("note", ""))}</p></details><a href="{case["scene_file"]}" download>Restore the exact recorded scene</a><div class="criteria" data-item="{case["id"]}"></div></article>')
    notices = ''.join(f'<li><strong>{esc(source["title"])}</strong><p>{esc(source["citation"])}</p><a href="{esc(source["license_file"])}">{esc(source["license_name"])}</a></li>' for source in plan["sources"])
    template = Path(__file__).with_name("templates").joinpath("review.html").read_text()
    replacements = {"@@TITLE@@": esc(book["title"]), "@@VERSION@@": esc(book["package_version"]), "@@CONTENT@@": ''.join(sections),
                    "@@SOURCES@@": notices, "@@PLAN@@": json.dumps(plan).replace('<', '\\u003c'), "@@ASSESSMENT@@": json.dumps(assessment).replace('<', '\\u003c')}
    for key, value in replacements.items(): template = template.replace(key, value)
    (root / "index.html").write_text(template)
    atomic_json(root / "review-plan.json", plan)
    return {"status": "prepared", "packet": str(root), "index": str(root / "index.html"), "views": len(verified), "expert_review": "not_performed"}
