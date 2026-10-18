# Installation, first use and reproduction

This guide applies to NeuroImage Atlas **0.15.0rc2**. The release is prepared for author review and has not been published to a package index. Use the supplied wheel or source archive; do not assume that `pip install neuroimage-atlas` retrieves this candidate.

## Prerequisites and dependency roles

Linux x86_64, Python 3.12 and Chromium with WebGL2 were verified. Windows and macOS have not been accepted. A graphical WebGL2 browser is required for viewing; command-line construction can run without a display. No running 3D Slicer installation is required.

Install Conda before the commands below. Keep the named `NeuroImage` environment, source checkout, Node modules, temporary files and build outputs on SSD. Choose an existing data-drive directory for original downloads, images, local atlases and teaching exports. The software archive contains no anatomical data and no workstation `data` link.

| Dependency | When needed | Version source |
| --- | --- | --- |
| Python and Conda | All use | Python 3.12; `environment.yml` bootstraps the named environment |
| Python runtime libraries | Construction, validation and serving | All 17 packages pinned in `requirements-core.lock.txt` |
| WebGL2 browser | Interactive viewing | Verified Chromium; exact test platform is recorded in release evidence |
| Node and npm | Rebuilding the frontend; frontend tests | Node 24.21.0 in `.nvmrc`; `package-lock.json` consumed by `npm ci` |
| Python build and test tools | Source installation, distribution builds and tests | Six pins in `requirements-dev.lock.txt`, including setuptools, wheel and pytest |
| h5py | Constructing original inner-ear HDF5 CT | 3.16.0 in `requirements-source-inspection.lock.txt`; not needed to view an existing CT package |
| Blender application | Constructing Z-Anatomy from the original source model | Separate Blender 5.2.2 LTS executable on `PATH`; its embedded Python is not the project environment |
| Matplotlib and plotting dependencies | Optional native projection export | `requirements-teaching.lock.txt`; not needed for the ordinary viewer |
| aria2, dcm2niix and git-annex | Additional acquisition or source inspection workflows | Bootstrap helpers in `environment.yml`; see the selected source guide before use |

The environment YAML is a bootstrap specification, not an exact cross-platform Conda solver lock. Runtime/build pins and the npm lock define the accepted software stack; `RELEASE_VERIFICATION.json` records the actual tested Python and platform. The package metadata allows compatible dependency ranges for installation, but use the lock files when reproducing this candidate. Optional tools remain separately documented rather than silently assumed.

## Install the prebuilt wheel

Extract the supplied `.tar.gz` source archive on SSD and enter its extracted directory to access the environment file and locks. The wheel is supplied alongside it. Replace the example wheel path with its actual absolute location:

```bash
conda env create -f environment.yml
conda activate NeuroImage
python -m pip install -r requirements-core.lock.txt
python -m pip install --no-deps /path/to/neuroimage_atlas-0.15.0rc2-py3-none-any.whl
neuroimage --version
neuroimage recipes
```

If `NeuroImage` already exists, activate it and inspect its installed versions instead of recreating it. All project Python commands run inside this environment. The wheel already contains the offline frontend: Node, npm and a frontend build are unnecessary for ordinary use. Internet access is needed for initial dependencies and data acquisition; the built viewer uses local assets without a remote rendering service.

For original inner-ear CT construction, additionally run:

```bash
python -m pip install -r requirements-source-inspection.lock.txt
```

For Z-Anatomy construction, install the separately distributed Blender application and confirm `blender --version` reports the documented version. Viewing an already constructed Z-Anatomy package does not need Blender.

## Build from source instead

From the source root, after creating/activating `NeuroImage`:

```bash
python -m pip install -r requirements-core.lock.txt -r requirements-dev.lock.txt
nvm install
nvm use
npm ci
npm run build
python -m pip install --no-deps --no-build-isolation -e .
neuroimage --version
```

The `nvm` commands assume nvm is installed and loaded into the shell. Alternatively, install Node 24.21.0 separately, confirm `node --version`, and omit both nvm commands. `npm ci` uses the committed dependency lock; `npm run build` runs TypeScript checking and produces the local viewer. Do not edit generated `src/neuroimage/web` files directly.

## Acquire one source and open it

Create or select actual storage directories first, then replace these example paths. The data directory must be on the intended data drive; the state directory must be on SSD. No existing local symlink is required.

```bash
export ATLAS_DATA_ROOT="/path/to/existing/data-directory"
export ATLAS_STATE_ROOT="/path/to/ssd/state-directory"
neuroimage recipes cerebra
neuroimage acquire cerebra --data-root "$ATLAS_DATA_ROOT" --dry-run
neuroimage acquire cerebra --data-root "$ATLAS_DATA_ROOT"
neuroimage build cerebra --data-root "$ATLAS_DATA_ROOT" --workers 2
neuroimage library --data-root "$ATLAS_DATA_ROOT"
neuroimage workspace --data-root "$ATLAS_DATA_ROOT" --state-root "$ATLAS_STATE_ROOT" --port 8765
```

Read the source terms before acquisition. The dry run reports transfer and expansion requirements. The default data-drive free-space floor is 400 GiB, not the size of every dataset. If your storage needs a different policy, copy `config/storage-policy.json`, review its capacities, and pass that same file with `--storage-policy /path/to/policy.json` to acquisition, construction and workspace commands. Do not disable capacity checks to force a transfer that will not fit.

Construction prints the exact resulting `manifest.json` path. Run `neuroimage validate /exact/printed/manifest.json` for fresh schema, asset-checksum and geometry validation. Library discovery alone is not equivalent to this validation.

Open `http://127.0.0.1:8765`. Choose an anatomical group, then a ready source. **Structure library** supports search, selection and **Select all** / **Deselect all** with the displayed filter scope. **Learning tools** exposes source evidence and teaching views. Save a scene, change the view and restore it; export the scene for durable backup. Use **Teaching library** to prepare a course from explicit local package versions. Stop the service with Ctrl+C; start it with the same paths to resume. See [getting started](getting-started.md) and [teaching library](teaching-library-and-courses.md) for notebook and course workflows.

## Reproduce software and data evidence

From the source root with development dependencies installed, add the optional HDF5 dependency to include its construction tests (otherwise those tests are skipped):

```bash
python -m pip install -r requirements-source-inspection.lock.txt
python -m pytest
npm test
npm run build
python scripts/build_distribution.py
```

The tests use generated fixtures and do not need acquired anatomy. Use an SSD filesystem with symbolic-link support. The distribution builder emits a wheel and source archive under `dist`, normalizes archive metadata with a fixed `SOURCE_DATE_EPOCH`, and rejects acquired data. A Git checkout can also run `python scripts/audit_code_release.py --include-untracked`; that audit requires Git metadata and is not required in an extracted source archive.

The accepted rc2 run passed 230 Python and 135 frontend tests. An independent extraction, installation outside the checkout, frontend rebuild and distribution rebuild reproduced both supplied distribution archives byte for byte on the recorded Linux stack. This result does not promise identical builds on every platform or future dependency resolver. Preserve the versioned locks, release manifest and checksums alongside your installation.

From a release-candidate directory, verify supplied archives using `sha256sum -c SHA256SUMS.txt`. Compare rebuilt archive hashes against the corresponding entries in `RELEASE_MANIFEST.json`. Do not replace the original artifacts while checking a reconstruction.

Data reproduction additionally requires the exact original sources, recipe and implementation fingerprint, source license evidence, and construction options. Recipes retain source hashes and the local package manifest records these inputs. Mutable publisher license-page bytes can change package identity even when anatomy is unchanged. Keep historical packages referenced by exported lessons; never rewrite an identity to force a match. `neuroimage locate /path/to/exported-scene.json --data-root "$ATLAS_DATA_ROOT"` resolves the required exact local package. See [atlas format](atlas-format.md) and [detailed anatomy](detailed-anatomy-and-variation.md) for source-specific limits.

The manuscript's Online Resource 3 includes a separate README and pinned figure dependencies for rebuilding aggregate figures and tables. Replotting its receipts reproduces those analyses; it does not repeat original acquisition or establish expert anatomical validity.

## Troubleshooting

| Symptom | Check or action |
| --- | --- |
| `neuroimage` is unavailable | Activate `NeuroImage`; confirm installation with `python -m pip show neuroimage-atlas` |
| No ready atlas appears | A code-only install has no data; acquire/build a source or select the correct existing data root |
| Storage preflight refuses a build | Inspect the dry run, free space and explicit storage policy before retrying |
| Original-source hash conflict | Preserve the original and investigate its version; do not overwrite it to bypass the check |
| Missing h5py or Blender | Install the optional dependency for that source; neither is required to browse an already built package |
| Port 8765 is occupied | Use `--port 8766` and open the corresponding local URL; browser saves are specific to that origin |
| WebGL or rendering error | Check WebGL2 support and retain browser, renderer, package version and error details for diagnosis |
| Saved lesson cannot locate a source | Recover its exact historical package with `neuroimage locate`; a newer source is not an automatic substitute |

Acquisition and construction can be interrupted with Ctrl+C and rerun with the same paths. Verified originals and completed assets are reused. Browser profile deletion or storage quotas can remove local saves: retain exported scenes, notebooks and courses outside browser storage.
