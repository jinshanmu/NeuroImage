# Installation and reproduction

This guide applies to NeuroImage Atlas **1.0.0**, prepared for author review. Use the supplied software artifacts. The [Linux quickstart](linux-quickstart.md) is the recommended installation route; the commands below explain the same components for development and reproduction.

## Runtime and dependencies

Linux x86_64, Python 3.12 and Chromium with WebGL2 are the verified platform. Command-line acquisition and construction run without a display; viewing needs WebGL2. Keep the `NeuroImage` environment, software checkout, dependencies, temporary files and build outputs on SSD. Keep original anatomy, local atlases and teaching exports on the selected data drive.

| Component | Role | Recorded version |
| --- | --- | --- |
| Conda and Python | Dedicated application environment | Python 3.12; `environment.yml` bootstrap |
| Python runtime libraries | Acquisition, construction, validation, local service | `requirements-core.lock.txt` |
| WebGL2 browser | Interactive source sections and 3D anatomy | Browser and renderer in release verification |
| Node and npm | Frontend builds and tests | Node 24.21.0; `.nvmrc` and `package-lock.json` |
| Python build and test tools | Source packaging and tests | `requirements-dev.lock.txt` |
| h5py | Original inner-ear HDF5 CT construction | `requirements-source-inspection.lock.txt` |
| Blender | Original Z-Anatomy object construction | Separate Blender 5.2.2 LTS application and embedded Python |
| Matplotlib | Optional native projection exports | `requirements-teaching.lock.txt` |
| aria2, dcm2niix and git-annex | Optional acquisition/source inspection helpers | `environment.yml`; selected source guide |

The Conda YAML bootstraps an environment. Pinned Python requirements and the npm lock record the application stack used for release verification. Package metadata also states supported dependency ranges. Application-specific runtimes such as Blender remain separately recorded. `neuroimage doctor` checks the installed application's full dependency closure, local viewer and optional selected-source requirements.

## Installation paths

From a physical SSD directory containing the source archive:

```bash
bash install.sh --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state --recipe cerebra
```

Add `--wheel /path/to/neuroimage_atlas-1.0.0-py3-none-any.whl` to use the prebuilt viewer. Add `--install-only` to install software alone, or `--no-start` to finish acquisition and construction without starting the service. The installer creates the named environment when needed and uses the portable storage reserves. See [Linux quickstart](linux-quickstart.md) for every option, manual acquisition and capacity checks.

For a manual developer installation into an existing `NeuroImage` environment:

```bash
conda activate NeuroImage
python -m pip install -r requirements-core.lock.txt -r requirements-dev.lock.txt \
  -r requirements-source-inspection.lock.txt
npm ci --ignore-scripts --bin-links=false
npm run build
python -m pip install --no-deps --no-build-isolation .
neuroimage doctor
```

Use the Node version in `.nvmrc`. The package scripts call the local tools directly, so npm command links are unnecessary. Source builds bundle the offline viewer and third-party notices. A wheel installation needs Python dependencies and the supplied wheel; Node is a build dependency.

## Acquire and construct

```bash
neuroimage recipes
neuroimage quickstart cerebra --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state \
  --storage-policy config/storage-portable.json --dry-run
neuroimage quickstart cerebra --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state \
  --storage-policy config/storage-portable.json --no-start
```

The recipe records source URLs, terms, versions, expected sizes and checksums. The same interfaces support every source. The [dataset table](dataset-installation.md) lists the 19 families and 39 configurations, source access and application dependencies. MIDA requires the original archive from its official manual access page. Repeating a command resumes transfers and reuses verified sources and completed construction outputs.

The installer explicitly uses `config/storage-portable.json`: 10 GiB data-drive reserve and 2 GiB software-drive reserve, plus the selected recipe's additional working-space estimate. The workstation development profile retains larger 400 GiB and 60 GiB reserves. Inspect capacity estimates and choose an appropriate explicit profile for your own drives.

## Software reproduction

From the recorded source snapshot with pinned dependencies:

```bash
python -m pytest
npm test
npm run build
python scripts/build_distribution.py --skip-web-build
```

`build_distribution.py` builds and audits a wheel and source archive in `dist/`. It normalizes archive ownership, permissions, ordering and timestamps using `SOURCE_DATE_EPOCH`. The default epoch is recorded in the build receipt. Rebuild an independently extracted archive with the same stack and epoch to compare artifacts. Tests create small analytic fixtures; acquired anatomy is unnecessary for the code suite.

The public source audit checks repository boundaries and the distribution audit checks archive members and bundled viewer notices. The release candidate has an additional source-tree audit for machine-specific paths, unexpected binaries, credentials and symbolic links. Release verification records the actual commands and platform. Other operating systems need their own validation before being listed as supported.

## Source and teaching reproduction

Data reproduction uses the exact original inputs, license evidence, recipe, implementation and construction options recorded in each local manifest. Preserve historical atlas packages referenced by saved teaching views. `neuroimage locate EXPORTED_SCENE --data-root DATA_ROOT` resolves the exact required local package. A source update may create another package identity; previously saved views remain attached to their original source.

The 1.0.0 teaching format keeps source and processing metadata in every scene. Repeated full recipe text is referenced at `manifest.json#/build/recipe` in the exact source package. Full provenance accompanies exported teaching images. Historical scenes containing an embedded recipe remain readable. Study records are portable JSON with source identity, stable lesson/structure IDs, written responses and self-rated review status.

## Recovery

| Symptom | Action |
| --- | --- |
| `neuroimage` is unavailable | Activate `NeuroImage`; inspect `python -m pip show neuroimage-atlas` |
| No local source appears | Select the correct data root or acquire and build a recipe |
| Capacity check refuses an operation | Inspect the recipe estimate and explicit storage policy, then free enough space |
| Source checksum differs | Preserve the original file and inspect its published version |
| Source application is missing | Install the documented Blender or HDF5 dependency for that construction path |
| A publisher cannot be reached | Retry the same command; retain partial files; consult the official source page |
| Port 8765 is occupied | Choose `--port 8766` and use its printed URL |
| WebGL rendering fails | Check WebGL2 support and record the browser, renderer, source and error |
| Saved teaching content needs an older source | Restore its exact historical package and use `neuroimage locate` |

Browser saves are specific to the profile and service origin, including the port. Export scenes, notebooks, courses and study records for durable recovery. Removing the software leaves original data and local teaching exports intact.
