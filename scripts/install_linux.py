"""One-command, resumable Linux installation in the NeuroImage environment."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
NODE_VERSION = "24.21.0"
NODE_SHA256 = "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6"


def run(command, *, env=None):
    print("Running:", " ".join(str(part) for part in command), flush=True)
    subprocess.run([str(part) for part in command], cwd=ROOT, env=env, check=True)


def pinned_node(selected=None):
    if selected:
        directory = selected.expanduser().resolve()
        binary = directory / "bin/node"
        if not binary.is_file() or subprocess.check_output([binary, "--version"], text=True).strip() != "v" + NODE_VERSION:
            raise ValueError(f"The selected directory must contain Node {NODE_VERSION}")
        return directory
    current = shutil.which("node")
    if current and subprocess.check_output([current, "--version"], text=True).strip() == "v" + NODE_VERSION:
        directory = Path(current).resolve().parent.parent
        if (directory / "lib/node_modules/npm/bin/npm-cli.js").is_file():
            return directory
    target = ROOT / "tools" / f"node-v{NODE_VERSION}-linux-x64"
    if (target / "bin/node").is_file():
        return pinned_node(target)
    target.parent.mkdir(exist_ok=True)
    if target.parent.is_symlink() or shutil.disk_usage(ROOT).free < 2 * 1024**3:
        raise ValueError("Use a physical SSD checkout with at least 2 GiB free for the frontend toolchain")
    archive = target.parent / (target.name + ".tar.xz")
    if archive.is_symlink():
        raise ValueError("The Node archive must be a regular file")
    if not archive.is_file():
        partial = archive.with_suffix(archive.suffix + ".partial")
        if partial.is_symlink():
            raise ValueError("The Node download path must be a regular file")
        with urlopen(f"https://nodejs.org/dist/v{NODE_VERSION}/{archive.name}", timeout=60) as response, partial.open("wb") as output:
            total = 0
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > 150 * 1024**2:
                    raise ValueError("The Node archive exceeds its download limit")
                output.write(chunk)
        partial.replace(archive)
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != NODE_SHA256:
        raise ValueError("The Node archive does not match the pinned official checksum; retained for inspection")
    # The npm CLI is invoked directly. Its optional shell links are unnecessary.
    with tarfile.open(archive, "r:xz") as bundle:
        for member in bundle:
            path = target.parent / member.name
            if not path.resolve().is_relative_to(target) or member.isdev():
                raise ValueError("Unexpected Node archive path")
            if member.issym() or member.islnk():
                continue
            bundle.extract(member, target.parent, filter="data")
    return pinned_node(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path)
    parser.add_argument("--state-root", type=Path)
    parser.add_argument("--recipe", default="cerebra")
    parser.add_argument("--storage-policy", type=Path, default=ROOT / "config/storage-portable.json")
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=2)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-start", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--install-only", action="store_true")
    parser.add_argument("--wheel", type=Path)
    parser.add_argument("--node", type=Path)
    args = parser.parse_args()
    if Path(sys.prefix).name != "NeuroImage" or sys.version_info[:2] != (3, 12):
        raise ValueError("Use Python 3.12 in the dedicated NeuroImage Conda environment")
    if sys.platform != "linux" or platform.machine() != "x86_64":
        raise ValueError("The verified installer targets Linux x86_64")
    if not args.install_only and (args.data_root is None or args.state_root is None):
        parser.error("Supply --data-root and --state-root, or choose --install-only")
    if not 1 <= args.port <= 65535:
        parser.error("Choose a port from 1 to 65535")
    if not args.storage_policy.is_file():
        raise ValueError("The storage policy file does not exist")
    policy = json.loads(args.storage_policy.read_text())
    for name, default in (("ssd_minimum_free_gib", 60), ("hdd_minimum_free_gib", 400)):
        value = policy.get(name, default)
        if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or value < 0:
            raise ValueError(f"{name} must be a finite, nonnegative number")
        policy[name] = value
    for directory in (ROOT, Path(sys.prefix)):
        free = shutil.disk_usage(directory).free / 1024**3
        if free < policy["ssd_minimum_free_gib"] + 4:
            raise ValueError(f"Software installation needs 4 GiB plus the {policy['ssd_minimum_free_gib']:g} GiB reserve; {free:.1f} GiB free")
    if args.wheel and (not args.wheel.is_file() or not args.wheel.name.startswith("neuroimage_atlas-") or args.wheel.suffix != ".whl"):
        raise ValueError("Select the supplied NeuroImage Atlas wheel")
    if args.data_root and args.state_root:
        data, state = args.data_root.expanduser().absolute(), args.state_root.expanduser().absolute()
        if data.resolve().is_relative_to(state.resolve()) or state.resolve().is_relative_to(data.resolve()):
            raise ValueError("Data and SSD state directories must be separate and non-nested")
        if data.resolve() != data or state.resolve() != state:
            raise ValueError("Use physical directories without symbolic-link paths")
        data.mkdir(parents=True, exist_ok=True)
        state.mkdir(parents=True, exist_ok=True)
        args.data_root, args.state_root = data, state
    env = dict(os.environ, PYTHONNOUSERSITE="1", PYTHONPATH="", PIP_DISABLE_PIP_VERSION_CHECK="1")
    # Dependency installation remains in the interpreter that passed the guard.
    locks = ["requirements-core.lock.txt", "requirements-source-inspection.lock.txt"]
    if not args.wheel:
        locks.append("requirements-dev.lock.txt")
    run([sys.executable, "-m", "pip", "install", *[part for lock in locks for part in ("-r", ROOT / lock)]], env=env)
    if args.wheel:
        run([sys.executable, "-m", "pip", "install", "--no-deps", "--force-reinstall", args.wheel.expanduser().resolve()], env=env)
    else:
        node = pinned_node(args.node)
        env["PATH"] = str(node / "bin") + os.pathsep + env.get("PATH", "")
        run([node / "bin/node", node / "lib/node_modules/npm/bin/npm-cli.js", "ci", "--ignore-scripts", "--bin-links=false", "--no-audit", "--no-fund"], env=env)
        run([node / "bin/node", ROOT / "scripts/third_party_notices.mjs"], env=env)
        run([node / "bin/node", ROOT / "node_modules/typescript/bin/tsc", "--noEmit"], env=env)
        run([node / "bin/node", ROOT / "node_modules/vite/bin/vite.js", "build"], env=env)
        run([sys.executable, "-m", "pip", "install", "--no-deps", "--no-build-isolation", "."], env=env)
    # Check the application's full dependency closure. Unrelated packages in an
    # existing research environment do not determine this application's status.
    run([sys.executable, "-m", "neuroimage.cli", "doctor"], env=env)
    if args.install_only:
        print("Installation complete. Activate NeuroImage and run neuroimage quickstart to build a source.")
        return
    command = [sys.executable, "-m", "neuroimage.cli", "quickstart", args.recipe,
               "--data-root", args.data_root, "--state-root", args.state_root,
               "--storage-policy", args.storage_policy.resolve(), "--workers", args.workers, "--port", args.port]
    if args.no_start:
        command.append("--no-start")
    if args.no_browser:
        command.append("--no-browser")
    run(command, env=env)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Installation stopped: {error}. Existing source files remain available for a repeated run.") from error
