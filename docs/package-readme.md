# NeuroImage Atlas

The formal 1.0.0 release provides anatomy browsing and same-category source comparison. The current collection retains 12 source families and enables at most ten independent cases in each family. Teaching libraries, courses and learning tools are retained in `codex/release-testing`.

The current THU selection is 001, 006, 007, 009, 010, 014, 015, 019, 021 and 030. The current MUG500+ selection is A0031–A0035 and A0101–A0105. A skull's label volume, source mesh and package revisions count as one case. The single inclusion list is `src/neuroimage/catalogs/case-selection.json`; other cohort definitions and historical validation records are retained as source evidence, but unselected cases cannot be acquired, built or opened.

The complete 109-case THU inventory and its historical verification are archive evidence. Only the ten selected cases are currently included. Their original inputs and exact package bindings are retained and complete, so current browsing and rebuilding do not require the full-cohort ZIPs. Those mixed-cohort downloads were removed during case-limit cleanup; their original archive names, hashes and acquisition definitions remain recorded as source provenance.

NeuroImage Atlas 1.0.0 is a local browser application for normal intracranial anatomy and normal anatomical variation. Command-line tools prepare original images, labels, probability fields, trajectories and source models as local atlas packages. The webpage opens those packages for anatomy browsing. Source definitions and coordinate systems remain attached to each dataset.

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

The release is prepared locally for author review. Use the supplied artifacts. Node 24.21.0 is required only for source frontend builds and is obtained by the installer when needed. Blender is a separately installed application used for constructing Z-Anatomy. Optional source-inspection dependencies do not enable excluded datasets. Source-specific access instructions, including MIDA's manual acquisition, are in `docs/dataset-installation.md`.

## Use and reproduce

After installation, activate the environment and restart with:

```bash
conda activate NeuroImage
neuroimage workspace --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state
```

Open the printed local address. Choose a source from **Browse anatomy**. Use **Structure library**, the 2D/3D controls and **Compare sources** to explore its anatomy. Choose a dataset on the home page for its source introduction, coverage and license references. Source preparation uses the CLI. `neuroimage doctor` checks the application dependency closure and viewer; `neuroimage quickstart` combines acquisition, construction and launch. Interrupted commands reuse verified originals and completed outputs.

`docs/linux-quickstart.md` gives the complete installation flow. `docs/installation-and-reproduction.md` describes dependency roles, builds and recovery. `docs/learning-and-variation.md` describes anatomy and normal-variation browsing. Keep original sources and local atlases on the data drive, and software, environments and build workspaces on SSD.

## Software, data and attribution

The software is Apache-2.0. Software archives contain code, schemas, recipes and English documentation. Users acquire anatomical datasets separately under each source's terms. Local packages preserve original versions, licenses, citations, coordinates and construction parameters. Exported scenes refer to exact packages; exported images include provenance and attribution.

The service runs on loopback with local viewer assets. Viewer footer tools, browser scene saving/import/export and image export remain in `codex/release-testing` at commit `006221e`. Existing browser records and scene files are retained; the formal CLI still opens exact-source scene files. See the [preservation record](development/anatomy-release-simplification.md#viewer-footer-update-2026-10-24). See `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md`, `GOVERNANCE.md` and `CITATION.cff` for privacy, reporting, contributions, maintenance and citation.
