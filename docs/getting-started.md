# Build and browse a local atlas

NeuroImage 1.0.0 provides local browsing of normal intracranial anatomy. The current application enables 22 source configurations and ten anatomical groups. Its detailed catalog retains 52 topic definitions; 46 have enabled sources, with 136 topic–source bindings. NextBrain, IXI MRA, HumanBrainAtlas, Meso-vein MRI, VENAT, the Mouches arterial occurrence atlas, Human Inner Ear CT and the clinical TopCoW/TopBrain cohorts are excluded from discovery, acquisition, construction and opening. Source definitions, licenses, exclusion and inspection records, and saved-scene records are retained. User-authorized removal of out-of-scope data is documented in the [local data cleanup record](maintenance/local-data-cleanup-2026-10-24.md). Source coordinates, anatomical definitions and representations stay independent.

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

## Acquire and validate anatomy with the CLI

Prepare anatomy in the terminal before browsing. Every source uses the same command-line interfaces. Inspect the [dataset table](dataset-installation.md) for manual downloads and additional source requirements.

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

The webpage opens existing local atlases and shows dataset introductions, source terms and coverage. Dataset pages group ready atlas buttons by case; an unavailable atlas shows its local availability status. Return home through the **NeuroImage** logo.

1. Choose an anatomical group, detailed topic or dataset in **Browse anatomy**. The corresponding source structures start selected; direct source and whole-brain openings select the complete atlas.
2. Open **Structure library** to search, select, isolate or change visibility. Source details retain original names, evidence and coverage.
3. Image-backed sources provide axial, coronal and sagittal sections with linked 3D anatomy. The image views use radiological convention throughout, with no convention switch. Single-click a 2D section to place the cursor without changing structure visibility. Where the source supplies categorical labels, double-click a labelled structure to show or hide it, including source structures outside the initial group. Double-click the same point again to reverse the change. Double-click a displayed 3D surface to hide it; double-click its source-labelled 2D section or use **Structure library** to show it again. **2D overlay** adjusts the section labels or evidence field; **3D opacity** adjusts the source surfaces.
4. **2D zoom** and **3D zoom** range from 1–10 in 0.1 increments, with a 1× default. Use 2D zoom to magnify around the current physical cursor; return it to 1× to restore the complete section field of view and clear panning. The 3D factor is relative to fitted anatomy or full context. Drag 3D to rotate, adjust its zoom, focus a selected structure or return to full context. Slider changes submit the latest value per animation frame and commit the final value on release.
5. Regional backgrounds have separate 2D and 3D switches and opacity. Independent native models provide their own XYZ 3D controls without implying MRI correspondence.
6. **3D section guides** and **Surface display and cursor** show their controls directly below the canvas. Adjust guide visibility, surface cutaway, selected opacity and cursor visibility without opening submenus. Independent models use **Selected object and surface display**.
7. Choose the dataset on the home page to read its introduction, citations, versions, licenses and **Source coverage and coordinates**.
8. **Compare sources** opens another eligible source in the same category. Each panel retains its own structure scope, coordinates and display state.

The cursor's anatomical name appears once above the canvas. Image, Layout and Panels are below the canvas to the left of the RAS inputs; Reset view is on their right. **View layout** changes the image and 3D arrangement. Ordinary browser scrolling and page zoom remain available without a separate expanded-view mode.

The name at the cursor identifies its source structure even after that structure is hidden and deselected. It changes to background when the cursor moves into actual source background.

## Historical scenes and development tools

The formal viewer omits the **Dataset details** footer shortcut, scene-saving/restoration/import/export controls, image-export controls and the MRI interaction-hint/Ready footer. Source introductions remain on the home dataset pages. Model status and **Selected object and surface display** controls remain available.

These footer tools are preserved in `codex/release-testing` at commit `006221e`. Its **Dataset details** button opens the existing **Sources and coordinates** tools pane. The [preservation record](development/anatomy-release-simplification.md#viewer-footer-update-2026-10-24) identifies the exact source snapshots. Existing scene files and browser records are retained. The formal CLI still locates and opens a historical scene:

```bash
neuroimage locate /path/to/scene.json --data-root /path/to/data/NeuroImage
neuroimage open /path/to/scene.json --data-root /path/to/data/NeuroImage
```

Historical scene files reopen as ordinary anatomy views; retired lesson state is ignored. Existing notes and source annotations remain recorded in those scene files. Scenes cannot substitute another package version or native space.

Teaching library, course management/presentation, guided lessons, identification practice, study records and notebook authoring/presentation are retained in `codex/release-testing`. They are absent from the formal release. Existing user teaching files and browser records are not erased by this change. See the [scope](release-scope-and-roadmap.md).
