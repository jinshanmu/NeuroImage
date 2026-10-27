#!/usr/bin/env python3
"""Acquire verified healthy cases, retaining original archives and all packages.

Selectively expand masks and author-cleaned surfaces. Only newly expanded STL
copies may be removed after package validation; the verified original archive,
source geometry, source metadata and usable package remain on the data drive.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from importlib.metadata import PackageNotFoundError, version
import hashlib
import json
import multiprocessing
import os
from pathlib import Path
import re
import signal
import sys
import threading
import time
import zipfile
import shutil

import nrrd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from neuroimage.acquire import capacity, download, extract_members
from neuroimage.adapters import load_recipe
from neuroimage.case_selection import selected_cases
from neuroimage.build import atomic_json, build_atlas, build_lock, sha256
from neuroimage.validation import validate_package


DOWNLOAD_CONNECTIONS = 1
DOWNLOAD_CANCEL = threading.Event()


# Exact byte preimages audited in vtk-mug-preimage-2026-10-26/proof.json and
# cohort-browse-performance-2026-10-26/source-preimage-proof.json. These append
# VTK-only dispatch and speed up name lookup; MUG recipes and geometry agree.
# A later change to either endpoint does not inherit this exception.
VTK_REGISTRATION_COMPATIBILITY = {
    "adapters.py": {
        ("bdfbf87bd88d4055d8f84f864fd5cba016560a70bb3100d80b227a9bb103bb03", "9b25e173129b02edb1a50134e20b7fa8084ea2bd0d6ec10cdef020da98a0919f"),
        ("9b25e173129b02edb1a50134e20b7fa8084ea2bd0d6ec10cdef020da98a0919f", "b71a67e27d03aeb779108fb275b79a45d64849d738e7375c7776bdf1f340fb5c"),
        ("bdfbf87bd88d4055d8f84f864fd5cba016560a70bb3100d80b227a9bb103bb03", "b71a67e27d03aeb779108fb275b79a45d64849d738e7375c7776bdf1f340fb5c"),
    },
    "build.py": {("c048efd01fe9d351b1e12d8923100f1bd5219c42dde297d056dbe21c38c3db38", "b1de8ca91b9f178ad4ef2733bc175aba950eeeb26cc82023d2c7ee853c690125")},
    "model_build.py": {("c6f9a53938166d3a9c51b5b2bdf3adf6bfee5d32fbdd580063c149fb7c15018a", "1d33619cd8701affcc7fea4820ee69b26449cfbf00bb375dde5db271e2fc5ecf")},
}


def compatible_implementation(filename, recorded, current):
    return recorded == current or (recorded, current) in VTK_REGISTRATION_COMPATIBILITY.get(filename, set())


def event(kind, **fields):
    print(json.dumps({"event": kind, **fields}), flush=True)


def requested_cases(cases):
    allowed = selected_cases("mug500")
    if not allowed or len(allowed) > 10:
        raise ValueError("Require an explicit nonempty MUG inclusion policy of at most 10 cases")
    result = set(allowed if cases is None else cases)
    if not result or not result <= allowed:
        raise ValueError("Only currently included MUG cases may be acquired or built: " + ", ".join(sorted(allowed)))
    return result


def case_recipes(case, entry):
    kinds = ("healthy", "source_mesh") if "stl" in entry else ("healthy",)
    return [f"mug500_{kind}" + ("" if case == "A0101" else "_" + case.lower()) for kind in kinds]


def file_identity(path):
    item = path.stat()
    return [item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns]


def reusable_package(name, root, entry, *, protected=False):
    """Reuse unchanged anatomy after fresh integrity checks, without a raw STL.

    Adapter registration alone may change the build signature. Full recipe and
    original inputs must still match, as must every other construction module
    and dependency. Actual geometry changes therefore require a new build.
    """
    recipe = load_recipe(name)
    pins = {item["target"]: item for archive in recipe.get("archives", []) for item in archive["members"]}
    for manifest in sorted((root / "derivatives" / name).glob("*/manifest.json")):
        try:
            data = json.loads(manifest.read_text())
            build = data["build"]
            if data["dataset_id"] != name or build["recipe"] != recipe:
                continue
            if not protected:
                implementation = build["implementation"]
                required_code = {"adapters.py", "build.py", "geometry.py", "contracts.py", "dataset_policy.py", "lessons.py"}
                if recipe.get("representation") == "surface-model":
                    required_code.update(("model_build.py", "model_geometry.py", "stl_extract.py"))
                if not required_code <= set(implementation) or any(
                    Path(filename).name != filename or not filename.endswith(".py")
                    or not compatible_implementation(filename, digest,
                        sha256(Path(sys.modules[build_atlas.__module__].__file__).with_name(filename)))
                    for filename, digest in implementation.items()):
                    continue
                libraries = build["libraries"]
                if not {"numpy", "scipy", "nibabel", "pynrrd", "scikit-image", "pydantic"} <= set(libraries) or any(
                        version(library) != value for library, value in libraries.items()):
                    continue
            inputs = {item["id"]: item for item in build["inputs"]}
            if set(inputs) != set(recipe["inputs"]):
                continue
            identical = True
            for key, relative in recipe["inputs"].items():
                item = inputs[key]
                pin = pins.get(relative)
                if item["path"] != relative or (pin and (item["sha256"] != pin["sha256"] or item["bytes"] != pin["bytes"])):
                    identical = False
                    break
                path = root / relative
                if path.exists():
                    if not path.is_file() or path.stat().st_size != item["bytes"] or sha256(path) != item["sha256"]:
                        identical = False
                        break
                elif key != "stl" or not pin or entry["archive"]["sha256"] != recipe["archives"][0]["sha256"]:
                    identical = False
                    break
            if identical:
                validate_package(manifest, cache_policy="reuse")
                return manifest
        except (OSError, ValueError, KeyError, TypeError, PackageNotFoundError):
            # A broken/incomplete derivative is not evidence of complete anatomy.
            continue
    return None


def matching_inventory(entry, archive, names, zipped):
    if entry is None or entry.get("archive") != archive:
        return False
    expected = {"labels": names["labels"], **({"stl": names["stl"]} if "stl" in names else {})}
    if {key for key in ("labels", "stl") if key in entry} != set(expected):
        return False
    return all(entry[key]["member"] == name and entry[key]["bytes"] == zipped.getinfo(name).file_size
               for key, name in expected.items())


def record_created_stl(case, target, member, archive, state, state_path):
    if state is None:
        return
    state["owned_stl"][member["target"]] = {
        "case": case, "sha256": member["sha256"], "identity": file_identity(target),
        "archive_sha256": archive["sha256"], "status": "pending"}
    atomic_json(state_path, state)


def release_owned_stl(case, entry, root, state, state_path, archive_identity):
    member = entry.get("stl")
    if member is None:
        return
    owned = state["owned_stl"].get(member["target"])
    if not owned or owned["status"] != "pending":
        return  # Pre-existing, unowned source copies are always preserved.
    path = root / member["target"]
    if not path.exists():
        owned["status"] = "already-absent"
        atomic_json(state_path, state)
        return
    archive = entry["archive"]
    archive_path = root / "downloads/mug500_healthy" / archive["filename"]
    if (owned["case"] != case or owned["archive_sha256"] != archive["sha256"]
            or file_identity(archive_path) != archive_identity
            or path.is_symlink() or file_identity(path) != owned["identity"]
            or sha256(path) != owned["sha256"] or owned["sha256"] != member["sha256"]):
        raise ValueError("Owned temporary source or verified archive changed; preserved " + str(path))
    path.unlink()
    owned["status"] = "released"
    atomic_json(state_path, state)
    event("temporary-stl-released", case=case, original_archive_retained=True)


def construct_case(job):
    """Module-level spawn worker: original geometry, one complete case at a time."""
    case, root, entry = job["case"], Path(job["root"]), job["entry"]
    packages = []
    for name in case_recipes(case, entry):
        started = time.monotonic()
        manifest = reusable_package(name, root, entry, protected=case == "A0101")
        reused = manifest is not None
        if not reused:
            if case == "A0101":
                raise ValueError("Protected original A0101 package missing or differs; no rebuild attempted")
            manifest = build_atlas(name, root, workers=job["workers"], minimum_free_gib=job["floor"])
            # The constructor validates before publishing; reuse the receipt only
            # after fresh asset hashing, rather than repeat all geometry checks.
            validate_package(manifest, cache_policy="reuse")
        packages.append({"recipe": name, "manifest": str(manifest), "reused": reused})
        event("case-package-validated", case=case, recipe=name, reused=reused,
              seconds=round(time.monotonic() - started, 2))
    return {"case": case, "packages": packages}


def case_concurrency(root, parallel_cases, floor, peak_gib=6):
    headroom = shutil.disk_usage(root).free / 1024**3 - floor
    if headroom < peak_gib:
        raise ValueError(f"Need {peak_gib:g} GiB construction reserve above the unchanged {floor:g} GiB floor")
    return min(parallel_cases, int(headroom // peak_gib))


def archive_record(source, root, allow_download, floor):
    target = root / "downloads/mug500_healthy" / source["name"]
    if not target.is_file():
        if not allow_download:
            return None
        ranged = False
        if DOWNLOAD_CONNECTIONS > 1:
            from mug_range_download import download_ranges
            ranged = download_ranges(source, target, root, floor, DOWNLOAD_CONNECTIONS,
                                      stop=DOWNLOAD_CANCEL, emit=event)
        if not ranged:
            download({"bytes": source["size"], "url": source["download_url"]}, target, root, floor)
    if target.stat().st_size != source["size"]:
        raise ValueError(f"Unexpected archive size; preserved {target}")
    md5, sha = hashlib.md5(), hashlib.sha256()
    with target.open("rb") as stream:
        while data := stream.read(4 * 1024 * 1024):
            md5.update(data)
            sha.update(data)
    if md5.hexdigest() != source["computed_md5"]:
        raise ValueError(f"Publisher MD5 mismatch; preserved {target}")
    return {"dataset_id": "mug500_healthy", "filename": source["name"], "format": "zip",
            "url": source["download_url"], "bytes": source["size"], "sha256": sha.hexdigest(),
            "hash_basis": "SHA256 of official version-20 archive verified against publisher MD5 " + md5.hexdigest()}


def prepare_archive(source, archive, root, selected, inventory, floor, state=None, state_path=None):
    path = root / "downloads/mug500_healthy" / archive["filename"]
    prepared = []
    with zipfile.ZipFile(path) as zipped:
        names = zipped.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive member names")
        label_files = [name for name in names if re.fullmatch(r"A\d{4}\.nrrd", Path(name).name)]
        labels = {Path(name).stem: name for name in label_files}
        first, last = int(source["name"][1:5]), int(source["name"][7:11])
        expected_cases = {f"A{number:04d}" for number in range(first, last + 1)}
        if len(labels) != len(label_files) or set(labels) != expected_cases or any(
                Path(name).parent.name != case for case, name in labels.items()):
            raise ValueError("Archive case directories and exact publisher range differ: " + source["name"])
        for case, label_name in sorted(labels.items()):
            if selected and case not in selected:
                continue
            member_names = {"labels": label_name}
            # Preserve the two publisher filename anomalies exactly. The
            # explicit case directory establishes their original association.
            clean_name = {"A0192": "A192_clear.stl", "A0473": "A0473_clear .stl"}.get(case, case + "_clear.stl")
            clean = [name for name in names if Path(name).parent.name == case and Path(name).name == clean_name]
            if len(clean) > 1:
                raise ValueError("Multiple cleaned source meshes for " + case)
            if clean:
                member_names["stl"] = clean[0]
            previous = inventory["cases"].get(case)
            known = matching_inventory(previous, archive, member_names, zipped)
            completed = set()
            if known:
                for name in case_recipes(case, previous):
                    if reusable_package(name, root, previous, protected=case == "A0101") is not None:
                        completed.add(name)
                if len(completed) == len(case_recipes(case, previous)):
                    prepared.append({"case": case, "entry": previous, "already_complete": True})
                    event("case-reused", case=case, packages=len(completed), source_expansion=False)
                    continue
            entry = {"archive": archive}
            for kind, name in member_names.items():
                info = zipped.getinfo(name)
                if known:
                    member = dict(previous[kind])
                else:
                    digest = hashlib.sha256()
                    with zipped.open(info) as stream:
                        while data := stream.read(4 * 1024 * 1024):
                            digest.update(data)
                    member = {"member": name, "target": "raw/mug500_healthy/" + Path(name).name,
                              "bytes": info.file_size, "sha256": digest.hexdigest()}
                target = root / member["target"]
                mesh_recipe = "mug500_source_mesh" + ("" if case == "A0101" else "_" + case.lower())
                if kind != "stl" or mesh_recipe not in completed or target.exists():
                    extracted = extract_members(path, {**archive, "members": [member]}, root, floor)
                    if kind == "stl" and extracted[0]["status"] == "extracted":
                        record_created_stl(case, target, member, archive, state, state_path)
                entry[kind] = member
            header = nrrd.read_header(str(root / entry["labels"]["target"]))
            if header.get("dimension") != 3 or header.get("space") not in ("left-posterior-superior", "right-anterior-superior"):
                raise ValueError("Unexpected original source NRRD physical coordinate definition for " + case)
            entry["label_header"] = {"space": header["space"], "sizes": header["sizes"].tolist(),
                                     "space_directions": header["space directions"].tolist(),
                                     "space_origin": header["space origin"].tolist()}
            if previous is not None and previous != entry:
                raise ValueError("Existing case inventory differs; preserved " + case)
            inventory["cases"][case] = entry
            prepared.append({"case": case, "entry": entry, "already_complete": False})
            event("case-prepared", case=case, cleaned_mesh=bool(clean))
    return prepared


def remaining_download_bytes(source, root):
    target = root / "downloads/mug500_healthy" / source["name"]
    if target.is_file():
        return 0
    partial = target.with_name(target.name + ".partial")
    return max(0, source["size"] - (partial.stat().st_size if partial.is_file() else 0))


def prefetch_fits(root, source, floor, concurrency, peak_gib=6):
    # Keep every active builder's declared peak, plus a further 6-GiB buffer.
    return (shutil.disk_usage(root).free - (floor + peak_gib * concurrency + 6) * 1024**3
            >= remaining_download_bytes(source, root))


def run(args):
    root = args.data_root.resolve()
    selected = requested_cases(args.cases)
    record_path = root / "licenses/mug500_healthy/official-record-v20.json"
    record = json.loads(record_path.read_text())
    if record["version"] != 20 or record["id"] != 9616319 or record["license"]["name"] != "CC BY 4.0":
        raise ValueError("Require the pinned official MUG500+ version-20 license record")
    sources = [item for item in record["files"] if re.fullmatch(r"A\d{4}-A\d{4}\.zip", item["name"])]
    if selected:
        sources = [item for item in sources if any(int(item["name"][1:5]) <= int(case[1:]) <= int(item["name"][7:11]) for case in selected)]
    sources.sort(key=lambda item: (not (root / "downloads/mug500_healthy" / item["name"]).is_file(), item["name"]))
    catalog = Path(__file__).resolve().parents[1] / "src/neuroimage/catalogs/mug500-cases.json"
    inventory = json.loads(catalog.read_text()) if catalog.is_file() else {
        "schema_version": "1", "source_record": "10.6084/m9.figshare.9616319.v20",
        "expected_healthy_cases": 500, "cases": {}}
    state_path = root / "downloads/mug500_healthy/cohort-pipeline-state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {
        "schema_version": "1", "source_record_sha256": sha256(record_path), "owned_stl": {}, "completed": {}}
    if state.get("schema_version") != "1" or state.get("source_record_sha256") != sha256(record_path):
        raise ValueError("Pipeline state belongs to a different original source record; preserved")
    prefetched = None
    prepared_cases, completed_cases = set(), set()
    # Only this single downloader may overlap the active construction pool.
    with ThreadPoolExecutor(max_workers=1) as prefetch_pool:
        for start in range(0, len(sources), 3):
            batch = sources[start:start + 3]
            archives = {}
            prefetched_future = None
            prefetched_name = None
            if prefetched is not None:
                prefetched_name, prefetched_future = prefetched
                prefetched = None
            pending = [item for item in batch if item["name"] != prefetched_name]
            capacity(root, sum(remaining_download_bytes(item, root) for item in batch), args.minimum_free_gib)
            with ThreadPoolExecutor(max_workers=3) as executor:
                futures = {executor.submit(archive_record, item, root, args.download, args.minimum_free_gib): item for item in pending}
                if prefetched_future is not None:
                    futures[prefetched_future] = next(item for item in batch if item["name"] == prefetched_name)
                for future in as_completed(futures):
                    item = futures[future]
                    try:
                        archives[item["name"]] = future.result()
                    except Exception as exc:
                        if future is not prefetched_future:
                            raise
                        event("archive-prefetch-failed", archive=item["name"], error=str(exc))
                        # Retry its retained partial only after the prefetch has
                        # finished. Other batch downloads are already running.
                        archives[item["name"]] = archive_record(item, root, args.download, args.minimum_free_gib)
            prepared, identities = [], {}
            for source in batch:
                archive = archives[source["name"]]
                if archive is None:
                    continue
                identities[archive["filename"]] = file_identity(root / "downloads/mug500_healthy" / archive["filename"])
                prepared.extend(prepare_archive(source, archive, root, selected, inventory,
                    args.minimum_free_gib, state, state_path))
                # Publish each verified archive promptly; workers start only after
                # the complete batch is published and the case queue is fixed.
                atomic_json(catalog, inventory)
            prepared_cases.update(item["case"] for item in prepared)
            if not args.build:
                continue
            jobs = []
            for item in prepared:
                case, entry = item["case"], item["entry"]
                if item["already_complete"]:
                    completed_cases.add(case)
                    if args.release_new_stl_copies:
                        release_owned_stl(case, entry, root, state, state_path, identities[entry["archive"]["filename"]])
                else:
                    jobs.append({"case": case, "entry": entry, "root": str(root),
                                 "workers": args.workers, "floor": args.minimum_free_gib})
            if not jobs:
                continue
            peak_gib = max(6, *(float(load_recipe(name).get("construction_peak_gib", 2))
                for job in jobs for name in case_recipes(job["case"], job["entry"])))
            concurrency = min(len(jobs), case_concurrency(root, args.parallel_cases, args.minimum_free_gib, peak_gib))
            event("construction-batch", cases=len(jobs), processes=concurrency, workers_per_case=args.workers,
                  native_threads=args.native_threads, reserve_gib=concurrency * peak_gib)
            if args.download and not args.no_prefetch and start + 3 < len(sources):
                following = sources[start + 3]
                if remaining_download_bytes(following, root) and prefetch_fits(
                        root, following, args.minimum_free_gib, concurrency, peak_gib):
                    prefetched = (following["name"], prefetch_pool.submit(
                        archive_record, following, root, True, args.minimum_free_gib))
                    event("archive-prefetch", archive=following["name"], active_build_reserve_gib=concurrency * peak_gib)
            failures = []
            with ProcessPoolExecutor(max_workers=concurrency, mp_context=multiprocessing.get_context("spawn")) as executor:
                futures = {executor.submit(construct_case, job): job for job in jobs}
                for future in as_completed(futures):
                    job = futures[future]
                    try:
                        result = future.result()
                        completed_cases.add(job["case"])
                        state["completed"][job["case"]] = result["packages"]
                        atomic_json(state_path, state)
                        if args.release_new_stl_copies:
                            release_owned_stl(job["case"], job["entry"], root, state, state_path,
                                              identities[job["entry"]["archive"]["filename"]])
                    except Exception as exc:
                        failures.append((job["case"], str(exc)))
                        event("case-failed", case=job["case"], error=str(exc), sources_preserved=True)
            if failures:
                raise RuntimeError("Case failures; completed packages/checkpoints retained: " + repr(failures))
    expected = selected
    missing = sorted(expected - prepared_cases)
    unbuilt = sorted(prepared_cases - completed_cases) if args.build else []
    event("cohort-inventory", healthy_cases=len(inventory["cases"]),
          cleaned_meshes=sum("stl" in item for item in inventory["cases"].values()),
          verified_this_run=len(prepared_cases), completed_cases=len(completed_cases), missing_cases=missing,
          unbuilt_cases=unbuilt)
    if args.download and (missing or unbuilt):
        raise ValueError("Requested cohort incomplete; missing=" + repr(missing) + ", unbuilt=" + repr(unbuilt))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", required=True, type=Path)
    parser.add_argument("--cases", nargs="*", help="Subset of the current inclusion policy; default its at most 10 healthy cases")
    parser.add_argument("--download", action="store_true", help="Fetch missing official archives")
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--release-new-stl-copies", action="store_true")
    parser.add_argument("--minimum-free-gib", type=float, default=400)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--parallel-cases", type=int, default=1)
    parser.add_argument("--native-threads", type=int, default=1,
                        help="BLAS/OpenMP threads per spawned process")
    parser.add_argument("--no-prefetch", action="store_true", help="Disable reserve-controlled single-archive prefetch")
    parser.add_argument("--download-ranges", type=int, default=16,
                        help="HTTP range connections per archive, at most three active archives")
    args = parser.parse_args()
    if not 1 <= args.parallel_cases <= 16:
        parser.error("Parallel cases must be between 1 and 16")
    if not 1 <= args.workers <= 8 or not 1 <= args.native_threads <= 8:
        parser.error("Workers and native threads must be between 1 and 8")
    if not 1 <= args.download_ranges <= 16:
        parser.error("Download ranges must be between 1 and 16")
    selected = set(args.cases or [])
    if any(not re.fullmatch(r"A\d{4}", case) or not 1 <= int(case[1:]) <= 500 for case in selected):
        parser.error("Cases must be publisher healthy IDs A0001 through A0500")
    try:
        requested_cases(args.cases)
    except ValueError as exc:
        parser.error(str(exc))
    for key in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[key] = str(args.native_threads)
    folder = args.data_root.resolve() / "downloads/mug500_healthy"
    folder.mkdir(parents=True, exist_ok=True)
    global DOWNLOAD_CONNECTIONS
    DOWNLOAD_CONNECTIONS = args.download_ranges
    DOWNLOAD_CANCEL.clear()

    def interrupt_transfer(signum, frame):
        DOWNLOAD_CANCEL.set()
        raise KeyboardInterrupt

    previous = signal.signal(signal.SIGINT, interrupt_transfer)
    try:
        with build_lock(folder / ".cohort-pipeline.lock"):
            run(args)
    finally:
        signal.signal(signal.SIGINT, previous)


if __name__ == "__main__":
    main()
