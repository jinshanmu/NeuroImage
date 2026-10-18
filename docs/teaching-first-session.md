# A first session with real MRI and source anatomy

This editable six-view notebook introduces the general atlas workflow using the SPL/NAC January 2017 source. Each view combines original T1 or T2 MRI, source-derived categorical overlays, native-space surfaces and a marker inside the selected label. The prompts ask learners to identify structures, describe spatial relationships and distinguish visible image evidence from source parcellation decisions.

The example is a draft. Engineering checks establish the recorded coordinates, label membership, view restoration and export contents. Independent anatomical and teaching review has **not** been performed. An instructor should inspect the source definitions and adapt the prompts before using them in a lesson. No functional localization, normal-variation prevalence or clinical conclusion is established by these views.

## Prepare from your own local atlas

The current installed software also provides `neuroimage teaching prepare spl-first-session --atlas "$ATLAS_MANIFEST" --data-root "$ATLAS_DATA_ROOT"`. It uses the same source-bound recipe without requiring a checkout. Add `--storage-policy` for the configured storage floor, then use `neuroimage open path/to/prepared-notebook.json --data-root "$ATLAS_DATA_ROOT"` to resolve and present the exact package. The source helper below remains supported for earlier installations.

Use the dedicated `NeuroImage` environment and the [ordinary acquisition and construction workflow](getting-started.md) to build SPL/NAC. Keep the original data and the resulting atlas on the configured data drive. Set `ATLAS_MANIFEST` to the successful build's printed manifest path.

The preparation helper, English recipe and this guide are included in the 0.3.2 source archive and the project checkout. Run preparation from the unpacked source directory. The wheel contains the installed viewer; it can import and present the prepared notebook. Historical 0.3.1 archives remain preserved without these later teaching materials.

```bash
conda activate NeuroImage
export ATLAS_DATA_ROOT="$(realpath data)"
python scripts/prepare_teaching_notebook.py \
  --manifest "$ATLAS_MANIFEST" \
  --recipe examples/spl-first-session.json \
  --data-root "$ATLAS_DATA_ROOT" \
  --storage-policy config/storage-policy.json
```

The helper requires the declared dataset and source version, validates the atlas and checks every referenced structure and image. It obtains the target coordinates from the local atlas; it does not embed machine-specific coordinates in the recipe or transfer landmarks from another source. The notebook remains bound to that exact package, construction signature and native space.

Output goes to `exports/spl_nac/notebooks/normal-anatomy-first-session-<signature>/` beneath the data root. Keep the printed directory. `prepared-notebook.json` is the importable notebook; `recipe.json` and `preparation.json` record its instructions and provenance. Repeating unchanged preparation reuses the verified file. A changed recipe, source package, preparation implementation or software version creates a separate directory. Existing modified content is preserved rather than overwritten.

Preparation reserves a 64 MiB export budget above the configured data-drive free-space floor. It does not copy images or surfaces into the notebook. Exported teaching images subsequently contain source derivatives and remain separate from the software distribution.

## Present and adapt

Run `neuroimage serve --atlas "$ATLAS_MANIFEST" --port 8765`, then open [the local viewer](http://127.0.0.1:8765). Select the matching SPL/NAC package and open **Learn → Teaching notebook**. Save or export any current draft before importing `prepared-notebook.json`.

Use **Present notebook** to display the objective and discussion prompt. **Previous view** and **Next view** restore each captured view. Explore the current anatomy by moving through slices, switching T1/T2 or rotating the surfaces, then use **Return to recorded view** to restore its saved state. The source remains in its native space throughout.

| View | Source context | Discussion task | Limit that must remain visible |
| --- | --- | --- | --- |
| 1. Orientation | Left caudate, both lateral ventricular labels and the right caudate | Find the same physical point in three planes; change the display convention and read the orientation markers | A display change does not change physical coordinates or source laterality; the marker is not an independently reviewed landmark |
| 2. Deep structures | Left putamen, caudate and lateral ventricle | Describe relative positions using MRI and rotated surfaces; compare T1/T2 | Not every segmentation boundary is independently resolved by the MRI |
| 3. Ventricular spaces | Lateral, third and fourth ventricular labels | Follow the represented spaces across adjacent sections | A sampled gap cannot establish a missing anatomical connection or its complete continuity |
| 4. Central cortex | Left precentral and postcentral parcellations | Relate the labelled cortical regions to the visible folds | Source parcellations do not establish an individual's functional boundaries |
| 5. Brainstem | Delivered Pons and fourth ventricular labels | Inspect the source definition while comparing sagittal, axial and coronal sections | Separate source metadata calls the region “unsegmented region of pons”; it must not be assumed to delineate the entire pons |
| 6. Cerebellum | Left/right source parcellation unions and fourth ventricle | Explain what a union combines and inspect its represented extent | Some requested source values are absent; no tissue is invented, and folial or nuclear coverage is incomplete |

Select **Edit notebook** to change the title, learning objective and discussion prompts. Changes to the live camera, visibility, notes or markers are retained in a captured scene only after **Update scene from current view**. Use **Save notebook** for this browser profile and **Export notebook** for a portable backup. An imported notebook is not automatically saved across a reload. The exported file remains user-authored and unreviewed.

**Export teaching image** produces a ZIP with a credited PNG, exact scene, source manifest, rendering record, license snapshots and `teaching-notes.txt`. The PNG contains short note excerpts; the text file retains the full source definitions and coordinates. Discussion prompts remain in the notebook. Keep the ZIP contents together when reusing permitted derivatives. Image files are not a replacement for the notebook's interactive scenes.

## Restore on a later visit

```bash
neuroimage locate path/to/teaching-notebook.json --data-root "$ATLAS_DATA_ROOT"
```

Serve the exact manifest returned by the locator, then import the notebook. Do not substitute a newer package because its title matches. Keep any historical package still referenced by a teaching notebook or review packet. If the package is missing, recover it from backup or reconstruct its recorded source and implementation version.

## Recorded engineering acceptance

The first local example was rendered with the independently installed 0.3.1 viewer and the native NVIDIA WebGL2 browser. All six source targets were sampled independently through the label volume's inverse affine. Each matched its selected categorical value. Every exported scene matched the corresponding notebook state, and the six image ZIPs retained the source licenses and complete notes. Exporting and reimporting the notebook preserved all six views without page exceptions or external network requests. Later software-distribution checks are recorded separately so this historical evidence remains identifiable.

The machine-readable receipt is [first-session-teaching-verification.json](../config/first-session-teaching-verification.json). It records the exact local package and data-root-relative artifact paths. This engineering receipt does not close the [independent anatomical review milestone](anatomical-review.md).
