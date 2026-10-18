"""Build and inspect code-only wheel/source archives using the project environment."""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tomllib
import zipfile
from audit_code_release import DATA_SUFFIXES

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {"data", "downloads", "raw", "derivatives", "benchmarks", "cache", "exports", "tools", "node_modules", ".internal", "__pycache__"}


def normalize_archive(path, epoch):
    """Remove host umask, ownership and wall-clock differences from build archives."""
    temporary = path.with_name(path.name + ".normalizing")
    if path.suffix == ".whl":
        stamp = datetime.fromtimestamp(max(epoch, 315532800), timezone.utc).timetuple()[:6]
        with zipfile.ZipFile(path) as source, zipfile.ZipFile(temporary, "w") as target:
            for name in sorted(source.namelist()):
                info = zipfile.ZipInfo(name, date_time=stamp)
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                target.writestr(info, source.read(name), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    else:
        with tarfile.open(path, "r:gz") as source, temporary.open("wb") as raw:
            with gzip.GzipFile(fileobj=raw, filename="", mode="wb", mtime=epoch, compresslevel=9) as compressed:
                with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as target:
                    for member in sorted(source.getmembers(), key=lambda item: item.name):
                        member.uid = member.gid = 0
                        member.uname = member.gname = ""
                        member.mtime = epoch
                        member.mode = 0o755 if member.isdir() else 0o644
                        member.pax_headers = {}
                        target.addfile(member, source.extractfile(member) if member.isfile() else None)
    os.replace(temporary, path)


def audit_archive(path):
    if path.suffix == ".whl":
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
    else:
        with tarfile.open(path, "r:gz") as archive:
            if any(member.issym() or member.islnk() for member in archive.getmembers()):
                raise ValueError("Software source archive must not contain symbolic or hard links")
            names = archive.getnames()
    forbidden = [name for name in names if set(Path(name).parts) & EXCLUDED or name.lower().endswith(DATA_SUFFIXES)]
    if forbidden:
        raise ValueError(f"Acquired data or excluded build files found in {path.name}: {forbidden}")
    if not any(name.endswith("neuroimage/web/index.html") for name in names):
        raise ValueError("The software archive is missing the offline viewer")
    if not any(name.endswith("third-party-notices.txt") for name in names):
        raise ValueError("The software archive is missing frontend license notices")
    with path.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"file": path.name, "bytes": path.stat().st_size, "sha256": checksum, "members": len(names), "acquired_data_files": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-web-build", action="store_true", help="Reuse already built and reviewed frontend files")
    args = parser.parse_args()
    if Path(sys.prefix).name != "NeuroImage":
        raise SystemExit("Activate the dedicated NeuroImage environment before building")
    if not args.skip_web_build:
        subprocess.run(["npm", "run", "build"], cwd=ROOT, check=True)
    if (ROOT / ".git").exists():
        subprocess.run([sys.executable, "scripts/audit_code_release.py", "--include-untracked"], cwd=ROOT, check=True)
    folder = ROOT / "dist"; folder.mkdir(exist_ok=True)
    version = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    # Setuptools otherwise retains obsolete hashed viewer assets across builds.
    # This directory contains only reproducible package staging files.
    staging = ROOT / "build" / "lib" / "neuroimage"
    if staging.is_symlink():
        raise ValueError("Package staging must not be a symbolic link")
    if staging.exists():
        shutil.rmtree(staging)
    env = dict(os.environ, PIP_DISABLE_PIP_VERSION_CHECK="1", PYTHONNOUSERSITE="1", PYTHONPATH="")
    # A fixed epoch makes wheel timestamps reproducible without requiring Git
    # in an independently unpacked source distribution.
    env.setdefault("SOURCE_DATE_EPOCH", "1791676800")
    subprocess.run([sys.executable, "-m", "pip", "wheel", "--no-deps", "--no-build-isolation", "--no-index", ".", "--wheel-dir", str(folder)], cwd=ROOT, env=env, check=True)
    subprocess.run([sys.executable, "-c", "import setuptools.build_meta as backend; backend.build_sdist('dist')"], cwd=ROOT, env=env, check=True)
    records = []
    for path in sorted(folder.glob(f"neuroimage_atlas-{version}*")):
        if path.name.endswith((".whl", ".tar.gz")):
            audit_archive(path)
            normalize_archive(path, int(env["SOURCE_DATE_EPOCH"]))
            records.append(audit_archive(path))
    result = {"status": "passed", "software_license": "Apache-2.0", "source_date_epoch": int(env["SOURCE_DATE_EPOCH"]), "data_policy": "No acquired imaging, labels, meshes or other data derivatives", "artifacts": records}
    (folder / "software-build.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
