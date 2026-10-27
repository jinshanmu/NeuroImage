# NextBrain native source readiness

**Archived source inspection: NextBrain is excluded from the current application.** Source definitions, licenses, exclusion and inspection records, and saved-scene records are retained. User-authorized removal of out-of-scope data is documented in the [local data cleanup record](maintenance/local-data-cleanup-2026-10-24.md). Commands and storage statements below describe the earlier inspection and integration state.

This is the preserved 2026-10-13 readiness inspection. The subsequent native 3D block integration is described in [NextBrain native fine anatomy](nextbrain-fine-anatomy.md). That integration reads the original label-volume headers directly and preserves the unresolved differences found in the separate source browser representations.

At the time of this inspection, NextBrain was outside the fifteen installed source configurations and the accepted 0.13.1 inventory remained unchanged. The normal-case decision is recorded in `config/nextbrain-case-scope-2026-10-13.json`; source-correspondence findings are recorded separately in `config/nextbrain-native-readiness-2026-10-13.json`.

## Preserved sources

The inspected author browser repositories are [Case 1](https://github.com/UCL/NextBrain-Case-1/tree/21b097d599fbeae883119c768ff7897dd438d4d2) at `21b097d599fbeae883119c768ff7897dd438d4d2` and [Case 5](https://github.com/UCL/NextBrain-Case-5/tree/91c191c3deddca9ef5393349dc1d55f058599b0e) at `91c191c3deddca9ef5393349dc1d55f058599b0e`. The original case repositories link the UCL research-data deposit. Its existing CC0 evidence remains under `licenses/nextbrain_core/`; the repository representation and pinned URLs are recorded individually. A software repository's license is not substituted for a data source's terms.

Two author browser MRI files, 45 Case-1 MRI-to-histology matrices, two inverse matrices, the Case-1 block-index volume and two original label arrays were acquired for inspection. The 52 files total 16,906,946 bytes, excluding small metadata and literature. Each acquired data file has a verified pinned Git blob identity and a local SHA256. Originals remain under `raw/nextbrain_core/registered_browser/`; receipts remain under `downloads/nextbrain_core/`. No full archive was downloaded or extracted again.

The raw MRI files previously acquired from the deposit remain unchanged. Case 1 uses `P57-16` in both sources. Case 5 uses `EX9-19` in its author browser repository and `EXT9-19` in the raw release. The latter remains a candidate comparison, with an unresolved explicit source alias. The normal-source selection and the exclusion of P85-18 remain unchanged.

## MRI grid and intensity findings

| Source | Raw MRI | Author browser MRI | Header unit declaration |
| --- | --- | --- | --- |
| Case 1 | Float32, 448 × 282 × 224 | Uint8, 226 × 450 × 362 | Raw: mm; browser: unspecified |
| Case 5 candidate | Float32, 324 × 448 × 224 | Uint8, 226 × 450 × 404 | Raw: mm; browser: unspecified |

For both candidates, the matrix formed from their existing headers is within 0.00003 of an integer axis permutation/reversal and offset. This is a numerical header observation. It does not establish a complete processing history or authorize a new registration. All comparisons use that header mapping directly, with no fitted spatial transform or resampling.

Simple global intensity scaling does not reproduce the browser arrays. The sampled nonsaturated correlations were approximately 0.8352 and 0.7176. Case 1 also has 2,694 nonzero browser voxels outside the header-mapped raw extent; Case 5 has none. These values are diagnostic measurements, not acceptance scores for anatomical alignment.

The author's [web material generator](https://github.com/acasamitjana/ERC_reconstruction/blob/074e0b14e6bc8dd9107af43d1d2a8d541b8890a8/webpage/create_material.py#L106) reads a stripped, bias-corrected, RAS-oriented intermediate, applies 99th-percentile scaling, clips and converts to uint8, then applies the source block mask. That code explains why an unprocessed raw scan is not a byte-equivalent input. Its historical source is retained as explanatory evidence; this inspection has not reproduced the complete author's generation pipeline.

The author reports a nominal 0.4 mm MRI acquisition. Actual header sampling includes approximately 0.401786 mm on two raw axes. A future adapter must record both the source protocol and actual sampling, and explicitly resolve the browser header's missing spatial-unit field. Original source declarations remain intact.

## Histology coordinate and version findings

The [author's centroid generator](https://github.com/acasamitjana/ERC_reconstruction/blob/074e0b14e6bc8dd9107af43d1d2a8d541b8890a8/webpage/labels_centroids_json.py#L151) indexes the source array as `slice[xh, yh]`: `xh` is row, `yh` is column, and `zh` is the source slice index. The material generator separately writes image width from array axis 1 and height from axis 0. This convention must be preserved before converting a point to displayed horizontal and vertical coordinates.

Using row/column/slice, all 426 ontology coordinates lie within their declared metadata extents. Of these, 272 MRI/histology pairs agree with the pinned MRI-to-histology matrices within 0.00001 in source index units. Seventy-eight entries use the author's missing-target pattern `(0, 0, 1)`. Another 76 pairs have residuals above half an index unit in blocks 9, 13, 16 and 34. These unresolved pairs remain recorded individually on the data drive; coordinates have not been recomputed to make them agree.

The original inverse pairs for blocks 1 and 13 agree numerically, with maximum residuals of about 2.27e-13 and 1.11e-16. This verifies matrix inversion for those two pairs, separately from the ontology differences and biological correspondence. The block-index and browser MRI shapes match; their affine coefficients differ by at most 0.000022889, which remains recorded rather than silently replaced.

Two original label arrays give an additional version check:

| Block and slice | Actual source array, rows × columns | Metadata height × width | Result |
| --- | --- | --- | --- |
| 1, slice 08 | 896 × 689 | 896 × 689 | Matches |
| 13, slice 19 | 393 × 374 | 353 × 345 | Source metadata and array differ |

The first draft check treated `xh/yh` as display horizontal/vertical coordinates and reported 53 apparent extent failures. That interpretation was corrected after inspecting the original generation code. The draft receipt is retained with this explanation. The current row/column result is under `benchmarks/nextbrain_core/native-readiness-20261013/reproduced/`.

## Bounded adapter continuation

1. Start with a selected normal case and a small, explicitly consistent native block. Keep raw scanning, author-processed MRI, registered histology and source labels as distinct representations.
2. Record original numeric label definitions and stable source IDs. The hierarchy file's English display names and grouping alone do not establish a numeric-label crosswalk.
3. Resolve source version relationships for the selected block using actual array dimensions, the matching original matrix pair and the original label/value definition. Treat missing-target sentinels as source coverage metadata.
4. Establish the MRI unit interpretation from source evidence. Apply only the documented source transforms; preserve separate native browsing wherever correspondence remains unresolved.
5. Preserve uneven histological sampling, original missing sections, registration provenance and the distinction between direct sections and reconstructed/interpolated labels.
6. Declare implementation milestones for construction, interruption recovery, original-value checks, linked browsing, scene/export recovery and installed use. Anatomical instructor assessment remains a separate record.

No NextBrain source was promoted into a local atlas in this inspection. This work does not add a development denominator or change the completed software milestones.

## Reproduce the inspection

Use the dedicated environment with the preserved acquisition receipts and original files:

```bash
conda activate NeuroImage
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/inspect_nextbrain_native.py \
  --data-root "$ATLAS_DATA_ROOT" \
  --inspect-case-1-transforms \
  --output benchmarks/nextbrain_core/native-readiness-repeat
```

The utility performs read-only source checks and writes numerical receipts under the selected data-drive output directory. It makes no network requests and constructs no atlas. Use a fresh output directory to retain earlier diagnostic receipts. It requires the existing MRI acquisition receipt plus the transform, inverse-matrix and original-slice receipts documented in the readiness record. The measured MRI inspection used approximately 347 MiB peak resident memory; the additional transform inspection is small. Storage preflights reserved 64 MiB for the two compressed MRI files, 128 MiB for the small transform/index acquisition including filesystem allocation, and 8 MiB for the two original arrays, each against the configured 400 GiB remaining-space floor.

This inspection utility was added after the immutable 0.13.1 archives were accepted. The 0.13.2 source archive includes the utility and this guide; all source data and acquisition receipts remain separate. Use the retained accepted source archive when reproducing a specific software version's exact hashes.
