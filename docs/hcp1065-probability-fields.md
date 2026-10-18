# HCP1065 independent white matter probability fields

The `hcp1065_prob` recipe adds all 64 original NIfTI probability fields from the [author's HCP1065 release](https://brain.labsolver.org/hcp_trk_atlas.html). It complements the existing 87 streamline bundles. Association, cingulum, fornix, descending, corticostriatal, corticopontine and thalamic subdivisions are available, together with corpus callosum body, forceps major, forceps minor and tapetum fields. Original file names and stable source IDs are retained, including the publisher's `Cingulum_Rarolfactory` spelling.

The source is diffusion-tractography population inference from HCP young adults. Probability describes source tractography support through a template voxel. Each field retains its complete original scalar values and overlaps with other fields. The downloaded inventory has 64 files; the paper's main analysis describes 52 pathways. These refer to different inventories. The paper also reports differing tracking yields for several bundles. The project retains published values rather than recomputing denominators.

Cite Yeh FC, *Nature Communications* 13, 4933 (2022), [doi:10.1038/s41467-022-32595-4](https://doi.org/10.1038/s41467-022-32595-4). The release uses CC BY-SA 4.0 and an accompanying HCP acknowledgment. The local package and exported archives preserve the source license, MNI template terms, and full WU-Minn acknowledgment as separate attributed source records.

## Exact source geometry

All 64 probability fields contain 157 × 189 × 136 samples at 1 mm, with RAS origin [-78, -112, -50]. The publisher places them in ICBM 2009a nonlinear asymmetric space. Original corresponding T1/T2 templates have 197 × 233 × 189 samples and origin [-98, -134, -72]. Their exact index subarray starting at [20, 22, 22] has the probability field's original grid.

`native_crop` in the generic independent-region builder selects that contiguous subarray. It records the original shape, affine, zero-based start, shape and correspondence evidence. Every retained value and physical sample position is unchanged. The complete original MRI files remain on the data drive. Registration, interpolation and mesh refinement are absent from this construction.

The binary viewing mask is derived at source probability ≥ 0.20, consistent with the surface display level in the source article's Figure 3. This is an explicit project display convention. The full probability overlay remains available, including positive values outside that mask. Independent memberships are retained: the accepted local build contains 539,495 voxels shared by at least two display masks and a maximum of ten simultaneous memberships.

## Build, study and recover

```bash
neuroimage acquire hcp1065_prob --data-root /path/to/data
neuroimage build hcp1065_prob --data-root /path/to/data --workers 2
neuroimage workspace --data-root /path/to/data --state-root /path/to/ssd/state
```

The original probability archive is 17,353,305 bytes and expands to 18,748,204 bytes. Existing probability files and the already acquired MNI templates are reused. The recipe reserves 8 GiB of construction headroom above the configured HDD safety floor. Two workers bound concurrent volume and surface memory. An unchanged rebuild reuses all 199 assets without recalculating geometry.

Eleven source-grounded lesson sequences cover every field. Four curricula provide 68 views: 22 association, 12 limbic, 26 projection and 8 callosal views. The callosal views alternate the original probability on T1 with the 0.20 mask on T2. Two complete course plans retain all views within the existing portable-content size limit:

- `hcp1065-association-limbic-probability`: 34 views.
- `hcp1065-projection-commissural-probability`: 34 views.

Prepare either with `neuroimage teaching course-prepare PLAN --packages choices.json --data-root /path/to/data`, where the choices file maps `hcp1065_prob` to an exact local package key. The first attempted combined course exceeded 10 MiB; all four completed notebooks were reused by the two final plans. The dated benchmark retains that diagnostic and the preparation receipts.

## Engineering evidence and instructor review

The source verifier checks all original probability arrays, all display masks, both exact MRI subarrays, physical corners, hemisphere assignments and overlapping memberships. Original sample values are identical and maximum reference corner displacement is 0 mm.

Browser acceptance visits all 68 views, compares each of the 64 displayed probability values with its original source voxel, restores four saved scenes, imports their portable scene files and verifies fourteen credited exports. All restored MRI pixels are identical. Sparse transparent-surface rounding affected at most 0.077% of captured pixels; two color channels differed by 2/255 in one comparison, with all other changes at 1/255. The verifier requires exact MRI pixels, at most 2/255 surface differences and at most 0.1% changed pixels. Source geometry and scene bindings are checked independently.

Run `scripts/verify_native_probability_source.py` for source-to-package checks and `scripts/verify_hcp_probability_browser.py` for actual browser readouts and exports. `config/hcp1065-probability-verification-2026-10-14.json` identifies the accepted package and receipts. Instructor judgment is recorded separately and does not contribute to the software-development percentage.
