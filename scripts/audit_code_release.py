"""Reject acquired imaging and anatomical data from the tracked software tree."""
from pathlib import Path
import argparse
import json
import subprocess

ROOT = Path(__file__).resolve().parents[1]
DATA_SUFFIXES = ('.nii', '.nii.gz', '.nrrd', '.nhdr', '.mnc', '.mnc.gz', '.mha', '.mhd',
                 '.dcm', '.ima', '.stl', '.obj', '.ply', '.vtk', '.vtp', '.vtu', '.blend',
                 '.glb', '.gltf', '.gii', '.gii.gz', '.trk', '.trk.gz', '.tck', '.tt.gz', '.fib.gz', '.fz', '.raw', '.mat',
                 '.zip', '.tar', '.tar.gz', '.tgz', '.tif', '.tiff')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--include-untracked', action='store_true')
    args = parser.parse_args()
    policy = json.loads((ROOT / 'config/release-policy.json').read_text())
    command = ['git', 'ls-files', '-z']
    paths = subprocess.check_output(command, cwd=ROOT).decode().split('\0')
    if args.include_untracked:
        paths += subprocess.check_output(command + ['--others', '--exclude-standard'], cwd=ROOT).decode().split('\0')
    violations = []
    for name in sorted(set(paths) - {''}):
        relative = Path(name)
        path = ROOT / relative
        if (set(relative.parts) & set(policy['exclude_directories']) or name in policy['exclude_files']
                or name.lower().endswith(DATA_SUFFIXES) or path.is_symlink()):
            violations.append(name)
    print(json.dumps(dict(status='failed' if violations else 'passed',
                         files_checked=len(set(paths) - {''}), violations=violations,
                         scope='Tracked-file packaging boundary; file-type review remains required for new assets'), indent=2))
    if violations:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
