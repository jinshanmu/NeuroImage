# Spatial observations with source MRI and anatomy

This six-view, instructor-editable notebook uses the acquired SPL/NAC January 2017 atlas. It combines actual source image sections, source-labelled surfaces, independently adjustable surface opacity and explicit section-plane guides. The [official source description](https://www.openanatomy.org/atlas-pages/atlas-spl-nac-brain.html) identifies the delivered 1 mm images and source parcellation. The local package preserves its individual image and label affines.

The notebook is an unreviewed teaching draft. Its prompts ask learners to make and check observations in this source, not accept generated anatomical answers. Engineering acceptance does not establish independent anatomical review, functional localization or a distribution of normal variation.

## Prepare with the installed software

Use your own acquired data and the successful `neuroimage build spl_nac` manifest. The recipe and preparation command are shipped in the wheel; no source checkout is needed.

```bash
conda activate NeuroImage
neuroimage teaching recipes
neuroimage teaching prepare spl-spatial-relations \
  --atlas "$ATLAS_MANIFEST" --data-root "$ATLAS_DATA_ROOT" \
  --storage-policy path/to/storage-policy.json
```

The command prints the notebook path under `exports/spl_nac/notebooks/`. It verifies the required source version, source structure/image references and display settings, and obtains each target from an actual labelled voxel. Repeating identical preparation reuses the verified notebook. Existing modified files are preserved. A changed recipe or preparation implementation creates a separate output identity.

The operation reserves 64 MiB above the configured data-drive safety floor. It copies no image, label or surface assets. Larger later image exports also stay on the data drive. Omit `--storage-policy` only if the documented default 400 GiB data-drive floor is appropriate.

Open the printed file directly:

```bash
neuroimage open path/to/prepared-notebook.json --data-root "$ATLAS_DATA_ROOT"
```

The command resolves the exact package version, construction signature and native space, verifies its assets and starts the local viewer with the first view in presentation mode. Use `--no-browser` to print the URL without launching a browser, or `--port` if another service already uses the default port. The opened file does not overwrite a notebook already saved in browser storage. Explicit **Save notebook** is required to replace that stored copy.

## Six observations

| View | Available source context | Learning operation |
| --- | --- | --- |
| Shared section | Caudate and lateral ventricular labels | Relate one physical cursor location to three section orientations and the 3D guides |
| Selective context | Putamen, caudate and cerebral white-matter tissue | Adjust only the contextual surface and verify the apparent relationship in T2 |
| Deep definitions | External pallidal label, putamen, caudate and thalamic union | Compare source region definitions and their position in three planes |
| Cortical pair | Precentral and postcentral parcellations | Follow source assignments across visible folds without asserting functional boundaries |
| Ventricular context | Delivered ventricular and brainstem labels | Distinguish observed spaces from unproven continuity or incomplete coverage |
| Posterior context | Pons, medulla, fourth ventricle and cerebellar unions | Use selective transparency while retaining source-definition limits |

Use **Return to recorded view** after exploration. Use **Edit notebook** to change prompts; **Update scene from current view** captures the current coordinates, camera, section guides, visibility and opacity. Save or export the notebook to preserve your revisions. A portable teaching file contains scene state and provenance, not imaging data.

## Read the display correctly

- **Show matches / Hide matches** apply to the current source search and category. They do not imply correspondence between datasets.
- **Surface context** applies a 0.2 opacity multiplier or restores 1.0 to matching structures. **Selected surface display** changes one structure. Effective opacity is the overall surface opacity multiplied by that structure's setting. A zero-opacity surface is excluded from visible-surface picking; source-label sampling in 2D remains available.
- **3D section guides** show flat colored intersections with the source image field of view. Axial is amber, coronal blue and sagittal magenta. Guides contain no tissue or MRI texture. They follow physical RAS sections and the exact source affine, including oblique fields of view. They do not create a new anatomical surface or a registration.
- **Export teaching image** retains the scene, source manifest, licenses, renderer identity and guide interpretation. The PNG identifies enabled guides and individual display multipliers. Keep the accompanying files with any permitted derivative use.

The original [first-session recipe](teaching-first-session.md) is also available through `neuroimage teaching prepare spl-first-session`. Custom English JSON recipes can be passed by path. Use `neuroimage teaching schema` or `schemas/teaching-recipe.schema.json` for their JSON Schema; structure references are validated against the selected package.

## Evidence and recovery

`config/spatial-controls-verification.json` records actual browser behavior, unchanged 2D pixels, native target membership and exact restored views across categorical MRI, oblique categorical-model and probabilistic sources. `config/spatial-teaching-verification.json` records this notebook's prepared views and export checks. The independent anatomy and teaching review remains pending.

Keep any atlas version referenced by a saved scene or notebook. `neuroimage locate` still provides a read-only package lookup, while `neuroimage open` performs lookup and viewing together. No newer or similarly named package is substituted.
