"""Inspect a Linux installation and complete a resumable source-to-viewer setup."""
from importlib import metadata, util
import json
import math
from pathlib import Path
import platform
import shutil
import sys
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

from . import __version__
from .acquire import acquisition_plan, acquire, destination
from .adapters import load_recipe
from .build import build_atlas


def storage_settings(path=None):
    policy = json.loads(Path(path).read_text()) if path else {}
    for key, default in (("hdd_minimum_free_gib", 400), ("ssd_minimum_free_gib", 60)):
        value = policy.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            raise ValueError(f"{key} must be a finite, nonnegative number")
        policy[key] = value
    return policy


def manual_requirements(recipe_name, data_root):
    """Describe source files that require the publisher's own access workflow."""
    root = Path(data_root).resolve()
    recipe = load_recipe(recipe_name)
    required = []
    for spec in recipe["archives"]:
        if spec.get("url"):
            continue
        archive = destination(root, f"downloads/{spec['dataset_id']}/{spec['filename']}")
        members_ready = bool(spec["members"]) and all(
            destination(root, m["target"]).is_file() and destination(root, m["target"]).stat().st_size == m["bytes"]
            for m in spec["members"])
        if not archive.is_file() and not members_ready:
            required.append({"access_url": spec["access_url"], "save_as": str(archive),
                             "bytes": spec["bytes"], "sha256": spec["sha256"]})
    return required


def installation_report(*, data_root=None, state_root=None, recipe=None, storage_policy=None):
    checks = []

    def check(name, passed, detail, *, required=True):
        checks.append({"name": name, "status": "passed" if passed else "failed" if required else "optional",
                       "detail": detail})

    check("platform", sys.platform.startswith("linux") and platform.machine() == "x86_64",
          f"{platform.system()} {platform.machine()}; release verification targets Linux x86_64")
    check("environment", Path(sys.prefix).name == "NeuroImage", "Use the dedicated NeuroImage Conda environment")
    check("python", sys.version_info[:2] == (3, 12), platform.python_version())
    web = Path(__file__).with_name("web") / "index.html"
    check("offline_viewer", web.is_file(), "Built browser assets are present" if web.is_file() else "Run the Linux installer or install the wheel")
    dependencies = {}
    pending = ["neuroimage-atlas", "numpy", "scipy", "nibabel", "pynrrd", "scikit-image", "pydantic", "pillow", "SimpleITK"]
    while pending:
        name = pending.pop()
        canonical = canonicalize_name(name)
        if canonical in dependencies:
            continue
        try:
            installed = metadata.distribution(name)
            dependencies[canonical] = installed.version
            for item in installed.requires or []:
                requirement = Requirement(item)
                if requirement.marker and not requirement.marker.evaluate({"extra": ""}):
                    continue
                version = metadata.version(requirement.name)
                check(f"dependency:{name}/{requirement.name}", version in requirement.specifier,
                      f"{requirement.name} {version}; required {requirement.specifier or 'any version'}")
                pending.append(requirement.name)
        except metadata.PackageNotFoundError:
            check(name, False, "Install requirements-core.lock.txt in NeuroImage")
    policy = storage_settings(storage_policy)
    for label, directory, floor in (("data", data_root, policy["hdd_minimum_free_gib"]),
                                     ("state", state_root, policy["ssd_minimum_free_gib"])):
        if directory is None:
            continue
        path = Path(directory).expanduser().absolute()
        existing = path
        while not existing.exists() and existing.parent != existing:
            existing = existing.parent
        free = shutil.disk_usage(existing).free / 2**30
        check(label + "_storage", free >= floor, f"{free:.1f} GiB free; reserve {floor:g} GiB; {path}")
        check(label + "_directory", path.is_dir() and not path.is_symlink(),
              "Existing physical directory" if path.is_dir() else "Create this directory on the intended drive before quickstart")
    if data_root and state_root:
        data, state = Path(data_root).resolve(), Path(state_root).resolve()
        check("separate_storage", not data.is_relative_to(state) and not state.is_relative_to(data),
              "Data and workspace state must use separate, non-nested directories")
    if recipe:
        source = load_recipe(recipe)
        if source.get("adapter") == "blender-source-surfaces":
            check("blender", bool(shutil.which("blender")),
                  f"Install the separate Blender application ({source['blender_version']}) and add it to PATH")
        if source.get("adapter") == "source-hdf5-ct-labels":
            check("hdf5", util.find_spec("h5py") is not None, "Install requirements-source-inspection.lock.txt for original HDF5 CT")
    return {"software": "NeuroImage Atlas", "version": __version__, "checks": checks,
            "dependencies": dependencies, "ready": all(c["status"] != "failed" for c in checks),
            "browser_check": "Open the local URL in a browser with WebGL2; rendering is checked in the browser"}


def quickstart(recipe, data_root, state_root, *, storage_policy=None, workers=2, dry_run=False):
    """Acquire, construct and validate one source with the shared interfaces."""
    data, state = Path(data_root).expanduser().absolute(), Path(state_root).expanduser().absolute()
    if not data.is_dir() or not state.is_dir():
        raise ValueError("Create the data and SSD state directories first; quickstart preserves existing files")
    if data.is_symlink() or state.is_symlink() or data.resolve().is_relative_to(state.resolve()) or state.resolve().is_relative_to(data.resolve()):
        raise ValueError("Choose separate physical data and SSD state directories")
    if not 1 <= workers <= 8:
        raise ValueError("Use 1 to 8 construction workers")
    policy = storage_settings(storage_policy)
    source = load_recipe(recipe)
    plan = acquisition_plan(recipe, data, minimum_free_gib=policy["hdd_minimum_free_gib"])
    manual = manual_requirements(recipe, data)
    summary = {"recipe": recipe, "title": source["title"], "sources": source["sources"],
               "acquisition": plan, "manual_downloads": manual,
               "construction_peak_gib": source.get("construction_peak_gib", 2)}
    print(json.dumps({"event": "quickstart-plan", **summary}), flush=True)
    if dry_run:
        return summary
    report = installation_report(data_root=data, state_root=state, recipe=recipe, storage_policy=storage_policy)
    if not report["ready"]:
        raise ValueError("Installation checks failed: " + "; ".join(c["detail"] for c in report["checks"] if c["status"] == "failed"))
    if manual:
        raise ValueError("Complete the manual source download shown above, then repeat this command. No transfer was started.")
    acquire(recipe, data, minimum_free_gib=policy["hdd_minimum_free_gib"])
    manifest = build_atlas(recipe, data, workers=workers, minimum_free_gib=policy["hdd_minimum_free_gib"])
    from .validation import validate_package
    validated = validate_package(manifest, cache_policy="reuse")
    result = {"status": "ready", "manifest": str(manifest), "dataset_id": validated.dataset_id,
              "package_version": validated.package_version, "structures": len(validated.structures)}
    print(json.dumps({"event": "quickstart-complete", **result}), flush=True)
    return result
