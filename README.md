# NeuroImage Atlas

A local platform for constructing, exploring and teaching normal intracranial neuroanatomy while preserving each source's coordinates, definitions and provenance.

**0.15.0rc2 is a release candidate prepared for author review.** The software is Apache-2.0. This repository and its software packages contain no acquired images, label arrays, meshes, streamlines or anatomical data derivatives. Users obtain their own datasets under the relevant source terms.

## Try the software

Linux is the verified platform. Use a WebGL2 browser, Python 3.12 in the dedicated `NeuroImage` Conda environment, and the Node version in `.nvmrc` for a source build. Keep the environment, checkout and build workspace on SSD; keep acquired data and local atlases on your chosen data drive.

```bash
conda env create -f environment.yml
conda activate NeuroImage
python -m pip install -r requirements-core.lock.txt -r requirements-dev.lock.txt
nvm install  # Requires nvm; alternatively install the Node version in .nvmrc.
nvm use
npm ci
npm run build
python -m pip install --no-deps --no-build-isolation -e .
neuroimage --version
```

If `NeuroImage` already exists, activate it instead of creating it again. A prebuilt wheel contains the offline viewer and does not require Node for normal use. Install its pinned runtime dependencies first, then install the wheel with `python -m pip install --no-deps PATH_TO_WHEEL`.

## Open your first anatomical source

```bash
neuroimage recipes
neuroimage recipes cerebra
neuroimage acquire cerebra --data-root /path/to/data-directory --dry-run
neuroimage acquire cerebra --data-root /path/to/data-directory
neuroimage build cerebra --data-root /path/to/data-directory --workers 2
neuroimage workspace --data-root /path/to/data-directory --state-root /path/to/ssd-state-directory
```

Read the selected source's terms before acquisition. The dry run reports transfer and expansion budgets. Anatomical acquisition and construction use a conservative 400 GiB free-space floor unless an explicit policy is supplied. Set an appropriate policy for your own storage; this repository's `config/storage-policy.json` records the development workstation's capacity policy, without machine-specific paths. No drive is formatted by these commands.

Open `http://127.0.0.1:8765`. Choose a ready anatomical group or dataset. The same source page provides download, construction, validation and opening tools. Use **Structure library** to locate a source-defined entry; **Learning tools** provides notes, source evidence, lessons and notebooks. The source link survives a page refresh, and browser back/forward navigation retains open view state.

The [installation and reproduction guide](docs/installation-and-reproduction.md) gives separate wheel and source installation paths, required and optional dependencies, storage setup, acceptance commands and troubleshooting. The [getting-started guide](docs/getting-started.md) covers all source types, validation, viewing and recovery. Every source uses the same acquisition, import, construction, viewing and validation interfaces. Matching original files are reused, interrupted builds resume from verified assets, and source changes produce a distinct package identity.

The [detailed anatomy and variation guide](docs/detailed-anatomy-and-variation.md) describes the 35 subordinate topics, new original model structures, native inner-ear CT and eight-case MRA observation courses.

## What the candidate provides

The accepted anatomical snapshot of 15 October 2026 contains **39 source configurations from 19 upstream families and 1,901 source-specific structure entries**. These are not 1,901 unique anatomical structures or participants. Overlapping and repeated source definitions remain separate. The software contains 186 built-in sequences, 75 curricula with 700 views, and 26 course plans selecting 580 views. Plans reuse curriculum views.

| Evidence | Examples |
| --- | --- |
| Image-linked labels and probabilities | SPL/NAC, CerebrA, CIT168, Julich-Brain, Brainstem Navigator and SUIT |
| Fine histological definitions | Eleven selected NextBrain blocks with source-processed ex vivo MRI |
| Original surface models | BigBrain layers and hippocampal subfields, Z-Anatomy and the healthy MUG500+ source skull |
| White matter | HCP1065 trajectories and independent probability fields |
| Vascular and native image evidence | THU cerebral MRA, IXI MRA, arterial occurrence, venous statistics, meso-vein imaging and HumanBrainAtlas |
| Source-bound teaching | Notes, markers, hidden-name practice, notebooks, multi-source courses, exports and exact-package recovery |

The [snapshot inventory](config/anatomy-detail-inventory-2026-10-15.json) records exact package versions and source/license references. The [atlas format](docs/atlas-format.md) and [adapter guide](docs/adapter-development.md) describe the contracts.

Source-space preservation includes source-provided standardized templates; it does not imply that every dataset is an unregistered native acquisition. Comparisons open independent spaces. The software does not estimate inter-source registration, anatomical equivalence or patient-specific anatomy. Model-only sources do not acquire an invented MRI counterpart.

## Why this workflow is useful

Anatomy teaching often combines sources that disagree in granularity, coordinates and representation. NeuroImage connects those resources to reusable teaching objects: a saved view names the exact source and construction that made it, and an incompatible package is rejected instead of silently substituted. Educators can collect views into notebooks and courses while readers can trace the original definition.

The application has its own Python construction and validation pipeline and React browser interface. It does not require a running 3D Slicer installation. NiiVue supplies image rendering; NeuroImage adds source adapters, construction fingerprints, exact-package teaching contracts and recovery rules. See the [workflow comparison](docs/software-positioning.md) for its intended role alongside general imaging applications.

## Save and share teaching content

Scenes retain source identity, camera, coordinates, selection, contrast, visibility, annotations and learning state. Notebooks and courses reference exact atlas versions. Portable JSON files contain teaching state and provenance, without embedded anatomical arrays or geometry. Recipients need their own matching local packages.

Scene, notebook and course-draft saves use IndexedDB. Older localStorage records remain readable; an old key is retired only after its explicit replacement commits. Browser quotas and profile clearing can still affect persistence. Export files for durable backup, or save courses on the data drive through the [teaching library](docs/teaching-library-and-courses.md).

Teaching image exports retain source credits and licenses. Export availability does not grant redistribution rights: the relevant source terms still apply.

See the [implemented scope and anatomical development plan](docs/release-scope-and-roadmap.md) for current modules and future fine-anatomy content.

## Evidence and limitations

Engineering validation covers source values, coordinates, overlap preservation, scene identity, restart recovery, archive boundaries and reproducible software builds. Tests do not establish complete anatomical coverage, expert agreement, learning gains or clinical utility. Full independent anatomical review and controlled educational evaluation remain future work.

The current scope is normal intracranial anatomy and variation for learning and teaching. Disease states, diagnostic and treatment workflows are outside this release. Linux has been verified; Windows and macOS have not. See [scope](docs/project-scope.md), [security](SECURITY.md) and [release notes](CHANGELOG.md).

## Develop and cite

```bash
python -m pip install -r requirements-source-inspection.lock.txt  # Include HDF5 tests.
python -m pytest
npm test
npm run build
python scripts/audit_code_release.py --include-untracked
python scripts/build_distribution.py
```

The test suite generates small synthetic fixtures; use an SSD filesystem with symbolic-link support for its boundary tests. Acquired anatomical data are unnecessary for these tests. [Contribution instructions](CONTRIBUTING.md) describe the environment and review expectations. GitHub continuous integration runs equivalent checks; it does not publish releases.

Use [CITATION.cff](CITATION.cff) to cite the software and cite every original dataset used in your work. The associated Neuroinformatics manuscript is in preparation; no journal acceptance or publication is claimed. The code license, [third-party software notices](NOTICE), and individual source terms remain separate.
