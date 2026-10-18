# NeuroImage Atlas

Explore and teach normal intracranial neuroanatomy in a local web browser. NeuroImage brings independently acquired MRI, CT, source labels, surface models and tractography into a common workflow: obtain a source, build its local atlas, explore its anatomy and save views for teaching.

**Version 1.0.0 is prepared for final author review.** The software is licensed under Apache-2.0. Software archives contain code, recipes, schemas and documentation. Anatomical datasets are acquired separately under their own terms.

## What you can do

- Explore linked orthogonal sections and 3D anatomy; rotate, select, isolate, adjust opacity and inspect source context.
- Browse ten anatomical groups and 46 detailed topics, including cortical sulci, deep nuclei, brainstem nuclei, ventricles and cisterns, cranial nerves, skull-base anatomy and vessels.
- Compare normal-source examples in separate views. Eight healthy-volunteer MRA cases support focused anterior and posterior arterial comparison.
- Learn with guided questions, identification practice and saved study records. Mark steps for review, restore responses and export a backup.
- Prepare notebooks and courses from recorded views. Each view reopens its matching local source package with the original position, selection and display settings.
- Work locally after installation and data acquisition. Browser rendering uses local resources.

The verified anatomical collection contains 39 source configurations from 19 resource families, with 1,965 source-specific entries. The software supplies 193 built-in sequences, 90 notebook curricula containing 796 views, and 31 course plans selecting 684 views. Course plans reuse curriculum views; entry counts include repeated and overlapping source definitions.

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

Open `http://127.0.0.1:8765` in your browser.

1. Choose an anatomical group or dataset. Detailed topics, cases and regional configurations appear on secondary pages.
2. Open **Structure library** to search, select or isolate structures. **Select all** and **Deselect all** apply to the displayed filter.
3. Use **Learning tools → Learn** for a guided sequence. Write a response, compare it with the source answer and use **Save response**, **Review again** or **Understood** to keep a study record.
4. Open **Teaching library** to prepare a course or use a saved notebook. With CerebrA installed, the first-session plan provides eight introductory views.
5. Export scenes, notebooks and study records for backup. Saved courses also remain on the data drive.

The page supports ordinary browser scrolling and zoom. A bookmarked atlas link reopens its exact source package after a service restart. Source comparisons retain each panel's own coordinates.

To restart the workspace:

```bash
conda activate NeuroImage
neuroimage workspace --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state \
  --storage-policy config/storage-portable.json
```

Stop it with Ctrl+C. See the [user guide](docs/getting-started.md), [teaching workflows](docs/teaching-library-and-courses.md) and [learning and variation guide](docs/learning-and-variation.md).

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

A dry run reports source terms, manual downloads and storage needs without downloading. Validation checks the package's declared assets and geometry. The [installation and reproduction guide](docs/installation-and-reproduction.md) describes dependency locks, independent software builds and recovery. Portable teaching files reference exact local atlas packages; users sharing a lesson obtain their own matching data. Image exports retain source attribution and require the relevant redistribution permission.

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
