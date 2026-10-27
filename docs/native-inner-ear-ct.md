# Original temporal-bone CT and fluid-space labels

**Archived source guide: this dedicated otology dataset is excluded from current acquisition, construction, discovery and opening.** Source definitions, licenses, exclusion and inspection records, and saved-scene records are retained. User-authorized removal of out-of-scope data is documented in the [local data cleanup record](maintenance/local-data-cleanup-2026-10-24.md). Commands, source-preservation statements and validation results below describe the former implementation. Named cochlear and vestibular structures within MIDA and Z-Anatomy remain enabled.

This source guide includes historical teaching-validation records. Curricula, lessons and course workflows described here are retained in `codex/release-testing`; the formal release exposes the same source anatomy through [Browse anatomy](getting-started.md).

`inner_ear_ct_specimen1` uses original specimen 1 from Dataset A of
[Human Inner Ear Anatomy](https://zenodo.org/records/8277159), version 1.0.
The [associated study](https://doi.org/10.1038/s41598-023-45466-9) distinguishes
43 cadaveric Dataset A specimens from the separate clinical Dataset B. Only the
selected Dataset A specimen is used here. Original data and all derived atlas
assets remain on the configured data drive, outside software distributions.

## Acquisition and construction

Use the dedicated `NeuroImage` environment. HDF5 construction has one optional
dependency, also used by the original-source inspection utility:

Open the matching source through **Browse anatomy**; use the [current browser guide](getting-started.md) for display and scene controls.

The package declares an `hdf5` extra for compatible installations. For this
unpublished candidate, install the supplied wheel and the pinned optional lock
above; no package-index publication is assumed. The common acquisition command
verifies the 530,856,520-byte original against its pinned SHA256 and retains the
publisher's CC BY 4.0 declaration. Small publisher metadata snapshots may change
without changing the source release; their actual bytes and hashes become part
of each constructed package identity.

## What the atlas contains

- Original `raw/raw-0` CT integers and paired `label/label-0` categorical samples.
- All three original non-background classes: `Cochlea`, `Vestibulum`, `Canals`.
  Source names, label values and colors are verified against HDF5 attributes.
- Full native 512 × 512 × 405 IJK grid, explicit source directions and origin.
- Unsmoothed surfaces of the three categorical half-voxel boundaries.
- Linked CT sections, source-label overlays, individual visibility and opacity,
  structure targeting, saved scenes, attributed teaching exports and a six-view
  editable teaching notebook, using the same workflows as other sources.

The source's LPS coordinates are converted to RAS by an explicit basis change.
No resampling, reorientation of the array axes, registration, smoothing,
subdivision or source-value calibration is applied. Original HDF5 files remain
unchanged. The reader rejects external links, soft links, virtual or external
datasets, conflicting paired grids and undeclared spatial conventions.

Schema 1.10 adds `ct-labels` and explicit image acquisition evidence. A CT package
must declare its modality, original source array, intensity interpretation,
acquisition and reconstructed sampling. Its original image and labels must
share the same native grid. The browser and attributed exports identify CT
explicitly, including the limits of its intensity calibration.

## Interpretation and retained limits

The original grid spacing is approximately 0.0986 mm. The publication reports
0.466 mm acquired slice thickness; reconstructed sampling is not equal to
acquired spatial resolution. The publication describes HU reconstruction, but
the original HDF5 image has no explicit intensity-unit or calibration
attributes. The viewer therefore reports original source CT values.

These three labels describe fluid-space classes. They do not independently
partition cochlear turns, the three individual semicircular canals, the
membranous labyrinth, nerves or sensory epithelia. Specimen laterality is not
declared in the source HDF5 file and remains unspecified.

The source also contains three attribute-only landmark records. Their supplied
IJK and LPS positions disagree beyond half the reconstructed voxel diagonal in
the original inspection. Both records remain in the unchanged source file, but
they are not promoted to verified teaching markers. Structure targets instead
refer to actual member voxels of the original labels. New teaching sequences
retain `draft_not_expert_reviewed` status.

## Geometry verification

Construction compares every saved image and label sample with its original
array. The manifest retains the original float64 affine; NIfTI-1 serializes an
sform in float32. Validation checks this serialized grid against the manifest,
then uses the retained original affine for target and surface correspondence.
This avoids treating NIfTI header rounding as source geometry change at fine
sampling. The categorical 0.5 boundary tolerance is unchanged. Regression
coverage includes a rotated submillimeter grid far from the coordinate origin,
as well as anisotropic axes, source-name mismatches, indirect HDF5 samples,
modality errors and resumed construction.
