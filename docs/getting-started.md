# Build and browse a local atlas

For a one-command Linux installation, start with the [Linux quickstart](linux-quickstart.md). For a clean installation, exact dependency roles and reproduction checks, start with the [installation and reproduction guide](installation-and-reproduction.md). For the integrated source-to-teaching interface, follow the [local workspace guide](local-workspace.md) after installation. The command-line steps below remain available for scripting and recovery.

NeuroImage 1.0.0 provides a local normal-anatomy workflow for independently acquired data. Its thirty-nine source recipes use the same acquisition, construction, validation and viewing commands. The home page prioritizes anatomical groups with direct local atlas entry; dataset management and teaching tools occupy secondary positions. Coordinates remain in their declared native spaces. Engineering validation does not constitute independent anatomical or lesson review.

## Prepare the software

Use the dedicated `NeuroImage` Conda environment and keep it, this checkout and build caches on SSD. Do not install project dependencies into another Python environment. Imaging, original archives, local atlases and validation data belong on the configured data drive.

```bash
conda env create -f environment.yml  # Omit if NeuroImage already exists.
conda activate NeuroImage
python -m pip install -r requirements-core.lock.txt
python -m pip install setuptools==84.0.0 wheel==0.48.0
nvm install  # Requires nvm; alternatively install the Node version in .nvmrc.
nvm use
npm ci --ignore-scripts --bin-links=false
npm run build
python -m pip install --no-deps --no-build-isolation -e .
neuroimage --version
```

The frontend build is entirely local and produces `src/neuroimage/web`. No remote viewer scripts, fonts or image services are needed during browsing. Node is needed for a source build, not for serving an already built software package. The existing environment definitions and lock files describe the development stack.

To build local software distributions, run `python scripts/build_distribution.py` in this environment. The command builds an offline viewer, then a wheel and source archive in the ignored SSD `dist` directory and checks both for acquired data. Install the wheel into `NeuroImage` with `python -m pip install dist/neuroimage_atlas-1.0.0-py3-none-any.whl`; use `--no-deps` if the pinned runtime requirements are already installed. The source archive includes frontend source, dependency locks, recipes and build instructions. Wheel and source archive metadata are normalized to a fixed `SOURCE_DATE_EPOCH`, including timestamps and file modes. An independently unpacked source build can reproduce the same wheel bytes with the pinned build/runtime stack. No publishing or uploading is performed. Linux is the verified platform; other operating systems have not been accepted.

## Acquire and construct

Set `ATLAS_DATA_ROOT` to an existing directory on the intended data drive. Public software archives do not contain a `data` link. Replace the example path below with your actual data-drive directory. Do not create a new directory on a different drive accidentally. Inspect the acquisition plan before a new transfer:

```bash
export ATLAS_DATA_ROOT="/path/to/existing/data-directory"
neuroimage recipes
neuroimage recipes spl_nac
neuroimage acquire spl_nac --data-root "$ATLAS_DATA_ROOT" --storage-policy config/storage-policy.json --dry-run
neuroimage acquire spl_nac --data-root "$ATLAS_DATA_ROOT" --storage-policy config/storage-policy.json
neuroimage build spl_nac --data-root "$ATLAS_DATA_ROOT" --workers 4 --storage-policy config/storage-policy.json
```

For the second native-space package, use the same commands with `cerebra`. That recipe obtains CerebrA and the explicitly matching MNI ICBM152 **2009c symmetric** T1/T2 template. It does not substitute another MNI release or assume correspondence with SPL/NAC.

The same commands also support `mida` using an independently obtained source archive. Its [51-class source model](mida-source-model.md) contains no original MRI; the viewer identifies its categorical sections explicitly and provides ten model-specific exploration sequences and a nine-view cranial-nerve/skull-context notebook. MRI packages remain separate and retain their normal contrast controls.

Use `cit168_native` for the [16-region probabilistic subcortical atlas](cit168-probability-evidence.md), with native T1/T2 templates and five source-grounded sequences. Its direct downloads are reused without expansion. The viewer starts with one source probability channel; cursor movement samples that fixed channel, while structure selection changes channels. **2D evidence** switches between probability support and delivered threshold labels. The source authors inferred the right-side labels from the left; that derivation remains visible and accompanies exports.

Use `hcp1065_tracts` for [87 source computational streamline collections](hcp1065-streamlines.md) and their explicitly matching ICBM152 2009a asymmetric T1/T2 reference. Two construction workers are a measured starting setting. Complete original trajectories stay in the local package; the viewer loads deterministic whole-trajectory subsets, with physical 2D slabs and overlap-aware selection. Source density is not axon count or probability. The same teaching preparer includes `hcp1065-streamline-introduction` and the ten-view `hcp1065-specialist-pathways` curriculum.

Use `mouches_arteries` for a healthy-source arterial occurrence field and its matching average TOF MRA. Original values remain in percent (0–100); the optional 3D surface comes from an explicitly project-derived >=25% display mask. This is population occurrence, not a named-vessel segmentation or an individual vascular tree. See [Specialist modules](specialist-modules.md) for source limits and all seven specialist curricula.

Use `z_anatomy` for 350 independent source model objects with no MRI volume, `venat` for seven original venous statistical fields, `mesoveins` for an exact frame from a retained original MRI series, `hba_native` for the author-averaged healthy sub-01 T2, `mug500_healthy` for the original healthy A0101 binary skull mask, and `mug500_source_mesh` for the [original author-cleaned A0101 surface](source-cleaned-skull.md). The original mask contains substantial source noise; the cleaned surface does not supply corrected image sections or CT intensity. The same commands and storage policy apply. Z-Anatomy construction additionally requires Blender 5.2.2 LTS on the executable path; its embedded runtime is separate from project Python. Read [source-model construction](source-model-construction.md), [statistical fields](native-statistical-fields.md) and [native images and skull masks](native-image-and-skull-sources.md) before interpreting their different evidence.

Use `julich_selected` for the original Julich-Brain 3.0.3 maximum-probability map with its explicitly matching asymmetric reference MRI. The same acquisition and construction commands retain all delivered source labels and the original native grid. See [Julich native construction](julich-native-construction.md).

The fine-anatomy recipes use the same commands:

| Recipe | Native content and instructions |
| --- | --- |
| `nextbrain_case1_block05` and the other ten selected blocks | [Histology-defined fine labels with source-processed ex vivo MRI](nextbrain-fine-anatomy.md) |
| `bigbrain_layers`, `bigbrain_hippocampus` | [Original reconstructed surface sheets in their source coordinate systems](bigbrain-fine-surfaces.md) |
| `hcp1065_prob` | [All 64 source probability fields with explicitly matched T1/T2](hcp1065-probability-fields.md) |
| `thu_mra_case001`, `006`, `007`, `009`, `010`, `014`, `021`, `030` (each with the `thu_mra_case` prefix) | [Original healthy-volunteer MRA and delivered segment arrays](thu-cerebral-mra.md) |
| `suit_cerebellum` | [34 original cerebellar assignments and probability channels with SUIT T1](suit-cerebellar-anatomy.md) |
| `inner_ear_ct_specimen1` | [Original native CT and all three fluid-space labels](native-inner-ear-ct.md) |
| `z_anatomy` | [350 original objects including nuclear, limbic, cortical, cerebellar and ventricular context](detailed-anatomy-and-variation.md) |

All 90 curricula retain source-specific definitions; the 31 plans organize 684 views. Course preparation uses only the explicitly chosen local package for each source. Use original source names when searching fine nuclei and grouped compartments.

After opening the workspace, use **Teaching library** to prepare one of 31 course plans from explicit local package versions. The general course comes first, followed by native-source comparisons and specialist sequences. The [course guide](teaching-library-and-courses.md) covers source-bound presentation, editing, export and restart recovery.

The acquisition command prints the peak additional download and selective expansion budget before writing. It verifies pinned archive/member SHA256 values, reuses matching originals and retains interrupted `.partial` transfers. Local pins establish repeatability; they are not publisher signatures. Source license snapshots are retained with their hashes. Review the official source terms for your use; data rights are separate from the software's Apache-2.0 license.

The default free-space floor is 400 GiB on the data drive. This project's storage policy controls the floor explicitly. Construction budgets 2 GiB additional space for SPL/NAC or CerebrA and 8 GiB for MIDA, and bounds CPU workers to eight. Four workers are the measured starting setting on this workstation. No complete archive expansion is needed for these recipes.

Multi-channel NIfTI probability inputs are read through one open file proxy per source, in channel order. This avoids repeatedly decompressing earlier frames, without loading a full four-dimensional array or creating an expanded source copy. The ordinary source-value, unit, affine and output round-trip checks still apply.

A successful build prints an absolute manifest path under `derivatives/<dataset_id>/<version>/manifest.json`. Use the printed path in the next command; do not guess the newest directory after an interrupted run.

To discover existing results later, run `neuroimage library --data-root "$ATLAS_DATA_ROOT"`, optionally adding `--dataset spl_nac`. The inventory distinguishes available packages, interrupted checkpoints and unavailable or damaged results. Discovery checks metadata, declared file sizes and lesson references; it does not decompress images, recompute geometry or claim fresh checksum validation. `validate` and `serve` perform the full checks.

## Validate and open

```bash
neuroimage validate "$ATLAS_MANIFEST"
neuroimage serve --atlas "$ATLAS_MANIFEST" --port 8765
```

Set `ATLAS_MANIFEST` to the successful build's manifest first. Open `http://127.0.0.1:8765` in a browser with WebGL2. To offer multiple packages, repeat `--atlas` with each manifest. The service binds to loopback and exposes only the selected package's declared assets and the built viewer.

Serving checks every declared asset's SHA256 each time. It can reuse successful geometry checks when the exact manifest, file hashes, validator implementation and numerical runtime still match a local receipt. Explicit `neuroimage validate` always recomputes geometry and refreshes that receipt. The optional `.geometry-validation-cache.json` stays inside the local atlas directory and is not a served or distributed asset. A read-only package remains usable through fresh validation when caching cannot be written. Removing the receipt simply makes the next startup perform full geometry checks again.

- Select a structure or search its English name, delivered abbreviation or stable ID. The cursor moves to a real source-labelled voxel, or a retained source vertex for a trajectory bundle; the three MRI planes and 3D view share RAS millimetres.
- Change the MRI contrast, display convention, opacity or layout. Radiological display changes the presentation, not the source affine or laterality.
- **Expand viewer** gives the current source sections more screen space. Choose a single anatomical plane for a large overview, then magnify at the cursor. Structure and teaching panels remain available; Escape or **Exit expanded view** returns with the same source point and selection.
- Start with **Full sections** to see the entire available source field of view. Click a location, then **Magnify at cursor** or adjust **2D zoom** for local inspection. **Full sections** returns to global context while preserving that physical location and selection.
- Drag the 3D view to rotate; use the wheel or **3D zoom** to magnify a small source region. Magnification changes the view, not anatomical resolution or geometry. Double-click a visible surface to locate it. Click or scroll an MRI plane to move through the anatomy; middle-drag a plane to pan it. Right-drag an MRI plane to adjust its display window.
- In **Inspect**, turn off **Show 3D cursor** if the guide covers a small structure. All slice cursors, coordinates and anatomy remain unchanged; scenes and notebooks retain this choice.
- Use **Inspect** for source definitions and scene notes, **Learn** for the source package's exploration sequences and identification practice, and **Sources** for citations, license snapshots and engineering records.
- **Save scene** stores state in the current browser. **Export scene** makes a portable JSON file tied to the exact atlas version and native space. It contains no MRI or mesh data.
- A scene saved during a lesson also preserves the lesson step, unfinished identification response and whether feedback has been revealed. Restoring it reopens that teaching context. Resetting the view clears the active lesson while retaining scene notes and coordinate annotations.
- Add a **Location marker** in Inspect to attach a numbered note to the current RAS point. Select the note to return to its recorded position and associated structure. Markers appear on matching 2D slices and as projected points in 3D; they are user teaching observations. **Show teaching markers** controls their visibility and is preserved by scene saving.
- **Export teaching image** makes a ZIP containing a credited PNG, scene, provenance and source licenses. Retain these records with any permitted derivative use. Restore the scene using the exact same local package.
- The PNG includes a short marker legend; `teaching-notes.txt` retains full notes and coordinates. During unrevealed identification practice the image hides answer captions, markers and notes. The source and scene files retain their normal provenance and study state.

**Compare native spaces** opens a second independent workspace. Each panel has its own structure library, learning tools, coordinates, contrast, display convention and saved scene. No coordinate transform or label equivalence is applied between panels. The same package can also be inspected in two different views. Closing comparison releases its renderer; reopening it or returning to a previously viewed atlas retains the view and notes for the current browser session. Export scene files for durable storage across page reloads.

Browser storage is specific to the browser profile and local service address. Export scene files for durable transfer or backup. Atlas selection resets the workspace to that package's own coordinates; it performs no registration.

The [independent anatomical review workflow](anatomical-review.md) creates source-bound structure and lesson material, fixed scenes and a local assessment form. All judgments start as unassessed. It keeps human anatomical review separate from construction and browser tests.

## Prepare a teaching notebook

Open **Learn → Teaching notebook** to arrange up to 50 of your own views in a sequence. Enter a notebook title, author and objective. Set up a view in the atlas, add any scene notes or location markers, then use **Add current view to notebook**. Each capture keeps its own source coordinates, contrast, camera, visibility, notes, annotations and optional identification state.

Select a scene to restore it, add a discussion prompt, or move it earlier or later. **Previous scene** and **Next scene** step through the saved sequence. Changing the live view does not overwrite the stored scene; use **Update scene from current view** when you want to retain those changes. **Remove scene** can be undone while the notebook remains open.

Use **Present notebook** for a compact classroom view with the objective, current discussion prompt and previous/next controls. **Return to recorded view** restores the saved position after live exploration. **Edit notebook** brings back the preparation form.

**Save notebook** keeps the notebook in this browser. Unsaved edits survive switching between local atlases within the current page, but a page reload requires a saved notebook or an exported file. Primary and comparison workspaces keep separate notebooks. **Export notebook** writes a JSON file with each scene's source and processing declarations; **Import notebook** validates every entry before replacing the open draft. Invalid imports retain the current draft. Save an imported notebook if you want it to persist after a reload.

Recipients acquire their own matching atlas package and then import the notebook. Every entry must match its exact package version, build signature and native space. The file contains teaching text and view states, not images, labels or surfaces. Source rights still apply to the underlying atlas. Instructor-authored content remains unreviewed; importing a file cannot confer expert approval. The 10 MiB file limit and browser storage quota may require splitting a large notebook or keeping an exported backup.

Use `neuroimage locate path/to/teaching-notebook.json --data-root "$ATLAS_DATA_ROOT"` to find the exact local manifest required by a notebook or ordinary scene file. Serve that returned manifest, then import the file in its corresponding viewer control. The locator never substitutes a newer build or a similarly named source. A missing match requires recovering the original package or constructing it from its recorded source and implementation version; keep old packages while any saved teaching content refers to them.

## Open a prepared teaching file directly

The installed software includes editable English curriculum recipes:

```bash
neuroimage teaching recipes
neuroimage teaching prepare spl-first-session --atlas "$ATLAS_MANIFEST" --data-root "$ATLAS_DATA_ROOT"
neuroimage teaching prepare spl-spatial-relations --atlas "$ATLAS_MANIFEST" --data-root "$ATLAS_DATA_ROOT"
neuroimage open path/to/prepared-notebook.json --data-root "$ATLAS_DATA_ROOT"
```

Preparation uses actual source-labelled target voxels or retained trajectory vertices, and the same data-drive space policy as other teaching exports. Pass `--storage-policy` when using a configured floor. The notebook stays separate from the software. A custom English recipe can replace the installed recipe name.

`open` finds the exact historical package, freshly validates its assets and opens the requested scene or notebook in the local viewer. A notebook starts at its first captured view in presentation mode. Use `--no-browser` for a headless service and `--port` to change the loopback port. The original teaching file and any previously saved browser notebook stay intact; only an explicit Save action replaces browser storage. `serve --content path/to/file.json --atlas "$ATLAS_MANIFEST"` offers the same startup behavior when selecting packages explicitly.

For spatial exploration, filter the structure library and use **Show matches**, **Hide matches** or **Surface context**. Set **Selected surface display** independently for the selected region. Overall surface opacity multiplies each individual setting. These controls leave image and label sections unchanged. Optional **3D section guides** show colored, untextured planes at the physical cursor, clipped to the source image field of view. They are orientation guides, not anatomy. All settings are retained by scene and notebook export. See the [spatial-observation teaching guide](teaching-spatial-relations.md).

## Recover safely

Press Ctrl+C to stop acquisition, building or serving. Re-run the same acquisition/build command to recover completed work. The acquisition receipt is `downloads/<recipe>/neuroimage-acquisition.json`; the builder checkpoint is `derivatives/<dataset_id>/<version>/.build-state.json`. These files and all data products stay outside the software release.

Completed assets are checked before reuse. An intact completed package skips source-array decompression and geometry computation. A damaged derivative is rebuilt while intact assets are retained. Changed source files, recipes or geometry-building software create a different package version and preserve the earlier package. Serving and CLI-only code changes do not invalidate the geometry fingerprint.

If an existing original conflicts with a pinned source, the command preserves it and reports the exact conflict. Do not overwrite or delete an original to bypass that report. Check the source version, filename and recipe. A failed SHA256 transfer keeps its partial file for inspection; quarantine a confirmed bad partial before retrying. HTTP, permission and capacity errors appear at the command line and in the acquisition receipt when a transaction has begun.

If browser rendering fails, retain the console error, package version and browser/GPU information. Try a current WebGL2 browser without changing the dataset geometry. The test record distinguishes NVIDIA hardware rendering from a software fallback. Neither rendering success nor numeric geometry checks substitute for expert anatomical review.

Use `brainstem_navigator_mni` for [86 independent brainstem and diencephalic source fields](brainstem-source-regions.md) with their supplied T2-weighted and FA templates. Full probabilities and separate source masks retain overlapping memberships. The installed `brainstem-source-regions` teaching example retains its verified source-voxel samples and saved physical view centers. The additional `brainstem-expanded-regions` notebook covers the expanded source definitions in 18 full-section views. Parent fields, components and complexes may overlap and are not counted as independent histological nuclei.

For the specialist Linux workflow, see [specialist modules](specialist-modules.md). [Native MRA images](native-mra-images.md) describes byte-preserving image-only construction, complete acquired sections, source intensity contrast and image-anchored teaching without invented vessel labels.

The [original source-annotation curriculum](source-annotation-teaching.md) adds nine Z-Anatomy foraminal and canal locations with whole-bone and focused views. The common preparation, teaching library and export interfaces retain their original source endpoints and context.
