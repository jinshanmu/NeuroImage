# Source-bound instructor review queue

`neuroimage review queue` gathers existing notebook review packets into one local, offline page. It does not copy images, merge source spaces or infer a judgment from an engineering check. Every case carries its package, packet and original case ID, together with the exact full-view and optional magnified-image hashes.

```bash
conda activate NeuroImage
neuroimage review queue --data-root "$ATLAS_DATA_ROOT" \
  --packet "$ATLAS_DATA_ROOT/benchmarks/source-a/notebook-review-<version>" \
  --packet "$ATLAS_DATA_ROOT/benchmarks/source-b/notebook-review-<version>"
```

Open the returned `exports/review-queues/<identity>/index.html`. Filter by source, review status or complete case ID. Each view starts with the complete available image and shows the same-point enlargement when the original packet supplies one. The detailed packet remains linked for a separate per-criterion assessment.

Enter the reviewer's name or role, then record preliminary teaching suitability and observations for each exact case. A requested revision or unresolved judgment requires explanatory notes. The browser attempts to preserve a local draft; **Export review JSON** is the portable recovery copy. **Import saved review** checks the queue identity, case inventory and image hashes before replacing the current draft. Keep an exported copy before changing browsers or clearing browser storage.

```bash
neuroimage review check-suitability review.json \
  --queue "$ATLAS_DATA_ROOT/exports/review-queues/<identity>" \
  --data-root "$ATLAS_DATA_ROOT"
```

This command also checks the original packet and image files. A successful result verifies record identity and format, not anatomical correctness or reviewer qualifications. Preliminary suitability does not imply that every anatomical criterion was independently assessed. Expert review is excluded from the software engineering completion denominator.

## Current local collection

`config/local-review-queue-integration-2026-10-13.json` records the current 82-view, fifteen-packet queue. It adds the two original views for enlarged CA1 revision JUL-20261013-01 and the two original foramen-magnum views for ZFM-20261013-01. Both conversation cases await instructor feedback. Their notebooks also appear in the ordinary teaching library with exact original source bindings. Search the review queue for `julich_selected:ce83e9c43c24` or `z_anatomy:c167701dc1d4` to open those images. Click any review image to open its full size.

The 78-view, thirteen-packet predecessor remains recorded in `config/local-review-queue-complete-sections-2026-10-13.json`, and the earlier 63-view queue remains preserved in `config/local-review-queue-expansion.json`. Fifteen existing cases across HBA, meso-vein MRI, VENAT and the healthy skull mask each include a complete source section and same-point magnification. Two exact earlier cases have owner feedback: `spl_nac:0238ca47834e:NI-N001` and `brainstem_navigator_mni:0759886159df:NI-N001`. Those responses were carried forward only after exact case and image-hash equality. The owner subsequently requested revision of `mug500_healthy:3a9be98a75eb:NI-N001` (MUG-20261013-01): too many scattered points; not suitable. That exact pair is not accepted for teaching. The current queue therefore retains two preliminary suitable cases, one requested revision and 79 views awaiting review. The source-bound owner response file is retained beside each queue as `owner-feedback-2026-10-13.json` and can be imported independently of browser storage.

The source packets and review exports stay on the data drive. The public software contains only the queue implementation, template and documentation.

## Complete sections before reviewer magnification

A teaching sequence can deliberately contain both full and enlarged recorded views. For a review collection, select its existing 1x scenes so every review case starts with global context. The repository helper preserves each selected scene's source binding, cursor and annotations:

```bash
python scripts/prepare_review_context.py /path/to/exported-notebook.json --data-root /path/to/data
```

The helper writes a separate deterministic review notebook under `exports/<source>/context-review-<original-book-id>`. It refuses to overwrite changed content and does not alter the original teaching notebook. Import this review notebook into its exact atlas, select **Present notebook**, export each recorded full view as `view-N.zip`, then use **Magnify at cursor** and export `view-N-magnified.zip`. Use **Return to recorded view** before moving to the next case. Export the review notebook beside these captures, then run `neuroimage review notebook` and `neuroimage review queue` as above.

For repeatable development capture, `scripts/browser_observation_review.js` drives those visible controls in an existing Playwright session. Supply completed preparation job IDs through a `review-jobs` URL query and prepare each review notebook first. Run browser tasks sequentially when they share one tab. These repository capture helpers are separate from the accepted 0.11.0 runtime archives; the installed application already supplies all interactive and review-assembly operations.
