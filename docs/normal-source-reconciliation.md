# Normal-source reconciliation and specialist evidence

**Historical reconciliation record:** dated inventories and source-opening recommendations below describe an earlier scope. NextBrain, IXI, HumanBrainAtlas, Meso-vein MRI, VENAT, the arterial occurrence atlas, Human Inner Ear CT and the clinical TopCoW/TopBrain cohorts are excluded from the current application. Source definitions, licenses, exclusion and inspection records, and saved-scene records are retained. User-authorized removal of out-of-scope data is documented in the [local data cleanup record](maintenance/local-data-cleanup-2026-10-24.md). Consult the [current release inventory](../config/anatomy-release-1.0.0.json) for enabled sources.

The 2026-10-13 increment reconciles the 41 recorded source entries in `config/normal-source-reconciliation-2026-10-13.json`. Thirteen sources had local browser packages at that reconciliation checkpoint. The later 2026-10-14 inventory contains 33 source configurations from 18 upstream families; see `config/anatomy-coverage-fine-2026-10-14.json`. This is a bounded inventory of the available project resources and newly investigated sources, not a claim that all public intracranial imaging has been exhausted. Acquisition and construction states describe work performed; each source retains its individual license through the same platform interfaces.

## Delivered additions

| Source | Local evidence | Interpretation and remaining coverage |
| --- | --- | --- |
| Z-Anatomy, pinned source commit | 213 original source objects, including 119 objects added during the fine-anatomy increment | Named artery branches, dural sinuses, paired nerves and source roots, bones, dura and brainstem context. Author-created educational geometry in native XYZ; no fabricated MRI or anatomical axis assignment. Additional CN VIII components retain source model definitions; arachnoid membrane geometry remains a separate increment. |
| VENAT v4 | Seven original scalar fields from twenty healthy participants, with units and statistics | Population evidence, not named venous branches or individual variant frequency. Two source torsion fields remain archived pending unit interpretation. |
| Meso-vein MRI v4 | One original healthy-participant run, complete source series and exact stored frame 3 | Native image signal without vein segmentation. No source-author 2x interpolated volume is substituted. The echo-time discrepancy remains recorded; no precise echo time is invented. |
| MUG500+ v20, healthy A0101 | Original binary skull mask and unrefined surface | No source CT intensities or named foramen segmentation. All source components are retained. The source mask stores 0.75 mm axial spacing; the publication describes 1.5 mm cohort slice thickness. Only the healthy A-series was selected. |
| HumanBrainAtlas, sub-01 T2 file v1 | Original 625 × 725 × 555 float32 image; author-averaged ACPC grid | The 0.25 mm reconstructed grid is not acquisition resolution. No further registration, label inference or membrane reconstruction. Source header/publication specify CC BY-NC-SA 4.0; the complete source license, including its introductory CC BY-NC notice, is retained. |

The existing SPL/NAC, CerebrA, MIDA, CIT168, HCP1065, Brainstem Navigator, Mouches and IXI packages remain available. Their source definitions and native spaces are unchanged. Source-specific entry counts may overlap and are not counts of unique human structures.

## Acquired UBA167 channels

[UBA167](https://www.nitrc.org/projects/brainarteries/) was obtained from the official NITRC agreement workflow, with an original archive size of 152,410,421 bytes and local SHA256 `984ac9f83210d8f8ccfbf3702dd41076f4ffc60433dc397b16bea8882023adb7`. No publisher checksum was supplied. Its 16-channel NIfTI and seven DARTEL tissue-class templates are preserved. Those templates are not measured MRI.

The [primary study](https://doi.org/10.1007/s12021-016-9320-y) describes 167 healthy older adults. Its additional clinical validation data were not acquired. The archive and inspected [release notes](https://www.nitrc.org/frs/shownotes.php?release_id=3390) do not explicitly map stored channel indices to artery names; the [document collection](https://www.nitrc.org/docman/?group_id=1070) has no visible documents. A table order is not adopted as a file-label mapping. Original channel inspection is recorded in `config/uba-source-channel-inspection-2026-10-13.json`: all samples are finite, with some small negative values. The project has not clamped, renamed or overlaid those channels. The source data license is Attribution Non-Commercial Share Alike without a stated version in the inspected notice; the paper's license does not replace the data notice.

The next useful step is an authoritative channel definition or a separately documented, independently checked correspondence. This evidence limitation does not block other native sources or the common software workflow. No manual download is currently required.

## Source adapter status and continuation

| Resource | Concrete continuation requirement |
| --- | --- |
| Julich-Brain v3.0.3 | Delivered in the later integration increment: 314 source MPM entries with the explicitly matching ICBM2009c **asymmetric** reference, original label values and affine checks. See [Julich construction](julich-native-construction.md). |
| NextBrain | Eleven verified native blocks from source-documented normal Cases 1 and 2 now provide 571 block entries with source-processed ex vivo MRI. Case 4 P85-18 is excluded from construction. Unresolved source navigation and case-identity issues remain explicit. See [fine anatomy](nextbrain-fine-anatomy.md). |
| BigBrain | The current adapter retains fourteen laminar boundary sheets and fourteen hippocampal surfaces in their declared reconstruction spaces. Tutorial histology and MRI remain separate where reliable correspondence is absent. See [fine surfaces](bigbrain-fine-surfaces.md). |
| Visible Human additional head | Preserve the inspected irregular CT plane intervals and separate PD/T2 echoes. Specimen normality and cross-modality correspondence remain unestablished. No interpolated CT or guessed registration is produced. |
| TopCoW | Existing patient-cohort files are not automatically normal intracranial examples. A documented case-level normal subset is needed before normal-variation teaching use. |
| Other IXI and OpenNeuro images | Reuse the retained archives and metadata for selected, source-documented normal examples; validate participant identity and native geometry before new packages. |
| BodyParts3D | Original models and source notices remain available; current Z-Anatomy attribution already includes upstream contributions. Avoid redundant acquisition and unsupported image alignment. |

Rhoton remains deferred by the owner. Removed TCIA and MSD disease acquisitions remain stopped. Whole-body, duplicate BigBrain releases and high-resolution expansion remain deferred according to the existing storage plan. These choices do not define license-based platform levels.

## Teaching coverage and evidence

The secondary **Learn** panel contains six source-matched discussion topics, with questions, reasoning and primary references. They cover cisternal boundaries, normal variation, nerve extents, skull openings, vascular representations and reconstructed image grids. The catalog is `src/neuroimage/catalogs/teaching-evidence.json`. All text is English and topic IDs are stable.

The [primary membrane study by Lü and Zhu](https://doi.org/10.1002/ca.20448) examined adult cadaveric brains microscopically. Its bibliographic abstract was inspected and archived; copyrighted figures and membrane geometry are not incorporated. A source image annotation locates a regional observation, while a named membrane or boundary requires its own evidence. Dural models and generic CSF classes are not substituted for arachnoid membranes.

No new individual normal variant is labelled as confirmed. No named cortical/deep venous branch image segmentation, full nerve segment set, named foraminal partition or membrane reconstruction is delivered. The later source-annotation increments add eighteen original author-indicated skull-base and sellar points and thirty-six whole-bone/focused views; these retain their separate point representation. See source annotation teaching (testing branch). Those remain development/content tasks. Subsequent instructor cases include exact source-bound CA1, hippocampal, skull-base, nerve-component, MRA and Tapetum examples. Each judgment remains attached to its image hashes; the individual `config/instructor-review-*.json` records preserve accepted, pending and requested revisions.

## Local storage and reproducibility

All acquired archives, original image/model files, atlas packages and literature stay on the data drive. Software distributions include code, schemas, recipes, English source references and build/use instructions. They do not include the acquired assets or the local derived atlas packages.

Reuse the existing `acquire`, `build`, `validate` and `workspace` commands. The source-specific recipes pin available file hashes and select only required archive members. Do not delete an older local package referenced by a saved scene. See [native source images and skull masks](native-image-and-skull-sources.md), [statistical fields](native-statistical-fields.md), [source models](source-model-construction.md) and [anatomy browsing](anatomy-browser.md).

## NextBrain case-specific follow-up

The [original Supplementary Table 1](https://media.springernature.com/original/springer-static/esm/art%3A10.1038%2Fs41586-025-09708-2/MediaObjects/41586_2025_9708_MOESM7_ESM.docx) identifies the incidental tumor in Case 4. The [official Case 4 repository](https://github.com/UCL/NextBrain-Case-4) maps that case to P85-18. Exclude P85-18 from future normal-atlas construction, and do not characterize the five-case aggregate as uniformly normal. Existing original files remain preserved.

Cases 1, 2 and 3 map to P57-16, P41-16 and P58-16. Their source-reported normal status, source identifiers and untouched local MRI headers are recorded in `config/nextbrain-case-scope-2026-10-13.json`; Cases 1 and 2 now have eleven source-preserving block adapters with original affine and source-target validation. Case 3 remains available for a later bounded increment. Case 5 uses EX9-19 in its official browsing repository and EXT9-19 in the existing raw release. This naming difference is not silently normalized. The accepted eleven-block set uses only the individually selected Cases 1 and 2. See [NextBrain fine anatomy](nextbrain-fine-anatomy.md) for source geometry, build and recovery details.
