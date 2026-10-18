"""Resumable, checksum-pinned acquisition with selective safe archive expansion."""
from pathlib import Path
from urllib.request import Request, urlopen
import json
import os
import re
import shutil
import stat
import tarfile
import time
import zipfile
from .adapters import load_recipe
from .build import GIB, atomic_json, build_lock, sha256, utc_now
from .contracts import safe_relative
from . import __version__


def destination(root, relative):
    safe_relative(relative)
    path = root / relative
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Destination escapes the selected data root: {relative}")
    return path


def capacity(root, additional, floor):
    free = shutil.disk_usage(root).free
    if free < additional + floor * GIB:
        raise ValueError(f"Insufficient capacity: need {additional / GIB:.3f} GiB plus {floor:g} GiB safety floor; have {free / GIB:.3f} GiB")


def download(spec, path, root, floor):
    expected, digest = spec.get("bytes"), spec.get("sha256")
    maximum = expected or spec.get("maximum_bytes", 1024 * 1024)
    if path.exists():
        if not path.is_file():
            raise ValueError(f"Existing source is not a file: {path.name}")
        if expected is not None and (path.stat().st_size != expected or sha256(path) != digest):
            raise ValueError(f"Existing source differs from the pinned release; it was preserved: {path.name}")
        if not path.is_file() or not 0 < path.stat().st_size <= maximum:
            raise ValueError(f"Invalid existing source: {path.name}")
        return {"status": "reused", "bytes": path.stat().st_size, "sha256": sha256(path), "url": spec["url"]}
    if not spec.get("url"):
        raise ValueError(f"A source archive must be obtained through its official access page: {spec.get('access_url', 'see source recipe')}. Expected {expected} bytes ({expected / GIB:.3f} GiB). Save the unchanged archive as {path}. Existing files were preserved; no download was attempted.")
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    if partial.is_symlink():
        raise ValueError(f"Partial source must not be a symbolic link: {partial.name}")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > maximum:
        raise ValueError(f"Oversize partial file preserved for inspection: {partial.name}")
    if expected is None:
        offset = 0  # Small license snapshots may change; never combine responses.
    if offset != expected:
        headers = {"User-Agent": f"NeuroImage/{__version__} local atlas acquisition", "Accept-Encoding": "identity"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        with urlopen(Request(spec["url"], headers=headers), timeout=45) as response:
            if offset and response.status == 206:
                match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                if not match or int(match[1]) != offset or int(match[2]) != expected - 1 or int(match[3]) != expected:
                    raise ValueError("Resume response has an inconsistent Content-Range")
            elif offset and response.status == 200:
                offset = 0
            elif response.status != 200:
                raise ValueError(f"Unexpected HTTP status {response.status}")
            if expected and "text/html" in response.headers.get("Content-Type", "").lower():
                raise ValueError("The source returned an HTML page instead of the requested archive")
            content_length = response.headers.get("Content-Length")
            if content_length and expected and int(content_length) + offset != expected:
                raise ValueError("Server response size differs from the pinned release")
            last = time.monotonic()
            with partial.open("ab" if offset else "wb") as stream:
                while block := response.read(1024 * 1024):
                    if offset + len(block) > maximum:
                        raise ValueError("Response exceeds the recipe size limit; partial file retained")
                    capacity(root, len(block), floor)
                    stream.write(block); offset += len(block)
                    if time.monotonic() - last >= 30:
                        print(json.dumps({"event": "download-progress", "file": path.name, "bytes": offset, "total_bytes": expected}), flush=True)
                        last = time.monotonic()
                stream.flush(); os.fsync(stream.fileno())
    if expected and offset != expected:
        raise ValueError("Incomplete transfer; partial file retained for resume")
    if not partial.is_file() or partial.stat().st_size == 0:
        raise ValueError("Empty source response")
    actual_digest = sha256(partial)
    if digest and actual_digest != digest:
        raise ValueError("Downloaded SHA256 differs from the pinned release; partial file retained for inspection")
    os.replace(partial, path)
    return {"status": "downloaded", "bytes": path.stat().st_size, "sha256": actual_digest, "url": spec["url"]}


def extract_members(archive_path, spec, root, floor):
    records = []
    archive_format = spec.get("format", "zip")
    if archive_format not in {"zip", "tar"}:
        raise ValueError("Unsupported source archive format")
    with (zipfile.ZipFile(archive_path) if archive_format == "zip" else tarfile.open(archive_path, "r:*")) as archive:
        names = archive.namelist() if archive_format == "zip" else archive.getnames()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive members require manual inspection")
        for member in spec["members"]:
            safe_relative(member["member"])
            info = archive.getinfo(member["member"]) if archive_format == "zip" else archive.getmember(member["member"])
            regular = not info.is_dir() and not stat.S_ISLNK(info.external_attr >> 16) if archive_format == "zip" else info.isfile()
            member_size = info.file_size if archive_format == "zip" else info.size
            if not regular or member_size != member["bytes"]:
                raise ValueError("Unsafe or unexpected selected archive member")
            target = destination(root, member["target"])
            if target.exists():
                if target.stat().st_size != member["bytes"] or sha256(target) != member["sha256"]:
                    raise ValueError(f"Existing extracted source differs from the pinned recipe and was preserved: {member['target']}")
                records.append({"path": member["target"], "status": "reused", "sha256": member["sha256"]})
                continue
            capacity(root, member_size, floor)
            target.parent.mkdir(parents=True, exist_ok=True)
            partial = target.with_name(target.name + ".extracting")
            if partial.is_symlink():
                raise ValueError(f"Partial extraction must not be a symbolic link: {partial.name}")
            size = 0
            with (archive.open(info) if archive_format == "zip" else archive.extractfile(info)) as source, partial.open("wb") as output:
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    if size > member_size:
                        raise ValueError("Archive member exceeds declared size")
                    capacity(root, len(chunk), floor)
                    output.write(chunk)
            if size != member_size or sha256(partial) != member["sha256"]:
                raise ValueError("Expanded source checksum differs from the recipe")
            os.replace(partial, target)
            records.append({"path": member["target"], "status": "extracted", "sha256": member["sha256"]})
    return records



def verified_source_members(spec, root):
    """Use pinned extracted inputs without reading or fetching an unused archive."""
    if not spec.get("members"):
        return None
    records, complete = [], True
    for member in spec["members"]:
        safe_relative(member["member"])
        target = destination(root, member["target"])
        if not target.exists():
            complete = False
            continue
        if not target.is_file() or target.stat().st_size != member["bytes"] or sha256(target) != member["sha256"]:
            raise ValueError(f"Existing extracted source differs from the pinned recipe and was preserved: {member['target']}")
        records.append({"path": member["target"], "status": "reused", "sha256": member["sha256"]})
    return records if complete else None


def acquisition_plan(recipe_name, data_root, *, minimum_free_gib=400):
    """Estimate existing-file reuse and peak space without writes or network access."""
    root = Path(data_root).resolve()
    if not root.is_dir():
        raise ValueError("Create the selected data root on the intended data drive before acquisition")
    recipe = load_recipe(recipe_name)
    expected_download = expected_expansion = 0
    for spec in recipe["archives"]:
        path = destination(root, f"downloads/{spec['dataset_id']}/{spec['filename']}")
        # Planning inspects sizes only; execution hashes every reused input.
        members_present = bool(spec["members"]) and all(
            destination(root, member["target"]).is_file() and destination(root, member["target"]).stat().st_size == member["bytes"]
            for member in spec["members"])
        if not members_present:
            expected_download += 0 if path.exists() else spec["bytes"]
            expected_expansion += sum(member["bytes"] for member in spec["members"] if not destination(root, member["target"]).exists())
    expected_download += sum(spec["bytes"] for spec in recipe.get("files", []) if not destination(root, spec["target"]).exists())
    expected_licenses = sum(spec["maximum_bytes"] for spec in recipe["license_downloads"] if not destination(root, spec["target"]).exists())
    # One output is written per transfer/extraction; no duplicate full expansion.
    peak = expected_download + expected_expansion + expected_licenses
    plan = {"recipe": recipe_name, "additional_download_bytes": expected_download,
            "additional_expansion_bytes": expected_expansion, "license_snapshot_budget_bytes": expected_licenses,
            "peak_additional_bytes": peak, "minimum_free_gib": minimum_free_gib,
            "archives": [{"url": a["url"], "access_url": a.get("access_url"), "save_as": f"downloads/{a['dataset_id']}/{a['filename']}", "bytes": a["bytes"], "sha256": a["sha256"]} for a in recipe["archives"]],
            "files": [{"url": a["url"], "save_as": a["target"], "bytes": a["bytes"], "sha256": a["sha256"]} for a in recipe.get("files", [])]}
    free = shutil.disk_usage(root).free
    plan.update(free_bytes=free, capacity_sufficient=free >= peak + minimum_free_gib * GIB)
    return plan


def acquire(recipe_name, data_root, *, minimum_free_gib=400, dry_run=False):
    root = Path(data_root).resolve()
    recipe = load_recipe(recipe_name)
    plan = acquisition_plan(recipe_name, root, minimum_free_gib=minimum_free_gib)
    capacity(root, plan["peak_additional_bytes"], minimum_free_gib)
    print(json.dumps({"event": "acquisition-plan", **plan}), flush=True)
    if dry_run:
        return plan
    folder = root / "downloads" / recipe_name
    folder.mkdir(parents=True, exist_ok=True)
    receipt_path = folder / "neuroimage-acquisition.json"
    with build_lock(folder / ".neuroimage-acquisition.lock"):
        receipt = {"recipe": recipe_name, "created_utc": utc_now(), "status": "in_progress", "plan": plan, "files": [], "expanded": []}
        atomic_json(receipt_path, receipt)
        try:
            for spec in recipe["archives"]:
                relative = f"downloads/{spec['dataset_id']}/{spec['filename']}"
                path = destination(root, relative)
                existing = verified_source_members(spec, root)
                if existing is not None:
                    receipt["files"].append({"path": relative, "status": "not_needed", "archive_verification": "not_performed_this_run", "reason": "All selected extracted inputs match their pinned sizes and SHA256 values"})
                    receipt["expanded"].extend(existing)
                    atomic_json(receipt_path, receipt)
                    continue
                record = download(spec, path, root, minimum_free_gib)
                receipt["files"].append({"path": relative, **record})
                receipt["expanded"].extend(extract_members(path, spec, root, minimum_free_gib))
                atomic_json(receipt_path, receipt)
            for spec in recipe.get("files", []):
                receipt["files"].append({"path": spec["target"], **download(spec, destination(root, spec["target"]), root, minimum_free_gib)})
                atomic_json(receipt_path, receipt)
            for spec in recipe["license_downloads"]:
                receipt["files"].append({"path": spec["target"], **download(spec, destination(root, spec["target"]), root, minimum_free_gib)})
                atomic_json(receipt_path, receipt)
            receipt["status"] = "complete"
        except BaseException as exc:
            receipt.update(status="interrupted" if isinstance(exc, KeyboardInterrupt) else "failed", error=str(exc), error_type=type(exc).__name__)
            raise
        finally:
            receipt["updated_utc"] = utc_now()
            atomic_json(receipt_path, receipt)
    print(json.dumps({"event": "acquisition-complete", "recipe": recipe_name, "downloads": sum(r["status"] == "downloaded" for r in receipt["files"]), "reused": sum(r["status"] == "reused" for r in [*receipt["files"], *receipt["expanded"]]), "extracted": sum(r["status"] == "extracted" for r in receipt["expanded"])}), flush=True)
    return receipt
