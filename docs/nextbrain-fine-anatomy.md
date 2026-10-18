# NextBrain native fine anatomy

Eleven source-preserving tissue-block packages extend the atlas with hippocampal layers, amygdalar subdivisions, thalamic nuclei, hypothalamic and basal forebrain regions, deep cerebellar nuclei, and detailed brainstem nuclei and pathways. Each block has the matching source-processed ex vivo T2 MRI, categorical labels, unsmoothed surfaces, original source names, citations and acquisition records. The accepted four-panel frontend is unchanged.

The selected source is Case 1, P57-16, from the author's [pinned repository](https://github.com/UCL/NextBrain-Case-1/tree/21b097d599fbeae883119c768ff7897dd438d4d2). Supplementary Table 1 of the [source publication](https://doi.org/10.1038/s41586-025-09708-2) reports a right hemisphere and no incidental findings for this case. The case-level scope record is `config/nextbrain-case-scope-2026-10-13.json`. The individual packages do not use the mixed-case population atlas. The original UCL deposit supplies CC0 terms; the source lookup table is extracted separately from its archive.

| Recipe suffix | Original tissue block | Label entries | Teaching emphasis |
| --- | --- | ---: | --- |
| `block05` | P3.3 | 49 | Rostral and caudal hippocampal layers, dentate layers, fimbria and alveus |
| `block07` | A3.2 | 15 | Anterior olfactory and striatal context |
| `block08` | A2.3 | 16 | Ventral striatum, olfactory regions and optic nerve |
| `block25` | C1.1 | 7 | Cerebellar layers and fastigial, dentate, globose and emboliform nuclei |
| `block33` | P1.3 | 125 | Amygdalar subdivisions, thalamic nuclei and mammillary regions |
| `block41` | P2.2 | 85 | Habenular and geniculate regions, collicular context and oculomotor root |
| `block45` | A1.3 | 136 | Preoptic, supraoptic and tuberal hypothalamus; basal forebrain and amygdala |

The full recipe prefix is `nextbrain_case1_`. The 433 entries include repeated labels across tissue blocks and represent 254 distinct original label numbers. A structure's surface covers its supplied extent in that block; a block-edge surface is the sample boundary. Keeping separate block grids avoids resampling across reconstructed blocks. Regional laterality is assigned only where the source name explicitly supplies it; the case hemisphere is recorded separately.

Case 2, P41-16, supplies four additional brainstem blocks from its [pinned source repository](https://github.com/UCL/NextBrain-Case-2/tree/9c29e15e2eef6db902296f53de636d57fc5aa6a1). The same source Supplementary Table 1 reports a right hemisphere and no incidental findings. The four packages preserve a second, independent case coordinate system.

| Full recipe | Original block | Label entries | Teaching emphasis |
| --- | --- | ---: | --- |
| `nextbrain_case2_block07` | B1.1 | 46 | Oculomotor and trochlear nuclei/roots, trochlear crossing, nigral subdivisions, collicular regions and descending pathways |
| `nextbrain_case2_block06` | B2.1 | 32 | Coeruleus, parabrachial and trigeminal nuclei, facial and abducens relationships, cerebellar peduncles and lemnisci |
| `nextbrain_case2_block16` | B3.1 | 41 | Cochlear, vestibular and olivary subdivisions, lower cranial nuclei, dorsal-column nuclei and their tract context |
| `nextbrain_case2_block38` | B4.1 | 19 | Spinal accessory nuclear assignment, caudal dorsal sensory and inferior-olivary relationships |

These add 138 block entries and 83 distinct source label numbers. Across both cases, the eleven packages contain 571 block entries and 323 distinct source label numbers. Repeated names in separate tissue blocks remain separate observations rather than a merged whole-brain segmentation.

## Reproduce acquisition and construction

Use the dedicated NeuroImage environment and the configured HDD data root:

```bash
conda activate NeuroImage
neuroimage acquire nextbrain_case1_block05 --data-root /path/to/data
neuroimage build nextbrain_case1_block05 --data-root /path/to/data --workers 4
neuroimage acquire nextbrain_case2_block07 --data-root /path/to/data
neuroimage build nextbrain_case2_block07 --data-root /path/to/data --workers 4
```

Repeat for the other recipes in the tables. The common acquisition interface verifies existing files, resumes incomplete transfers and reuses each case MRI and the common LUT and license files. A fresh installation obtains approximately 397 MB for the source LUT archive plus the small selected original label blocks and shared MRI; it extracts only the selected LUT. On the development machine, existing verified inputs were reused. The 45 original Case-1 label volumes acquired for source inspection total 16,256,206 bytes. Only the listed blocks are integrated in this increment.

The construction reserve is 3 GiB per simultaneous block build, in addition to the configured 400 GiB HDD safety floor. Two block builds with four workers each were sufficient for the first construction. The seven completed atlas packages occupy approximately 450 MB. MRI copies inside each portable package make each package independently usable; acquisition retains one shared original. Repeating construction verifies existing assets and preserves the completed manifest without recomputing geometry.

## Use the teaching content

Open the workspace and choose the local NextBrain tissue block. Each package includes source-bound guided sequences. The seven `nextbrain-case1-blockNN-fine-anatomy` curricula add 38 views, arranged as whole-section context followed by a magnified view of the same physical target. The `nextbrain-case1-fine-anatomy` course connects these notebooks through exact package identities.

Four `nextbrain-case2-blockNN-fine-anatomy` curricula add another 38 views and 19 built-in sequences. The `nextbrain-case2-brainstem-fine-anatomy` course connects midbrain, pons and medullary observations. The source defines fine nuclei, root assignments, tracts and crossings within the delivered blocks; the model surfaces retain that partial tissue coverage.

```bash
neuroimage teaching prepare nextbrain-case1-block05-fine-anatomy \
  --atlas /path/to/manifest.json --data-root /path/to/data
```

The workspace can prepare the same content through the existing teaching controls. Scenes and exports retain the selected block, package signature, source identity and physical target. The labels originate from histological delineation and author reconstruction; the MRI provides context at its own sampling. Instructors can review individual examples independently of the engineering acceptance.

## Geometry and source metadata

Construction reads each original 3D label NIfTI directly. It retains the label values and supplied affine, including obliquity and shear, and retains the MRI on its different source grid. The author documents nominal 0.1 mm in-plane histological reconstruction and 0.4 mm MRI acquisition. The delivered reconstructed affines, rather than nominal acquisition spacing, determine displayed physical geometry. Unknown source NIfTI unit fields are interpreted using this explicit millimeter evidence and the original case MRI header.

The source browser's rotated PNG/NPZ arrays, its orientation matrices and its hierarchy navigation points are different representations. They are not substituted for the 3D volume header. For the selected blocks, available exact-name hierarchy points coincide with the source label or lie within 0.170 mm of a voxel carrying that label. One hierarchy entry, inferior thalamic peduncle in block A1.3, is absent from that original 3D volume; it remains recorded and is not added as a structure. Atlas focus is derived from an actual member voxel in each retained 3D label.

Four inspected brainstem blocks (9, 13, 16 and 34) have unresolved source navigation differences reaching 6.00–24.09 mm. Their original files remain preserved and are outside the integrated seven-block set. No transform is fitted to remove these discrepancies. Two unused LUT rows (835 and 836) have out-of-range source RGB values; the original LUT is retained, and all selected colors are validated. A source label may belong to more than one hierarchy group; both groups are retained.

The four selected Case-2 brainstem blocks provide an independently consistent source alternative. All 19 available exact-name ontology targets reference a present source label; 15 match the nearest voxel exactly, and the maximum distance for the remaining targets is 0.100 mm. All sampled nonzero labels lie inside the source-processed MRI. This MRI has an author rotation relative to the original scanner grid; the supplied processed grid is preserved directly. The source block-index mask and reconstructed block boundaries are separate author representations, with their measured overlap retained in the inspection receipt. These checks establish reproducible source correspondence; individual anatomical teaching review is recorded separately.

Reproduce the selected-block source inspection with:

```bash
python scripts/inspect_nextbrain_blocks.py --data-root /path/to/data
python scripts/inspect_nextbrain_blocks.py --data-root /path/to/data --case 2
```

The inspector uses pinned recipe digests. When the additional original MRI and block-index volume are present, it also records their independent geometry comparisons. Optional source availability is explicit in the report. The source acquisition, construction, unchanged rebuild and native inspection receipts are referenced by `config/nextbrain-fine-anatomy-verification-2026-10-14.json`.

Case-2 receipts are recorded in `config/nextbrain-case2-brainstem-verification-2026-10-14.json`. Both courses passed all 76 browser views, native selection/position checks and eleven saved-scene/portable-import cases. Twenty-eight credited exports retain their image, scene, provenance, source licenses and rendering records. Restored MRI pixels are identical; transparent 3D rendering differs by at most one 8-bit channel level.

## Recovery

Run the same acquisition or build command after interruption. Preserve original source files, package manifests and `.build-state.json`. Completed assets are verified and reused; a corrupt derivative can be rebuilt from its source while intact assets remain unchanged. Restore the exact local package choice before reopening a saved teaching course. Software distributions contain the adapter, recipes and teaching definitions; users acquire and construct their own data separately.
