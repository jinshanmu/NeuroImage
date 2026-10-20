# Build and browse a local atlas

NeuroImage 1.0.0 provides local browsing of normal intracranial anatomy. All 39 source configurations, ten anatomical groups and 46 detailed topics remain available. Source coordinates, anatomical definitions and representations stay independent.

## Install and start

Follow the [Linux quickstart](linux-quickstart.md) or [installation and reproduction guide](installation-and-reproduction.md). Keep the dedicated `NeuroImage` Conda environment, software and build workspace on SSD. Keep acquired anatomy on the selected data drive.

For an existing installation:

```bash
conda activate NeuroImage
neuroimage workspace --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state
```

Open `http://127.0.0.1:8765`. Reuse the same data and state directories after restarting.

For source development, build the viewer with the Node version in `.nvmrc`:

```bash
npm ci --ignore-scripts --bin-links=false
npm run build
python -m pip install --no-deps --no-build-isolation -e .
```

## Acquire and validate anatomy

Every source uses the same interfaces. Inspect the [dataset table](dataset-installation.md) for manual downloads and additional source requirements.

```bash
neuroimage recipes
neuroimage acquire cerebra --data-root /path/to/data/NeuroImage --dry-run
neuroimage acquire cerebra --data-root /path/to/data/NeuroImage
neuroimage build cerebra --data-root /path/to/data/NeuroImage
neuroimage library --data-root /path/to/data/NeuroImage
neuroimage validate /path/to/exact/manifest.json
```

Use the manifest path printed by construction. Acquisition reuses verified original files and construction resumes completed checkpoints. Source licenses, metadata, native grids and geometry remain attached to every package.

## Browse

1. Choose an anatomical group, detailed topic or dataset in **Browse anatomy**. The corresponding source structures start selected; direct source and whole-brain openings select the complete atlas.
2. Open **Structure library** to search, select, isolate or change visibility. Source details retain original names, evidence and coverage.
3. Image-backed sources provide axial, coronal and sagittal sections with linked 3D anatomy. Choose a layout, change contrast and opacity, or toggle radiological display.
4. Use **Full sections**, **Magnify at cursor** and **2D zoom** to inspect the same physical point. Drag 3D to rotate, adjust **3D zoom**, focus a selected structure or return to full context.
5. Regional backgrounds have separate 2D and 3D switches and opacity. Independent native models provide their own XYZ 3D controls without implying MRI correspondence.
6. Expand **Surface display and cursor** for surface cutaway, selected opacity and cursor visibility. Independent models use **Selected object and surface display**.
7. **Sources and coordinates** exposes citations, source versions, licenses and coordinate limits.
8. **Compare sources** opens a second independent viewer. Each panel retains its own coordinates, display state and saved scenes.

**Expand viewer** and Escape retain the current position and selection. Ordinary browser scrolling and zoom remain available.

## Save and export

**Save scene** stores the view in this browser profile. **Restore saved**, **Export scene** and **Import scene** retain the exact source binding, coordinates, camera, selected structures and display settings. **Export image** packages a PNG with the scene, provenance and source licenses.

```bash
neuroimage locate /path/to/scene.json --data-root /path/to/data/NeuroImage
neuroimage open /path/to/scene.json --data-root /path/to/data/NeuroImage
```

Historical scene files reopen as ordinary anatomy views; retired lesson state is ignored. Existing notes and source annotations in those files remain available in the scene and export. Scenes cannot substitute another package version or native space.

Teaching library, course management/presentation, guided lessons, identification practice, study records and notebook authoring/presentation are retained in `codex/release-testing`. They are absent from the formal release. Existing user teaching files and browser records are not erased by this change. See the [scope](release-scope-and-roadmap.md).
