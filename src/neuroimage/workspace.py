"""Local source-to-teaching jobs with separate state storage and reusable checkpoints."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
import traceback
from typing import Literal
import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .acquire import acquisition_plan, capacity, destination
from .adapters import load_recipe, recipe_names
from .build import GIB, atomic_json, utc_now
from .coverage import module_catalog, source_coverage, source_details
from .library import BINDING_BYTES_LIMIT, content_binding, library_records
from .teaching import curriculum_names, curriculum_path, curriculum_matches

JOB_ID = re.compile(r"^[a-f0-9]{32}$")
ACTIVE = {"running", "stopping"}
LOG_LIMIT = 1024 ** 2


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    action: Literal["acquire", "build", "activate", "prepare", "prepare-course"]
    recipe: str | None = Field(default=None, min_length=1, max_length=100)
    package_key: str | None = Field(default=None, min_length=1, max_length=256)
    curriculum: str | None = Field(default=None, min_length=1, max_length=100)
    course_plan: str | None = Field(default=None, min_length=1, max_length=100)
    package_keys: dict[str, str] | None = Field(default=None, min_length=1, max_length=32)

    @model_validator(mode="after")
    def required_fields(self):
        expected = {"acquire": {"recipe"}, "build": {"recipe"},
                    "activate": {"package_key"}, "prepare": {"package_key", "curriculum"},
                    "prepare-course": {"course_plan", "package_keys"}}[self.action]
        supplied = {name for name in ("recipe", "package_key", "curriculum", "course_plan", "package_keys") if getattr(self, name) is not None}
        if supplied != expected:
            raise ValueError(f"Action {self.action} requires exactly: {', '.join(sorted(expected))}")
        return self


def package_key(record):
    return record["package_id"] + "-" + record["package_version"]


def load_small_json(path, maximum=128 * 1024):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise ValueError("Workspace metadata is missing, oversized or a symbolic link")
    return json.loads(path.read_text())


class Workspace:
    def __init__(self, data_root, state_root, *, workers=2, data_floor_gib=400, state_floor_gib=60):
        self.data_root, self.state_root = Path(data_root).resolve(), Path(state_root).resolve()
        if not self.data_root.is_dir():
            raise ValueError("Create the selected data directory on the intended data drive first")
        if self.state_root.is_relative_to(self.data_root) or self.data_root.is_relative_to(self.state_root):
            raise ValueError("Workspace state and imaging data require separate, non-nested directories")
        if not 1 <= workers <= 8 or data_floor_gib < 0 or state_floor_gib < 0:
            raise ValueError("Use 1 to 8 workers and nonnegative storage safety floors")
        self.state_root.mkdir(parents=True, exist_ok=True)
        capacity(self.state_root, 2 * LOG_LIMIT, state_floor_gib)
        self.jobs_root = self.state_root / "jobs"
        if self.jobs_root.is_symlink():
            raise ValueError("The workspace jobs directory must not be a symbolic link")
        self.jobs_root.mkdir(exist_ok=True)
        self._lease = (self.state_root / ".workspace.lock").open("a")
        try:
            fcntl.flock(self._lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self._lease.close()
            raise ValueError("Another workspace or owned job is using this state directory; stop it before reopening") from error
        self.workers, self.data_floor_gib, self.state_floor_gib = workers, data_floor_gib, state_floor_gib
        self._lock = threading.RLock()
        self._process = None
        self._thread = None
        self._active_id = None
        self._closed = False
        self.register_package = None
        self.jobs = {}
        self._browse_cache = None
        self._browse_lock = threading.Lock()
        try:
            config = self.state_root / "workspace.json"
            if config.exists() and load_small_json(config).get("data_root") != str(self.data_root):
                raise ValueError("This state directory belongs to a different data root; use its original root or a new state directory")
            atomic_json(config, {"schema_version": "1.0", "data_root": str(self.data_root),
                                "workers": workers, "data_floor_gib": data_floor_gib, "state_floor_gib": state_floor_gib})
            for folder in self.jobs_root.iterdir():
                if not JOB_ID.fullmatch(folder.name) or folder.is_symlink() or not folder.is_dir():
                    continue
                try:
                    job = load_small_json(folder / "status.json")
                    if job.get("id") != folder.name:
                        continue
                    if job.get("status") in ACTIVE:
                        job.update(status="interrupted", finished_utc=utc_now(),
                                   detail="The previous workspace ended. Run the same operation to reuse verified source files and checkpoints.")
                        atomic_json(folder / "status.json", job)
                    self.jobs[job["id"]] = job
                except (ValueError, OSError):
                    # Preserve unreadable diagnostics; never replace them with a new job.
                    continue
        except BaseException:
            self._lease.close()
            raise

    def browse(self, *, refresh=False):
        """Bounded home-page discovery; opening still validates every asset."""
        with self._browse_lock:
            with self._lock:
                revision = (len(self.jobs), self._active_id)
            cached = self._browse_cache
            if not refresh and cached and cached[0] == revision and time.monotonic() - cached[1] < 30:
                return json.loads(cached[2])
            sources = []
            for name in recipe_names():
                recipe = load_recipe(name)
                sources.append({"id": name, "title": recipe["title"], "sources": recipe["sources"],
                    "inputs_required": len(recipe["inputs"]),
                    "inputs_present": sum(destination(self.data_root, p).is_file() for p in recipe["inputs"].values())})
            records = []
            for record in library_records(self.data_root):
                if record.get("status") != "available":
                    continue
                manifest = load_small_json(record["manifest"], BINDING_BYTES_LIMIT)
                records.append({key: record[key] for key in ("dataset_id", "title", "package_version", "created_utc", "representation", "status")})
                records[-1].update(key=package_key(record),
                    coverage=source_coverage(record["dataset_id"], manifest["structures"]),
                    detail_coverage=source_details(record["dataset_id"], manifest["structures"]))
            value = {"sources": sources, "packages": records, "active_job": revision[1]}
            self._browse_cache = (revision, time.monotonic(), json.dumps(value))
            return value

    def catalog(self, *, jobs_offset=0):
        from .course_plans import plan_catalog
        if not isinstance(jobs_offset, int) or isinstance(jobs_offset, bool) or jobs_offset < 0:
            raise ValueError("Operation history offset must be a nonnegative integer")
        import shutil
        sources = []
        for name in recipe_names():
            recipe = load_recipe(name)
            try:
                plan = acquisition_plan(name, self.data_root, minimum_free_gib=self.data_floor_gib)
                present = sum(destination(self.data_root, p).is_file() for p in recipe["inputs"].values())
                peak = max(2, float(recipe.get("construction_peak_gib", 2))) * GIB
                sources.append({"id": name, "title": recipe["title"], "representation": recipe.get("representation", "mri-labels"),
                                "sources": recipe["sources"], "coverage": source_coverage(name), "plan": plan, "inputs_present": present,
                                "inputs_required": len(recipe["inputs"]), "construction_peak_bytes": int(peak),
                                "build_capacity_sufficient": plan["free_bytes"] >= peak + self.data_floor_gib * GIB})
            except (ValueError, OSError) as error:
                sources.append({"id": name, "title": recipe["title"], "error": str(error), "sources": recipe["sources"], "coverage": source_coverage(name)})
        books, book_recipes = [], {}
        for name in curriculum_names():
            recipe = json.loads(curriculum_path(name).read_text())
            book_recipes[name] = recipe
            books.append({"id": name, "dataset_id": recipe["dataset_id"], "title": recipe["title"],
                          "scenes": len(recipe["scenes"]), "review_status": recipe["review_status"]})
        records = library_records(self.data_root)
        for record in records:
            if record.get("status") == "available":
                record["key"] = package_key(record)
                manifest = load_small_json(record["manifest"], BINDING_BYTES_LIMIT)
                record["compatible_curricula"] = [name for name, recipe in book_recipes.items() if curriculum_matches(recipe, manifest)]
                record["coverage"] = source_coverage(record["dataset_id"], manifest["structures"])
                record["detail_coverage"] = source_details(record["dataset_id"], manifest["structures"])
        with self._lock:
            ordered = sorted(self.jobs.values(), key=lambda j: (j["started_utc"], j["id"]), reverse=True)
            jobs = ordered[jobs_offset:jobs_offset + 30]
            jobs = json.loads(json.dumps(jobs))
            active = self._active_id
        return {"schema_version": "1.0", "data_root": str(self.data_root), "state_root": str(self.state_root),
                "data_free_bytes": shutil.disk_usage(self.data_root).free,
                "state_free_bytes": shutil.disk_usage(self.state_root).free,
                "data_floor_gib": self.data_floor_gib, "state_floor_gib": self.state_floor_gib,
                "workers": self.workers, "sources": sources, "packages": records, "curricula": books, "course_plans": plan_catalog(),
                "modules": [{"id": module["id"], "title": module["title"]} for module in module_catalog()],
                "jobs": jobs, "jobs_total": len(ordered), "jobs_offset": jobs_offset, "jobs_limit": 30, "active_job": active,
                "source_status_scope": "Presence and size metadata only; acquisition and construction verify source hashes. Opening an atlas verifies its assets and geometry."}

    def job_status(self, identity):
        with self._lock:
            if not JOB_ID.fullmatch(identity) or identity not in self.jobs:
                raise ValueError("Choose an existing local operation")
            return json.loads(json.dumps(self.jobs[identity]))

    def _request(self, value):
        request = JobRequest.model_validate(value).model_dump(exclude_none=True)
        action = request["action"]
        if action in {"acquire", "build"}:
            if request["recipe"] not in recipe_names():
                raise ValueError("Choose an installed source recipe")
            recipe = load_recipe(request["recipe"])
            budget = (acquisition_plan(request["recipe"], self.data_root, minimum_free_gib=self.data_floor_gib)["peak_additional_bytes"]
                      if action == "acquire" else max(2, float(recipe.get("construction_peak_gib", 2))) * GIB)
            capacity(self.data_root, budget, self.data_floor_gib)
        elif action == "prepare-course":
            from .course_plans import plan_names, plan_path, read_plan, resolve_packages
            if request["course_plan"] not in plan_names():
                raise ValueError("Choose an installed course plan")
            resolve_packages(read_plan(plan_path(request["course_plan"])), request["package_keys"], self.data_root)
            capacity(self.data_root, 128 * 1024 ** 2, self.data_floor_gib)
        else:
            matches = [r for r in library_records(self.data_root) if r.get("status") == "available" and package_key(r) == request["package_key"]]
            if len(matches) != 1:
                raise ValueError("Choose exactly one available local atlas version")
            request["manifest"] = matches[0]["manifest"]
            if action == "prepare":
                if request["curriculum"] not in curriculum_names():
                    raise ValueError("Choose an installed teaching recipe")
                recipe = json.loads(curriculum_path(request["curriculum"]).read_text())
                if recipe["dataset_id"] != matches[0]["dataset_id"]:
                    raise ValueError("This teaching recipe belongs to another source dataset")
                if not curriculum_matches(recipe, load_small_json(request["manifest"], BINDING_BYTES_LIMIT)):
                    raise ValueError("This atlas version lacks the source version or structures required by the teaching recipe")
                capacity(self.data_root, 64 * 1024 ** 2, self.data_floor_gib)
        return request

    def _command(self, request_path):
        return [sys.executable, "-u", "-m", "neuroimage.workspace", "--request", str(request_path)]

    def start(self, value):
        with self._lock:
            if self._closed or self._active_id:
                raise ValueError("Wait for the current operation to finish or stop it before starting another")
            capacity(self.state_root, 2 * LOG_LIMIT, self.state_floor_gib)
            request = self._request(value)
            ident = uuid.uuid4().hex
            folder = self.jobs_root / ident
            folder.mkdir()
            payload = {**request, "data_root": str(self.data_root), "workers": self.workers,
                       "minimum_free_gib": self.data_floor_gib}
            atomic_json(folder / "request.json", payload)
            job = {"id": ident, "request": {k: v for k, v in request.items() if k != "manifest"},
                   "status": "running", "started_utc": utc_now(), "events": [], "detail": "Starting the local operation"}
            self.jobs[ident] = job
            atomic_json(folder / "status.json", job)
            env = dict(os.environ, PYTHONNOUSERSITE="1", PYTHONUNBUFFERED="1", OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="1")
            try:
                # The inherited lease prevents a second controller after an
                # abrupt parent exit while an owned operation is still alive.
                process = subprocess.Popen(self._command(folder / "request.json"), stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", env=env,
                    start_new_session=True, pass_fds=(self._lease.fileno(),))
            except OSError as error:
                job.update(status="failed", finished_utc=utc_now(), detail=str(error))
                atomic_json(folder / "status.json", job)
                raise
            self._process, self._active_id = process, ident
            self._thread = threading.Thread(target=self._watch, args=(ident, process), daemon=True)
            self._thread.start()
            return {"id": ident, "status": "running"}

    def _watch(self, ident, process):
        folder = self.jobs_root / ident
        result, failure, written = None, None, 0
        try:
            with (folder / "operation.log").open("w") as log:
                for line in process.stdout:
                    if written < LOG_LIMIT:
                        portion = line[:LOG_LIMIT - written]
                        log.write(portion); log.flush(); written += len(portion)
                    try:
                        event = json.loads(line)
                        if not isinstance(event, dict):
                            continue
                    except ValueError:
                        continue
                    if event.get("event") == "workspace-result":
                        result = event["result"]
                    if event.get("event") == "workspace-failure":
                        failure = event["message"]
                    with self._lock:
                        job = self.jobs[ident]
                        # Keep bounded progress metadata; full source content
                        # and image payloads never enter the job state.
                        compact = {k: v for k, v in event.items() if k not in {"archives", "files", "result"}}
                        if len(json.dumps(compact)) <= 4096:
                            job["events"] = (job["events"] + [compact])[-20:]
                        job["detail"] = str(event.get("message") or event.get("event", "Operation in progress"))[:2000]
                        atomic_json(folder / "status.json", job)
            code = process.wait()
            with self._lock:
                stopped = self.jobs[ident]["status"] == "stopping"
            if not stopped and code == 0 and result:
                if result.get("manifest") and self.register_package:
                    result["atlas_key"] = self.register_package(Path(result["manifest"]))
                if result.get("notebook"):
                    result["notebook_sha256"] = hashlib.sha256(Path(result["notebook"]).read_bytes()).hexdigest()
                    result["content_url"] = "/api/workspace/content/" + ident
                    result["open_url"] = "/?workspace-content=" + ident
            with self._lock:
                job = self.jobs[ident]
                if stopped or job["status"] == "stopping":
                    job.update(status="cancelled", detail="Stopped. Verified source files and completed checkpoints remain reusable.")
                elif code == 0 and result:
                    job.update(status="complete", detail="Operation complete", result=result)
                else:
                    job.update(status="failed", detail=failure or f"Operation exited with status {code}; inspect the retained local diagnostic log")
                job.update(finished_utc=utc_now(), exit_code=code, log_truncated=written >= LOG_LIMIT)
                atomic_json(folder / "status.json", job)
        except BaseException as error:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGINT)
                except ProcessLookupError:
                    pass
                self._finish_stop(process)
            with self._lock:
                job = self.jobs[ident]
                job.update(status="failed", detail=str(error)[:2000], finished_utc=utc_now())
                try:
                    atomic_json(folder / "status.json", job)
                except OSError:
                    pass  # Keep the in-memory failure if state storage is unavailable.
        finally:
            process.stdout.close()
            with self._lock:
                self._active_id = None
                self._process = None
                if self._closed:
                    self._lease.close()

    def cancel(self, ident):
        with self._lock:
            if ident != self._active_id or self._process is None:
                raise ValueError("This operation is no longer running")
            process = self._process
            job = self.jobs[ident]
            job.update(status="stopping", detail="Stopping the owned operation; completed checkpoints will be retained")
            atomic_json(self.jobs_root / ident / "status.json", job)
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGINT)
                except ProcessLookupError:
                    pass
        threading.Thread(target=self._finish_stop, args=(process,), daemon=True).start()
        return {"id": ident, "status": "stopping"}

    @staticmethod
    def _finish_stop(process):
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def content(self, ident):
        if not JOB_ID.fullmatch(ident):
            raise ValueError("Unknown prepared teaching file")
        with self._lock:
            job = self.jobs.get(ident)
            if not job or job.get("status") != "complete" or job["request"]["action"] != "prepare":
                raise ValueError("This job has no completed teaching file")
            result = dict(job["result"])
        path = Path(result["notebook"])
        if not path.resolve().is_relative_to(self.data_root / "exports"):
            raise ValueError("The teaching file is outside the configured export root")
        book = load_small_json(path, BINDING_BYTES_LIMIT)
        if hashlib.sha256(path.read_bytes()).hexdigest() != result["notebook_sha256"]:
            raise ValueError("The prepared file has changed; open the edited file explicitly with neuroimage open")
        binding = content_binding(path)
        if binding["package_id"] + "-" + binding["package_version"] != result["atlas_key"]:
            raise ValueError("The prepared file no longer matches its exact source package")
        manifest = load_small_json(result["manifest"], BINDING_BYTES_LIMIT)
        identity = {"package_id": manifest["package_id"], "package_version": manifest["package_version"],
                    "build_signature": manifest["build"]["signature"], "space_id": manifest["space"]["id"]}
        if any(binding[key] != value for key, value in identity.items()):
            raise ValueError("The local atlas no longer matches the exact prepared teaching source")
        if self.register_package:
            self.register_package(Path(result["manifest"]))
        return {"atlas_key": result["atlas_key"], "content": book}

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
            ident, thread = self._active_id, self._thread
        if ident:
            try:
                self.cancel(ident)
            except ValueError:
                pass
        if thread:
            thread.join(timeout=12)
        if not thread or not thread.is_alive():
            self._lease.close()


def run_worker(path):
    request = load_small_json(path)
    action = request["action"]
    root = Path(request["data_root"])
    floor = request["minimum_free_gib"]
    if action == "acquire":
        from .acquire import acquire
        receipt = acquire(request["recipe"], root, minimum_free_gib=floor)
        result = {"receipt": str(root / "downloads" / request["recipe"] / "neuroimage-acquisition.json"),
                  "downloads": sum(f["status"] == "downloaded" for f in receipt["files"]),
                  "reused": sum(f["status"] == "reused" for f in receipt["files"] + receipt["expanded"]),
                  "extracted": sum(f["status"] == "extracted" for f in receipt["expanded"])}
    elif action == "build":
        from .build import build_atlas
        result = {"manifest": str(build_atlas(request["recipe"], root, workers=request["workers"], minimum_free_gib=floor))}
    elif action == "activate":
        result = {"manifest": request["manifest"]}
    elif action == "prepare":
        from .teaching import prepare
        result = {**prepare(request["manifest"], curriculum_path(request["curriculum"]), root, minimum_free_gib=floor),
                  "manifest": request["manifest"]}
    elif action == "prepare-course":
        from .course_plans import plan_path, prepare_course
        result = prepare_course(plan_path(request["course_plan"]), request["package_keys"], root,
                                minimum_free_gib=floor, progress=lambda event: print(json.dumps(event), flush=True))
        result["open_url"] = "/?course=" + result["course_id"]
    else:
        raise ValueError("Unknown workspace operation")
    print(json.dumps({"event": "workspace-result", "result": result}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run one validated local workspace operation")
    parser.add_argument("--request", required=True, type=Path)
    arguments = parser.parse_args()
    try:
        run_worker(arguments.request)
    except BaseException as error:
        traceback.print_exc()
        print(json.dumps({"event": "workspace-failure", "message": str(error) or "Operation interrupted"}), flush=True)
        raise SystemExit(130 if isinstance(error, KeyboardInterrupt) else 1) from error
