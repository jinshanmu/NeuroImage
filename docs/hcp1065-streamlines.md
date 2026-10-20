# Source-preserving HCP1065 streamline teaching

This source guide includes historical teaching-validation records. Curricula, lessons and course workflows described here are retained in `codex/release-testing`; the formal release exposes the same source anatomy through [Browse anatomy](getting-started.md).

The `hcp1065_tracts` recipe adds all 87 delivered source computational streamline collections to the shared local atlas workflow: 34 association, 34 projection, two commissural, seven cerebellar and ten cranial-nerve collections. These are source definitions, not 87 independently reviewed anatomical tracts. The original six-bundle package remains available for historical scenes. It supplies reference T1/T2 MRI, physical 2D trajectory sections and 3D line geometry. All original decoded trajectories and vertices remain in the local package. The software distribution includes only the recipe, interface, implementation and English curriculum.

## Source relationship and limits

The [official HCP1065 source page](https://brain.labsolver.org/hcp_trk_atlas.html) places its population-averaged tractography in **ICBM152 2009a nonlinear asymmetric** space and instructs use of the corresponding T1/T2 template. The recipe uses that exact [MNI release](https://www.bic.mni.mcgill.ca/ServicesAtlases/ICBM152NLin2009), retains both source notices and records the declared relationship. It introduces no registration to SPL/NAC, CerebrA, CIT168, MIDA or another MNI release. Header agreement and field-of-view coverage are engineering checks; anatomical fit has not received independent expert review.

These lines are computational estimates from a population atlas. They do not show individual axons, prove terminal connections, establish functional connectivity, or measure normal anatomical variation. Unequal left/right source counts do not quantify anatomical asymmetry. Endpoints are delivered trajectory endpoints, not independently identified cortical origins or terminations. Corpus callosum and middle cerebellar peduncle retain unspecified laterality because their delivered bundles span both sides.

The separately delivered occupancy maps and population-probability maps are excluded from this package. Their relationship to these TRK files is not sufficiently established. Do not shift or mirror one representation to make it look similar to another. The two cerebellar-hemisphere collections and vermis are broad source collections. Cranial-nerve II, III, V, VII and VIII trajectories are computational estimates, not independently segmented nerve boundaries. Two spreadsheet descriptions (`C_FP_R`, `TR_S_R`) repeat a left-side description despite right-side file keys; the discrepancy is retained, and original coordinates are checked without mirroring.

The TRK source is recorded under CC BY-SA 4.0 with the accompanying Human Connectome Project acknowledgment; the reference template retains its separate MNI terms. Each local package and credited teaching export contains all four retained notices, including the source description. The source abbreviation spreadsheet is hashed as an input. Software licensing does not replace any of those source terms.

## Acquire, construct and open

Activate the dedicated `NeuroImage` environment. Set `ATLAS_DATA_ROOT` to the existing HDD directory and retain code, environment and build caches on SSD. The commands are identical to those for other sources:

```bash
neuroimage recipes hcp1065_tracts
neuroimage acquire hcp1065_tracts --data-root "$ATLAS_DATA_ROOT" --storage-policy config/storage-policy.json --dry-run
neuroimage acquire hcp1065_tracts --data-root "$ATLAS_DATA_ROOT" --storage-policy config/storage-policy.json
neuroimage build hcp1065_tracts --data-root "$ATLAS_DATA_ROOT" --workers 2 --storage-policy config/storage-policy.json
```

Use the successful build's printed manifest path:

```bash
neuroimage validate "$ATLAS_MANIFEST"
neuroimage serve --atlas "$ATLAS_MANIFEST" --port 8765
```

Existing archives, the 87 selected TRK files and the source description table are verified and reused. Selective expansion obtains only declared inputs; complete trajectories already present locally are not downloaded or expanded again. The acquisition dry run calculates additional transfer and extraction requirements from the actual missing files. The recipe declares a peak additional construction budget above the configured 400 GiB safety floor. The expanded build retained 503,085 trajectories and 102,067,827 vertices in 617 assets (approximately 1.86 GiB). Two workers completed it in 192.58 seconds, with approximately 1.09 GiB peak resident memory. These are measurements on the development workstation, not performance guarantees for other machines.

The format's required corner-to-center and header-defined orientation conversion produces RAS millimetres. An independent TrackVis reader checks that conversion against NiBabel. No smoothing, trajectory subdivision, point simplification or additional spatial transform is applied. Each complete RAS TCK is reopened and its coordinate digest compared with the original decoded records.

## Browse the evidence

Select a source bundle by name or stable ID. The physical cursor moves to a retained source vertex near its point-weighted centroid. This is a reproducible navigation point, not an independently identified anatomical landmark. Change T1/T2, radiological convention or layout while preserving the physical cursor. Drag the 3D view to rotate and adjust **3D zoom** for context or close inspection.

**Display sampling** selects complete original trajectories by a recorded source-index rule:

| Level | Maximum trajectories per bundle | Vertex treatment |
| --- | ---: | --- |
| Preview | 256 | Every vertex of each selected trajectory |
| Standard | 1,024 | Every vertex of each selected trajectory |
| Detail | 4,096 | Every vertex of each selected trajectory |
| Complete retained source | All | Available through the TCK download link; not loaded as a browser display level |

The display levels are nested deterministic subsets. An explicit JSON index list accompanies each subset, so a displayed line can be traced back to its original source record. The UI states both displayed and retained counts. Line density, line thickness and color are display choices, not anatomy, axon count or confidence. Whole-bundle bounding boxes and counts always describe the complete retained source.

The three 2D windows show only segment portions inside the physical **Section slab**, initially 1 mm thick and adjustable from 0.2 to 10 mm. A thicker slab contains more trajectory portions; it does not increase MRI resolution. It is not a projection of the whole bundle. **Section trajectories** controls only this overlay. **3D trajectory opacity** and per-bundle opacity affect only the 3D display. Source arrays and coordinates remain unchanged.

Click a slice or double-click a visible 3D line to locate it. The inspector lists displayed bundles within 1 mm of the picked point or displayed section segment. Overlapping candidates remain separately selectable; choosing one does not move the physical cursor. This is proximity to displayed computational estimates, not an exclusive tissue label. Hidden or transparent geometry is excluded where it is not displayed. Changing sampling or visibility refreshes this evidence.

Use **Compare native spaces** to inspect another source independently. It does not fuse coordinates, infer cross-atlas structure equivalence or overlay unmatched anatomy.

## Prepare and teach six views

The installed English curriculum introduces the source model, paired arcuate bundles, paired corticospinal bundles, corpus callosum, middle cerebellar peduncle, and the effect of display sampling. Its discussion prompts stay within those supplied definitions and spatial observations. All teaching content remains an unreviewed draft.

Open the matching source through **Browse anatomy**; use the [current browser guide](getting-started.md) for display and scene controls.

`open` resolves the exact package and presents the first view. Use **Next view** and **Previous view** in class, and **Return to recorded view** after exploring. Editing a view does not overwrite the recorded scene. Save or export explicitly when retaining your changes. Fourteen source-group exploration sequences are also available through **Learn**, including identification practice based on source collection names. The ten-view `hcp1065-specialist-pathways` notebook covers the broader collection in groups of at most six visible bundles; this limits loading and visual clutter while preserving the complete source in the package.

Scenes and notebooks preserve the exact package identity, cursor, selected/visible bundles, display level, slab width, opacity, camera, contrast, notes and markers. **Export teaching image** produces the PNG, scene, provenance, rendering interpretation and all source notices together. The rendered image depicts the recorded display subset, while the package retains the complete source. Keep the matching package to restore the scene later.

## Validation and recovery

Construction checks every retained point against the source-declared reference field of view, every subset against its original line indices and coordinates, target membership, source counts, bounds, centroids and sided definitions. The viewer checks canonical TCK boundaries explicitly, including the first and last trajectories.

The real-browser fixture `scripts/browser_streamlines.js` (testing branch) records actual uploaded GPU vertices, line indices and section matrices, then exercises visibility, overlap selection, pointer picking, opacity, sampling and scene/export recovery. `scripts/check_streamline_browser.py` independently decodes original TRK files and compares them with the GPU coordinate digests, projected slice pixels and source-segment distances. This verifies engineering correspondence, not tract validity or expert suitability.

For the installed six-view notebook, run `scripts/browser_teaching_delivery.js` (testing branch) through the CLI, then check its output with `python scripts/check_streamline_browser.py --data-root <root> --teaching-log <CLI-output> --notebook <prepared-notebook.json>`. This independently checks the original line/vertex targets, exported scene states, all source notices, and pixel equality after returning to the recorded view and reimporting the notebook.

Stop a build with Ctrl+C and rerun the identical command. Verified completed assets are reused; missing products are repaired through the same checkpoint path. The measured expanded-package repeat reused all 617 assets without geometry recomputation. Never delete source acquisitions or historical packages referenced by scenes. Use `neuroimage locate` to recover the exact package for a saved teaching file. See the [general recovery instructions](getting-started.md#recover-safely).
