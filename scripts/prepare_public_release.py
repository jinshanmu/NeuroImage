"""Prepare a reviewable code-only GitHub snapshot without publishing anything."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tomllib
import zipfile

from build_distribution import audit_archive

ROOT = Path(__file__).resolve().parents[1]
PRIVATE_PATH = re.compile(r"/home/(?!runner/)[A-Za-z][^/\s]+/|/media/(?!data/)[A-Za-z][^/\s]+/|[A-Za-z]:\\\\Users\\\\")
TOKEN = re.compile(r"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)")
TEXT_SUFFIXES = {".py", ".json", ".md", ".txt", ".ts", ".tsx", ".js", ".mjs", ".css", ".svg", ".html", ".toml", ".yml", ".yaml", ".cff", ".cfg", ".in"}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def audit_public_tree(folder):
    records, problems = [], []
    for path in sorted(folder.rglob("*")):
        if ".git" in path.relative_to(folder).parts:
            continue
        if path.is_symlink():
            problems.append({"file": path.relative_to(folder).as_posix(), "reason": "symbolic link"})
            continue
        if not path.is_file():
            continue
        relative = path.relative_to(folder).as_posix()
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeError:
            problems.append({"file": relative, "reason": "unexpected binary content"})
            continue
        if PRIVATE_PATH.search(content):
            problems.append({"file": relative, "reason": "machine-specific path"})
        if TOKEN.search(content):
            problems.append({"file": relative, "reason": "possible credential"})
        records.append({"file": relative, "bytes": path.stat().st_size, "sha256": digest(path)})
    if problems:
        raise ValueError(json.dumps({"public_tree_rejected": problems}, indent=2))
    return records


def prepare(destination):
    version = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]
    destination = destination.resolve()
    if destination.exists():
        raise ValueError("Choose a new candidate directory; existing review material is preserved")
    archive = ROOT / "dist" / f"neuroimage_atlas-{version}.tar.gz"
    audit_archive(archive)
    destination.mkdir(parents=True)
    temporary = destination / "unpacked"
    temporary.mkdir()
    with tarfile.open(archive) as source:
        source.extractall(temporary, filter="data")
    extracted = next(temporary.iterdir())
    snapshot = destination / "github"
    extracted.rename(snapshot)
    temporary.rmdir()
    # Build products and generated packaging metadata are rebuilt from source.
    shutil.rmtree(snapshot / "src/neuroimage/web")
    for metadata in (snapshot / "src").glob("*.egg-info"):
        shutil.rmtree(metadata)
    for metadata in snapshot.glob("PKG-INFO"):
        metadata.unlink()
    shutil.copy2(ROOT / ".gitignore", snapshot / ".gitignore")
    records = audit_public_tree(snapshot)
    artifacts = destination / "artifacts"
    artifacts.mkdir()
    distributions = []
    for path in sorted((ROOT / "dist").glob(f"neuroimage_atlas-{version}*")):
        if path.name.endswith((".whl", ".tar.gz")):
            distributions.append(audit_archive(path))
            shutil.copy2(path, artifacts / path.name)
    manifest = {
        "version": version, "status": "prepared_for_author_review_not_published",
        "prepared_on": datetime.now(timezone.utc).date().isoformat(), "public_remote_configured": False,
        "development_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "github_history": "New source snapshot; development history and local acquisition records are not included",
        "data_policy": "No acquired imaging, label arrays, meshes, streamlines or anatomical derivatives",
        "files": records, "distributions": distributions,
    }
    (destination / "RELEASE_MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    zip_path = artifacts / f"neuroimage-atlas-{version}-github.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as target:
        for record in records:
            target.write(snapshot / record["file"], "neuroimage-atlas/" + record["file"])
    (destination / "SHA256SUMS.txt").write_text("".join(f"{digest(path)}  artifacts/{path.name}\n" for path in sorted(artifacts.iterdir())))
    print(json.dumps({"version": version, "files": len(records), "github_archive_sha256": digest(zip_path),
                      "distributions": distributions, "published": False}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.destination)
