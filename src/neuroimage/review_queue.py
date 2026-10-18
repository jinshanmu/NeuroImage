"""Collect exact notebook review views without merging their anatomical judgments."""
from copy import deepcopy
import hashlib
from html import escape
import json
import os
from pathlib import Path
import shutil
from urllib.parse import quote

from .build import GIB, atomic_json, sha256
from .notebook_review import BINDING, read_notebook_plan

DECISIONS = {"not_reviewed", "preliminary_suitable", "needs_revision", "unresolved"}
SCOPE = "Preliminary teaching suitability of this exact image set only; no per-criterion or whole-atlas approval."


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def prepare_queue(packets, data_root, *, minimum_free_gib=400):
    root = Path(data_root).resolve()
    if not root.is_dir() or not 1 <= len(packets) <= 40:
        raise ValueError("Select an existing data root and between one and forty review packets")
    paths = sorted({Path(packet).resolve() for packet in packets})
    if len(paths) != len(packets):
        raise ValueError("The review queue cannot contain a duplicate packet")
    cases = []
    for packet in paths:
        if not packet.is_relative_to(root):
            raise ValueError("Every review packet must remain inside the configured data root")
        plan = read_notebook_plan(packet)
        for case in plan["cases"]:
            images = []
            for key, label in (("image_file", "Complete available view"), ("magnified_image_file", "Same-point magnification")):
                if key in case:
                    images.append({"label": label, "path": (packet / case[key]).relative_to(root).as_posix(),
                                   "sha256": case[key + "_sha256"]})
            if not images:
                raise ValueError("Every queued case requires a verified original review image")
            cases.append({"id": f"{plan['package_id']}:{plan['packet_version']}:{case['id']}",
                          "packet_case_id": case["id"], "packet_version": plan["packet_version"],
                          "title": case["title"], "prompt": case.get("prompt", ""),
                          **{key: plan[key] for key in BINDING}, "sources": plan["sources"],
                          "packet": packet.relative_to(root).as_posix(),
                          "plan_sha256": sha256(packet / "review-plan.json"),
                          "image_set": images})
    if len({case["id"] for case in cases}) != len(cases):
        raise ValueError("Review cases must have distinct source-bound identities")
    payload = {"schema_version": "1.0", "kind": "neuroimage-review-queue", "scope": SCOPE,
               "cases": cases, "expert_review_in_software_denominator": False,
               "implementation_sha256": sha256(Path(__file__)),
               "template_sha256": sha256(Path(__file__).with_name("templates") / "review_queue.html")}
    payload["queue_id"] = canonical_hash(payload)[:16]
    folder = root / "exports" / "review-queues" / payload["queue_id"]
    if not folder.resolve().is_relative_to(root):
        raise ValueError("The review queue output escapes the data root")
    if shutil.disk_usage(root).free < minimum_free_gib * GIB + 16 * 1024 ** 2:
        raise ValueError("Insufficient storage for review metadata and the data safety floor")
    page_cases = deepcopy(cases)
    for case in page_cases:
        case["packet_url"] = quote(os.path.relpath(root / case["packet"] / "index.html", folder), safe="/.-_") + "#" + quote(case["packet_case_id"])
        for picture in case["image_set"]:
            picture["url"] = quote(os.path.relpath(root / picture["path"], folder), safe="/.-_")
    template = (Path(__file__).with_name("templates") / "review_queue.html").read_text()
    embedded = json.dumps({**payload, "cases": page_cases}, ensure_ascii=True).replace("<", "\\u003c")
    html = template.replace("@@QUEUE@@", embedded).replace("@@COUNT@@", str(len(cases))).replace("@@IDENTITY@@", escape(payload["queue_id"]))
    serialized = json.dumps(payload, indent=2) + "\n"
    outputs = (("queue.json", serialized), ("index.html", html))
    for name, content in outputs:
        path = folder / name
        if path.exists() and path.read_text() != content:
            raise ValueError("Refusing to overwrite an altered review queue")
    reused = all((folder / name).exists() for name, _ in outputs)
    folder.mkdir(parents=True, exist_ok=True)
    for name, content in outputs:
        if not (folder / name).exists():
            (folder / name).write_text(content)
    return {"status": "reused" if reused else "prepared", "queue": str(folder.relative_to(root)),
            "queue_id": payload["queue_id"], "cases": len(cases), "packets": len(paths),
            "index_sha256": sha256(folder / "index.html"), "copied_images": 0,
            "expert_review": "No judgments inferred by queue preparation"}


def read_queue(folder, data_root):
    root, folder = Path(data_root).resolve(), Path(folder).resolve()
    if not folder.is_relative_to(root):
        raise ValueError("The review queue must remain inside its data root")
    plan = json.loads((folder / "queue.json").read_text())
    expected_id = plan.get("queue_id")
    if (plan.get("kind") != "neuroimage-review-queue" or plan.get("schema_version") != "1.0"
            or canonical_hash({key: value for key, value in plan.items() if key != "queue_id"})[:16] != expected_id):
        raise ValueError("Review queue identity changed")
    for case in plan["cases"]:
        packet = (root / case["packet"]).resolve()
        if not packet.is_relative_to(root) or sha256(packet / "review-plan.json") != case["plan_sha256"]:
            raise ValueError("Review queue packet identity changed")
        for image in case["image_set"]:
            path = (root / image["path"]).resolve()
            if not path.is_relative_to(root) or not path.is_file() or sha256(path) != image["sha256"]:
                raise ValueError("A queued source image changed")
    return plan


def assessment_template(plan):
    return {"schema_version": "1.0", "kind": "neuroimage-case-suitability", "queue_id": plan["queue_id"],
            "scope": SCOPE, "reviewer": "", "date": "", "items": [
                {"id": case["id"], "image_sha256": [image["sha256"] for image in case["image_set"]],
                 "decision": "not_reviewed", "notes": ""} for case in plan["cases"]]}


def validate_suitability(assessment, plan):
    template = assessment_template(plan)
    if not isinstance(assessment, dict) or set(assessment) != set(template):
        raise ValueError("Unsupported case suitability record")
    for key in ("kind", "schema_version", "queue_id", "scope"):
        if assessment[key] != template[key]:
            raise ValueError("Suitability record belongs to another queue or review scope")
    if any(not isinstance(assessment[key], str) or len(assessment[key]) > 500 for key in ("reviewer", "date")):
        raise ValueError("Invalid reviewer fields")
    items = assessment["items"]
    if not isinstance(items, list) or len(items) != len(template["items"]):
        raise ValueError("Suitability case inventory changed")
    expected = {item["id"]: item for item in template["items"]}
    seen = set()
    counts = dict.fromkeys(sorted(DECISIONS), 0)
    for item in items:
        if not isinstance(item, dict) or set(item) != {"id", "image_sha256", "decision", "notes"}:
            raise ValueError("Invalid suitability case fields")
        ident = item["id"]
        if not isinstance(ident, str) or ident not in expected or ident in seen or item["image_sha256"] != expected[ident]["image_sha256"]:
            raise ValueError("Suitability record changes a case or its exact image hashes")
        if not isinstance(item["decision"], str) or item["decision"] not in DECISIONS or not isinstance(item["notes"], str) or len(item["notes"]) > 10000:
            raise ValueError("Invalid suitability decision or notes")
        if item["decision"] in {"needs_revision", "unresolved"} and not item["notes"].strip():
            raise ValueError("Requested revisions and unresolved judgments require explanatory notes")
        seen.add(ident)
        counts[item["decision"]] += 1
    if any(item["decision"] != "not_reviewed" for item in items) and not assessment["reviewer"].strip():
        raise ValueError("Recorded judgments require a named reviewer or stated review role")
    return {"status": "record_format_verified", "queue_id": plan["queue_id"], "counts": counts,
            "scope": SCOPE, "anatomical_correctness": "Not verified by software",
            "expert_review_in_software_denominator": False}


def check_suitability(path, folder, data_root):
    path = Path(path)
    if path.stat().st_size > 8 * 1024 ** 2:
        raise ValueError("Suitability record exceeds the 8 MiB limit")
    return validate_suitability(json.loads(path.read_text()), read_queue(folder, data_root))
