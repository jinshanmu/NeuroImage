# NeuroImage Atlas

Explore normal intracranial neuroanatomy in a local web browser. NeuroImage brings independently acquired MRI, CT, source labels, surface models and tractography into a common workflow: obtain a source, build its local atlas, explore its native anatomy.

**Version 1.0.0 is prepared for final author review.** The software is licensed under Apache-2.0. Software archives contain code, recipes, schemas and documentation. Anatomical datasets are acquired separately under their own terms.

## What you can do

- Explore linked orthogonal sections and 3D anatomy; rotate, select, isolate, adjust opacity and inspect source context.
- Browse ten anatomical groups and a 52-topic detailed catalog (46 topics currently have enabled sources), including cortical sulci, deep nuclei, brainstem nuclei, ventricles and cisterns, cranial nerves, skull-base anatomy and vessels.
- Compare normal-source examples in separate views. Ten healthy-volunteer MRA cases support focused anterior and posterior arterial comparison.
- Work locally after installation and data acquisition. Browser rendering uses local resources.

The enabled anatomical collection contains 22 source configurations from 12 resource families, with 1,390 source-specific entries and 136 detailed topic–source bindings. NextBrain, IXI MRA, HumanBrainAtlas, Meso-vein MRI, VENAT, the Mouches arterial occurrence atlas, Human Inner Ear CT and the clinical TopCoW/TopBrain cohorts are excluded from the current application. Source definitions, licenses, exclusion and inspection records, and saved-scene records are retained. User-authorized removal of out-of-scope data is documented in the [local data cleanup record](docs/maintenance/local-data-cleanup-2026-10-24.md). Entry counts include repeated and overlapping source definitions. The formal release focuses on anatomy browsing; teaching libraries, courses and learning tools remain in `codex/release-testing`.

## Linux installation

The verified platform is **Linux x86_64 with Python 3.12 and a WebGL2 browser**. Install [Conda](https://conda-forge.org/download/) on SSD first. Extract the software source archive or place this checkout on SSD. Choose a data-drive directory for acquired sources and atlases, and a separate SSD directory for workspace state.

From the software directory:

```bash
bash install.sh \
  --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state \
  --recipe cerebra
```

This command creates or uses the **NeuroImage** Conda environment, installs pinned dependencies, builds and installs the browser application, obtains CerebrA, constructs and validates its atlas, and starts the local workspace. For a source build, it uses Node 24.21.0 or downloads the pinned official runtime. All Python installation stays in the named environment. Repeating the command reuses verified source files and completed construction outputs.

A supplied wheel includes the viewer and needs no Node installation:

```bash
bash install.sh --wheel /path/to/neuroimage_atlas-1.0.0-py3-none-any.whl \
  --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state --recipe cerebra
```

Use `--install-only` to install software without acquiring anatomy, or `--no-start` to finish construction without starting the service. `bash install.sh --help` lists all options.

The installer uses [the portable storage profile](config/storage-portable.json), which reserves 10 GiB on the data drive and 2 GiB on software storage in addition to estimated working space. Review these values for your drives or pass `--storage-policy FILE`. The separate [development workstation policy](config/storage-policy.json) retains larger reserves.

MIDA requires a manual download from its official access page. Z-Anatomy construction needs the separately installed Blender version specified by its recipe. The [Linux quickstart](docs/linux-quickstart.md) and [dataset installation table](docs/dataset-installation.md) give the exact workflow and source-specific requirements.

## First use

Open `http://127.0.0.1:8765` in your browser. The webpage opens prepared local atlases. Installation, source acquisition and atlas construction use the command-line tools described above.

1. Choose an anatomical group or dataset. A dataset opens its introduction and atlas buttons grouped by case or source resource; each button opens the complete atlas directly. Anatomical groups retain their separate detailed-topic pages.
2. An anatomy group or detailed topic opens with every corresponding structure selected; **Whole brain** and direct source openings select the complete atlas. Open **Structure library** to search, select or isolate structures. **Select all** and **Deselect all** apply to the displayed filter. Historical scenes opened through the CLI retain their recorded visibility.
3. In a regional view, **Whole-brain background** controls context separately from the selected structures. The 2D background starts on and the 3D background starts off; each has its own opacity control. The 3D context uses neutral-gray brain surfaces from the same source when available. Sources without brain surfaces use their native image extent, labeled **Source background**. Independent model sources provide 3D controls only; a source without whole-brain context identifies that limitation in the controls.
4. Use **Surface display and cursor** for cutaway, selected opacity and cursor controls. Choose the dataset on the home page for its introduction, citations, licenses, coverage and coordinate definitions.

The page supports ordinary browser scrolling and zoom. A bookmarked atlas link reopens its exact source package after a service restart. Source comparisons retain each panel's own coordinates.

The viewer footer, scene-saving/import/export controls and image-export controls are preserved in `codex/release-testing` at commit `006221e`. Existing scene files and browser records are retained, and the CLI can still open a scene against its exact local atlas package. See the [footer preservation record](docs/development/anatomy-release-simplification.md#viewer-footer-update-2026-10-24).

To restart the workspace:

```bash
conda activate NeuroImage
neuroimage workspace --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state \
  --storage-policy config/storage-portable.json
```

Stop it with Ctrl+C. See the [user guide](docs/getting-started.md), [local workspace guide](docs/local-workspace.md) and [normal-variation guide](docs/learning-and-variation.md).

## Sources and reproducibility

Every source uses the same acquisition, construction, validation and viewing interfaces. Original definitions, coordinates, licenses and references remain attached to its local package. Measured images, categorical labels, probabilities, streamlines and educational models keep their distinct representations.

```bash
neuroimage doctor
neuroimage recipes
neuroimage recipes cerebra
neuroimage quickstart cerebra --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state \
  --storage-policy config/storage-portable.json --dry-run
neuroimage validate /path/to/exact/manifest.json
```

A dry run reports source terms, manual downloads and storage needs without downloading. Validation checks the package's declared assets and geometry. The [installation and reproduction guide](docs/installation-and-reproduction.md) describes dependency locks, independent software builds and recovery. Portable scene files reference exact local atlas packages; users sharing a scene obtain their own matching data. Existing image exports retain source attribution and require the relevant redistribution permission.

This release supports normal anatomy and variation for education and research. Engineering checks establish software behavior and source preservation. Independent anatomical review and educational outcome studies remain separate work. The [scope and roadmap](docs/release-scope-and-roadmap.md) identifies further anatomical topics.

## Development, license and citation

```bash
conda activate NeuroImage
python -m pip install -r requirements-core.lock.txt -r requirements-dev.lock.txt \
  -r requirements-source-inspection.lock.txt
npm ci --ignore-scripts --bin-links=false
python -m pytest
npm test
npm run build
python scripts/audit_code_release.py --include-untracked
python scripts/build_distribution.py
```

Use Node 24.21.0, as recorded in `.nvmrc`. Keep the environment, checkout and build workspace on SSD. Tests generate their own small fixtures and require no acquired anatomy. Continuous integration runs validation and builds software artifacts; publication follows author review.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [community conduct](CODE_OF_CONDUCT.md), [governance](GOVERNANCE.md), [privacy](PRIVACY.md) and [security reporting](SECURITY.md). The [Apache-2.0 license](LICENSE) covers project software; [NOTICE](NOTICE) and the bundled third-party notices identify external software. Each dataset retains its own terms.

Use [CITATION.cff](CITATION.cff) to cite the software and cite each original dataset used in your work. The associated Neuroinformatics manuscript is in preparation.
