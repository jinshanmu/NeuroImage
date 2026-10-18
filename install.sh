#!/usr/bin/env bash
# Install exclusively in the dedicated NeuroImage Conda environment.
set -euo pipefail
ATLAS_PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'USAGE'
NeuroImage Atlas Linux installer

bash install.sh --data-root /path/to/data --state-root /path/to/ssd/state [options]
bash install.sh --install-only [--wheel /path/to/neuroimage_atlas-VERSION-py3-none-any.whl]

Options:
  --recipe NAME          Source to acquire and build (default: cerebra)
  --storage-policy FILE  Reviewed JSON storage policy (default: config/storage-policy.json)
  --workers N            Construction workers, 1 to 8 (default: 2)
  --port N               Local browser port (default: 8765)
  --no-start             Finish installation and construction without starting the viewer
  --no-browser           Print the local URL without opening a browser
  --install-only         Install software and check dependencies; acquire no anatomy
  --wheel FILE           Install a supplied wheel; Node is unnecessary
  --node DIR             Existing Node installation root (otherwise obtain the pinned runtime)

Prerequisites: Linux x86_64 and Conda (https://conda-forge.org/download/).
Keep this checkout and the NeuroImage environment on SSD. Data directories are
created only at the explicit paths you supply. Source licenses remain individual.
Existing source files and completed construction checkpoints are reused.
USAGE
  exit 0
fi
if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "This installer is verified for Linux x86_64." >&2
  exit 1
fi
ATLAS_CONDA_EXE="${CONDA_EXE:-$(command -v conda || true)}"
if [[ -z "$ATLAS_CONDA_EXE" || ! -x "$ATLAS_CONDA_EXE" ]]; then
  echo "Install Conda on SSD from https://conda-forge.org/download/, then repeat this command." >&2
  exit 1
fi
if ! "$ATLAS_CONDA_EXE" list --name NeuroImage --json >/dev/null 2>&1; then
  "$ATLAS_CONDA_EXE" create --name NeuroImage --override-channels --channel conda-forge python=3.12 pip --yes
fi
exec "$ATLAS_CONDA_EXE" run --no-capture-output --name NeuroImage python "$ATLAS_PROJECT_DIR/scripts/install_linux.py" "$@"
