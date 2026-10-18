# NeuroImage Atlas

NeuroImage Atlas 1.0.0 is a local browser application for learning and teaching normal intracranial anatomy and normal anatomical variation. It brings original images, labels, probability fields, trajectories and educational models into a common acquisition, construction, viewing and teaching workflow. Source definitions and coordinate systems remain attached to each dataset.

## Explore and teach

Browse ten anatomical groups and 46 detailed topics. Use linked source sections and 3D views, inspect original labels, compare sources in their own spaces, and save exact views. The teaching tools provide guided identification, written responses, a review queue, portable study records, notebooks and multi-source courses. Teachers can capture prompts, annotations and camera states, then present or export their lessons.

The release supplies 39 source configurations across 19 families, 193 built-in teaching sequences, 90 prepared-view curricula with 796 views, and 31 course plans selecting 684 views. The configured collection contains 1,965 source-specific entries. The added 1.0.0 content includes 64 cortical and dural model objects and 32 regional arterial comparison views across eight healthy-volunteer MRA cases. Entries from different sources can overlap; the counts describe content rather than unique anatomical structures.

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

Open the printed local address. Choose a source from **Browse anatomy**, or open **Teaching library** and prepare **First session: cortex, deep structures and ventricles**. **Data tools** uses the same recipes as the command line. `neuroimage doctor` checks the application dependency closure and viewer; `neuroimage quickstart` combines acquisition, construction and launch. Interrupted commands reuse verified originals and completed outputs.

`docs/linux-quickstart.md` gives the complete installation flow. `docs/installation-and-reproduction.md` describes dependency roles, builds and recovery. `docs/learning-and-variation.md` describes the new teaching content and study records. Keep original sources and local atlases on the data drive, and software, environments and build workspaces on SSD.

## Software, data and attribution

The software is Apache-2.0. Software archives contain code, schemas, recipes and English documentation. Users acquire anatomical datasets separately under each source's terms. Local packages preserve original versions, licenses, citations, coordinates and construction parameters. Exported scenes refer to exact packages; exported teaching images include provenance and attribution.

The service runs on loopback with local viewer assets. Browser saves belong to the browser profile and local address. Export teaching files and study records for backup. See `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md`, `GOVERNANCE.md` and `CITATION.cff` for privacy, reporting, contributions, maintenance and citation.
