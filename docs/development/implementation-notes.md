# Implementation decisions and diagnostic record

## Source trajectory decoding and pinned renderer corrections

The first streamline increment uses independently decoded TrackVis v2 headers and NiBabel's RAS-mm streamlines. Supported headers must declare a nonsingular affine, compatible voxel order, positive dimensions and explicit counts. Unhandled scalar/property fields or legacy swap flags are rejected rather than silently dropped. Every point, streamline boundary and source order is retained in a canonical TCK asset. Display levels select whole trajectories with explicit original indices; no point simplification, smoothing or tube radius is introduced.

Inspection of the pinned NiiVue 0.69.0 TCK loader found that its first delimiter overwrites the initial zero offset. This loses the first trajectory from rendered line indices. The project uses an explicit canonical TCK decoder and tests both the first and last trajectory. Inspection also found that the library's final fiber pass draws hidden fiber VAOs and applies only a global alpha. A small renderer subclass therefore draws fibers with explicit per-bundle visibility and opacity, using the unchanged physical camera and section clip matrices. These corrections remain local to the project and do not modify the installed dependency.

The physical section control specifies total slab width; the pinned clip matrix expects a half width. Rendered segments are clipped to the declared slab, never projected from the entire bundle onto an unrelated section. Fixed bundle colors have zero random dither, enabling deterministic scene recovery. Source figures and teaching images retain the sampling level and slab width.

## Native space and source declarations

SPL/NAC January 2017 contains 1 mm MRI with origin `[-127.5, -127.5, 127.5]` in LPS and labels with origin `[-128, -128, 128]`. Both affines are retained independently. There is no corrective registration. The source defines their same-volunteer correspondence; an engineering check cannot establish the accuracy of all label boundaries.

The selected MNI/CerebrA NIfTI files omit the spatial unit field. The source explicitly documents the 2009c symmetric grid at 1 mm. The recipe records that declaration and the importer logs that the unit came from source documentation. Other undeclared units remain rejected. Source: https://www.bic.mni.mcgill.ca/ServicesAtlases/ICBM152NLin2009 .

SPL lookup names and its separate enriched metadata table differ for some structures. The adapter keeps the lookup-table name and records conflicts. Four explicit label unions provide cerebellar and thalamic navigation, with every source value recorded. No absent value produces new voxels. These are computed groups, not newly delineated structures.

## Mesh extraction invariant

The first prototype used Lewiner marching cubes and incorrectly assumed that every generated vertex must sample to exactly 0.5 in the trilinearly interpolated binary mask. Ambiguous cases can add cell-interior vertices, so this invariant failed on real source structures. The current recipe uses the Lorensen edge-intersection variant with the explicit half-voxel level set check. No smoothing, decimation or topology repair is performed. Ambiguous topology remains a documented limitation; these tests do not establish anatomical continuity. The failed checkpoint signature is `ba9bf6b9e2af7359` and remains a reproducible diagnostic reference until temporary output cleanup.

## Viewer rendering boundary

The application pins NiiVue 0.69.0. Its public options do not independently hide a volume in 3D while retaining normal 2D MRI rendering. A small renderer subclass gates `drawImage3D`, allowing opaque label surfaces to be inspected without an occluding whole-head volume. The optional 3D MRI context restores the original renderer. This hook requires browser regression checks when updating NiiVue.

## Resource use

Build workers are bounded to 1–8 (default 4). Structures are processed with a shared source volume and cropped, padded binary masks; GPU acceleration is not needed for these small preparations. The viewer loads surfaces on demand and evicts hidden surfaces beyond a 32-surface warm cache. Compression and original voxel resolution are retained. Source data remain on HDD; no new imaging download was required.

## Sparse categorical values and WebGL

The first real browser run exposed a texture-size error: categorical values up to 60004 require a palette wider than the tested WebGL maximum if used directly as texture indices. The renderer now compacts the in-memory palette to one entry per structure, with a reversible mapping to source values. Files, affines, geometry and structure IDs are unchanged. Dedicated tests verify the exact inverse mapping for sparse high values. The renderer checks the GPU palette limit before displaying a package. A related event feedback loop was fixed by serializing asynchronous loads, ignoring unchanged location events and updating GPU volume textures only when their content or display mapping changes.

## Probability readout timing

A browser fixture initially sampled the probability readout immediately after changing MRI contrast. The previous Ready message could still be visible before the asynchronous channel reload began, producing a nonnumeric sample. The channel finished normally. The fixture now waits for a numeric channel readout and reports an explicit error for missing values; independent native-NIfTI comparison remains the acceptance criterion. This diagnostic concerns test synchronization, not a change to source values or anatomical inference.

## Sequential probability decoding

A local CIT168 profile found repeated source reopening dominated initial construction. Reading and hashing all 16 channels took 48.15 seconds with separate file proxies and 10.93 seconds with one persistent proxy, with identical per-channel hashes. `NiftiFrameReader` now uses NiBabel's public `keep_file_open=True` option and the same scalar/affine checks as ordinary reads. Its context releases the proxy after normal or interrupted processing. No 4D data cache, raw expansion, interpolation or numeric conversion is introduced. See the [NiBabel ArrayProxy API](https://nipy.org/nibabel/reference/nibabel.arrayproxy.html).

Full local construction decreased from 63.30 to 25.63 seconds; peak resident memory changed from 641,596 to 642,624 KiB. All 38 package assets were byte-identical, and repeat construction took 0.25 seconds with no geometry recomputation. These are single warm-filesystem observations. The package version changes conservatively because the construction implementation changed. Earlier packages remain preserved for their saved-content bindings. The quantitative receipt is `config/streaming-probability-verification.json`.

## Spatial display controls

Individual surface opacity is a display multiplier applied to the overall 3D opacity. It leaves categorical and probability slice textures unchanged. Zero-opacity meshes are excluded from visible-boundary selection. Search/category actions use the current source catalogue and do not create cross-source anatomical equivalences.

Optional section guides are intersections between world-RAS section planes and the source voxel field of view, including half-voxel outer faces and the actual affine. Oblique fields can yield polygons with more than four corners. The guides contain no image texture or tissue geometry. They use the pinned NiiVue 0.69.0 physical camera matrix and depth buffer, skip depth-picking passes, and never write depth. A dedicated shader restores the GL state and releases its resources with the workspace. The public renderer API is documented at https://niivue.com/docs/api/niivue/classes/Niivue/.

The first browser acceptance run reached correct SPL/NAC display captures, then its fixture waited for a Ready message after saving. The application correctly reported Scene saved instead. The fixture now accepts completed save/export status before checking stable frames. Initial pixel comparison already found zero 2D changes from individual opacity or guides and a visible 3D-only change. This is a test synchronization diagnostic, not source or geometry failure.

The spatial fixture then found five changed 3D guide-edge pixels after restoring the oblique MIDA view. The source cursor had been converted from application RAS to the renderer's float32 fractional coordinates and back during capture. Scene capture now preserves the physical application cursor already updated by renderer location callbacks. The render input is therefore identical before and after restoration, with no coordinate quantization added to the atlas or annotations. The failing receipt is retained locally; the corrected three-source pixel check is recorded separately.

## Independent-region development findings (0.6.0)

The source PAG binary mask includes 38 voxels whose probability equals 0.35; a strict-greater-than implementation is incorrect. The twelve selected source masks retain fourteen dual-membership voxels, so an argmax categorical layer was rejected. Scalar probabilities and binary memberships remain separate.

Real-browser inspection showed that the original volume-centered 3D pivot pushed small inferior structures out of view when magnified. An optional physical `focus3D` now changes only the renderer rotation center. Actual GPU mesh digests, depth-picked source coordinates and restored pixels verify this behavior. A pending streamline selection refresh also survives superseded asynchronous loads rather than disappearing when an unrelated state change arrives.

During source-voxel teaching preparation, an initial coordinate variable shadowed the output-file target. Regression fixtures detected the error before delivery; distinct coordinate and artifact variables now preserve both source samples and notebook reuse. The local diagnostic test log was retained without copying raw source data.

Independent comparison of all six installed teaching exports detected a missing prepared membership list at the overlapping PAG/DR source voxel. The browser correctly recomputed both memberships, but this differed from the prepared scene's empty evidence list. Preparation now samples each visible source mask at the recorded physical location and stores all memberships in stable order. Regression fixtures cover simultaneous memberships, a hidden region, and positive probability outside every binary mask. The source coordinates, image values and surfaces are unchanged.

The instructor rejected a local-only magnified review view because it omitted global section context. New workspaces, independent-region review scenes and the six-view brainstem curriculum now start with the complete supplied image field of view. Full sections and Magnify at cursor are prominent controls; returning the 2D zoom to 1 also restores full sections. The source cursor and selected structure remain fixed while the physical projection changes. Earlier local-only images and their scoped feedback remain preserved for traceability, without anatomical acceptance being inferred.

At the full-section teaching layout, returned and reimported translucent 3D views differed at seven and three pixels respectively, by one 8-bit intensity level; all MRI sections and serialized scene fields were identical. The acceptance checker records these counts and permits at most 32 such pixels confined to the 3D quadrant, with no tolerance for source values, coordinates or MRI-section pixels. The exact source/GPU mesh digest checks remain unchanged.

The streamline browser fixture originally used fixed screen coordinates. Full-section controls changed the canvas layout, so pointer locations now follow observed source projections in 2D and actual source-colored composited pixels in 3D. A projected 3D segment alone does not prove visibility at its screen position. Directly reading the canvas after presentation also produced an empty buffer because `preserveDrawingBuffer` is false; the fixture now inspects the composited screenshot. Independent original-TRK distance and pixel checks still determine acceptance. Small failing logs and the diagnostic image remain local.

The updated six-package server starts with the brainstem package. After page reload, the streamline fixture initially attempted to import its saved scene into that default package. The viewer correctly rejected the different source binding; the independent image-size check caught the fixture error. The fixture now explicitly reselects its exact HCP package before importing and requires that no import alert remain.

## Native MRI resource ownership

The pinned NiiVue 0.69.0 `loadVolumes` replaces its active volume list but leaves older NVImage keys in a strong URL map. Repeated background changes therefore retain complete original arrays after garbage collection. The project renderer removes retired image references while preserving mesh references and compacts document option indices after overlay removal. No image values or geometry change.

In a 24-switch two-contrast Brainstem Navigator fixture, Chromium CDP backing storage after explicit garbage collection grew from 117,316,079 to 2,890,192,468 bytes before this fix. With the fix it remains 117,314,686 bytes after warmup, with zero growth over the remaining 20 switches. The physical cursor and returned complete canvas are identical. These measurements exclude GPU textures and driver allocations. `scripts/browser_volume_memory.js` reproduces the bounded acceptance; the before/after diagnostic receipts remain in `config/volume-memory-before.json` and `config/volume-memory-after.json`.
