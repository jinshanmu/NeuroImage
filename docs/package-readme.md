# NeuroImage Atlas

The formal 1.0.0 release provides anatomy browsing, independent source comparison, scene saving and image export. All 39 source configurations remain available. Teaching libraries, courses and learning tools are retained in `codex/release-testing`.

NeuroImage Atlas 1.0.0 is a local browser application for normal intracranial anatomy and normal anatomical variation. It brings original images, labels, probability fields, trajectories and source models into a common acquisition, construction and browsing workflow. Source definitions and coordinate systems remain attached to each dataset.

## Linux installation

Linux x86_64, Conda and a WebGL2 browser are required. Extract the supplied source archive on SSD, then run:

```bash
bash install.sh --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state --recipe cerebra
```

The installer uses the dedicated `NeuroImage` Python 3.12 environment, installs pinned dependencies, builds the viewer, acquires and constructs the chosen atlas, validates it, and opens the workspace. A supplied wheel skips the frontend build:

```bash
bash install.sh --wheel /path/to/neuroimage_atlas-1.0.0-py3-none-any.whl \
  --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state --recipe cerebra
```

The release is prepared locally for author review. Use the supplied artifacts. Node 24.21.0 is required only for source frontend builds and is obtained by the installer when needed. Blender is a separately installed application used for constructing Z-Anatomy; original inner-ear CT uses the pinned HDF5 dependency. Source-specific access instructions, including MIDA's manual acquisition, are in `docs/dataset-installation.md`.

## Use and reproduce

After installation, activate the environment and restart with:

```bash
conda activate NeuroImage
neuroimage workspace --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state
```

Open the printed local address. Choose a source from **Browse anatomy**. Use **Structure library**, the 2D/3D controls and **Compare sources** to explore its anatomy. **Data tools** uses the same recipes as the command line. `neuroimage doctor` checks the application dependency closure and viewer; `neuroimage quickstart` combines acquisition, construction and launch. Interrupted commands reuse verified originals and completed outputs.

`docs/linux-quickstart.md` gives the complete installation flow. `docs/installation-and-reproduction.md` describes dependency roles, builds and recovery. `docs/learning-and-variation.md` describes anatomy and normal-variation browsing. Keep original sources and local atlases on the data drive, and software, environments and build workspaces on SSD.

## Software, data and attribution

The software is Apache-2.0. Software archives contain code, schemas, recipes and English documentation. Users acquire anatomical datasets separately under each source's terms. Local packages preserve original versions, licenses, citations, coordinates and construction parameters. Exported scenes refer to exact packages; exported images include provenance and attribution.

The service runs on loopback with local viewer assets. Browser saves belong to the browser profile and local address. Export scenes for backup. See `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md`, `GOVERNANCE.md` and `CITATION.cff` for privacy, reporting, contributions, maintenance and citation.
