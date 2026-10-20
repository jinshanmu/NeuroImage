# SUIT cerebellar lobules and deep nuclei

This source guide includes historical teaching-validation records. Curricula, lessons and course workflows described here are retained in `codex/release-testing`; the formal release exposes the same source anatomy through [Browse anatomy](getting-started.md).

The `suit_cerebellum` recipe constructs all 34 original anatomical compartments from the [DiedrichsenLab cerebellar atlas collection](https://github.com/DiedrichsenLab/cerebellar_atlases/tree/6857dfa732de6dd60c94da2f84d0b15ccf316618), pinned to commit `6857dfa732de6dd60c94da2f84d0b15ccf316618`. The original SUIT T1 template, categorical assignments and 34 continuous probability channels share the publisher's SUIT physical coordinate frame. They provide hemispheric lobules, vermal compartments and bilateral dentate, interposed and fastigial nuclei.

The source combines lobules I–IV. Its interposed assignment combines emboliform and globose nuclei. These groupings remain intact. Lobular fields describe 20 healthy young participants; nuclear fields describe a separate 23-participant group. The source nuclear delineations use susceptibility-weighted 7 T images; the displayed T1 is the population template that provides shared spatial context. See the [source description](https://diedrichsenlab.org/imaging/propatlas.htm) and the retained original atlas descriptor.

## Native geometry and source meaning

Each spatial grid has 141 × 95 × 87 samples at 1 mm. The T1 array increases in the R direction from origin [-70, -100, -75]. Labels and probability arrays decrease in that direction from [70, -100, -75]. The project retains both original array orders and affines. Label index `[i, j, k]` corresponds physically to T1 index `[140-i, j, k]`. Exhaustive native sample-coordinate comparison gives 0 mm error. No image reflection, resampling or registration is performed.

The publisher's numeric TSV supplies the names and colors. Each explicit probability channel is linked to the corresponding numeric source label. Complete source comparison verifies that the linked channel attains the maximum at every assigned categorical voxel and has the unique greatest mean probability within its compartment. One original quantization tie explains a difference from first-channel `argmax`. A simple inclusive 0.25 maximum-probability reconstruction differs at 198 voxels, so the original categorical map is retained independently.

The source stores probabilities as unsigned bytes with float32 scale `0.003921568859368563`. The resulting maximum is `1.0000000591389835`. All scaled values are retained. A declared `1e-7` encoding tolerance covers this original header precision; probabilities are neither clipped nor normalized. Separate lobular and nuclear cohorts remain explicit, and their fields need not sum to one.

The source's small Vermis Crus I assignment contains 27 categorical voxels and has a centroid offset of approximately -3.15 mm in RAS X. The original extent crosses the midsagittal plane and is preserved. A source vermal name is not converted into an artificial symmetric region. Expert assessment of these small assignments remains separate from geometry verification.

The original nuclear grayscale colors were dark against the viewer background. A declared teaching palette uses gold for dentate, turquoise for interposed and rose for fastigial compartments. Each original RGB value remains in the structure provenance alongside its display RGB and rationale. The source TSV, assignments, probability arrays and geometry remain exact. The initial low-contrast exports are retained in the dated display-revision diagnostic.

## Acquire, build and teach

```bash
neuroimage acquire suit_cerebellum --data-root /path/to/data
neuroimage build suit_cerebellum --data-root /path/to/data --workers 4
neuroimage workspace --data-root /path/to/data --state-root /path/to/ssd/state
```

The three original image files total 43,119,561 bytes. Four small source descriptors and license files accompany them. There is no archive expansion. The recipe reserves 4 GiB of construction headroom above the configured HDD floor. An unchanged build reuses all 73 assets.

Three curricula contain 40 views: 20 hemispheric lobular views, eight vermal views and 12 nuclear views. Nuclear views alternate original probability and categorical overlays. Revised presets show opaque nuclear groups from an inferior camera direction, with a full T1 context followed by same-point enlargement. The existing **3D anatomy** and **Fit visible 3D** controls provide a complete standalone nuclear view. All views retain the accepted three-MRI-plus-3D row. The course plan `suit-cerebellar-fine-anatomy` binds all views to an explicitly selected package:

Open the matching source through **Browse anatomy**; use the [current browser guide](getting-started.md) for display and scene controls.

The choices file maps `suit_cerebellum` to its local package key. Interrupted preparation reuses completed notebooks. Saved scenes and credited exports retain native coordinates, source identities, processing records and license text.

## Verification and attribution

`scripts/verify_suit_native_sources.py` checks original arrays, each probability channel, TSV identities, hemisphere assignments, the complete physical-coordinate mapping and the original scale precision. `scripts/browser_suit_cerebellum.js` (testing branch) exercises all 40 views, source probability readouts, saved-scene restoration, portable import and credited export. `scripts/verify_suit_browser.py` compares those actual readouts with original 4D source samples and verifies restored image pixels and export bindings.

The retained specific `tpl-SUIT/LICENSE` covers the SUIT template, associated files and atlases under CC BY-NC 3.0. It accompanies every local package and teaching export. Cite Diedrichsen (2006), *NeuroImage* 33:127–138; Diedrichsen et al. (2009), *NeuroImage* 46:39–46; and Diedrichsen et al. (2011), *NeuroImage* 54:1786–1794. The software distribution contains the adapter and recipes; users acquire their own source data. Engineering acceptance and instructor review are recorded separately.
