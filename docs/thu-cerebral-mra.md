# Healthy-volunteer cerebral MRA and arterial segments

Eight local source recipes now pair original MRA with author-provided semantic vessel segments. The first three were `thu_mra_case009`, `thu_mra_case001` and `thu_mra_case030`. Those three contain 20, 17 and 19 nonzero source values, respectively. The [normal-variation expansion](detailed-anatomy-and-variation.md) adds cases 006, 007, 010, 014 and 021, giving eight cases and 151 source-specific segment entries in total. The common acquisition retains one shared 1,198,822,695-byte archive and extracts only the selected case files. Existing original files are verified and reused.

The [publisher dataset page](https://ivg.au.tsinghua.edu.cn/dataset/Cerebral-MRA/Cerebral-MRA.html) describes 109 healthy UNC volunteers and permits noncommercial research and educational use. Preserve that exact permission notice and cite Tan et al., *Computerized Medical Imaging and Graphics* 114 (2024), 102364, [doi:10.1016/j.compmedimag.2024.102364](https://doi.org/10.1016/j.compmedimag.2024.102364). The study's other clinical cohorts are separate from this public healthy-volunteer archive. The paper reports 104 public cases in its semantic experiments, whereas the downloaded archive contains 109 image/label pairs; the acquisition inventory records the delivered files without assigning an undocumented experimental inclusion flag.

## Source geometry and representation

Each supplied image and label has 192 × 160 × 96 samples at 0.513393 × 0.513393 × 0.799999 mm. The publisher performed rigid preprocessing and cropping. These exact source values, origin, direction and spacing are retained. The source frame has a cropped local origin, so the sign of a coordinate alone does not identify a hemisphere. Each case has a distinct space ID.

The generic `source-mri-label-volume` adapter uses explicit source values and source evidence. Self-contained MetaImage files are read with the verified SimpleITK 2.5.6 runtime. Z,Y,X array storage becomes X,Y,Z indexing; the LPS-to-RAS basis conversion retains every physical point. Millimeter units require an explicit recipe declaration. NIfTI export preserves original scalar values. The source labels remain discrete, and the 3D boundary is extracted at half-voxel level. The complete MRI and categorical arrays are compared with the originals after construction.

The delivered preprocessed Slicer FCSV files contain 20 points. The website describes 19 landmarks and its figure uses a different numbering convention. The original point IDs remain unchanged. Original-acquisition FCSV coordinates are archived separately; no transform to the original UNC scans or another atlas is inferred.

## Arterial name correspondence

The archive supplies numeric segment values rather than a textual numeric-to-name lookup table. `src/neuroimage/catalogs/thu-cerebral-mra-segments.json` therefore explicitly records a **project correspondence**, based on the author's arterial diagram, source MRA, categorical topology and delivered landmark endpoints. Original numeric IDs remain in structure names and provenance. The correspondence includes bilateral ACA A1/A2, MCA M1, posterior communicating artery, PCA P1/P2A and ICA C5/C6/C7 courses, with anterior communicating and basilar segments.

For the first three constructed cases, distances from the proposed original endpoint points to their associated label voxel centers range up to 1.600 mm. This supports a geometric relationship but does not independently establish all artery names or segment definitions. Engineering checks and instructor interpretation have separate receipts. Exact-case introductory suitability does not approve the full numeric correspondence catalog.

Twenty-one of the 109 delivered cases contain all twenty nonzero values. The remaining cases have varying source annotation coverage. The observation course compares actual MRA signal with that coverage. An absent label is recorded as an absent source value; a named normal anatomical variant requires separate image interpretation and instructor evidence. No case is assigned agenesis, hypoplasia or a fetal configuration by an automated label-count rule.

## Reproduce and use

Activate the dedicated NeuroImage environment, then run:

```bash
neuroimage acquire thu_mra_case009 --data-root /path/to/data
neuroimage build thu_mra_case009 --data-root /path/to/data --workers 4
neuroimage workspace --data-root /path/to/data --state-root /path/to/ssd/state
```

Repeat the same commands for cases 001 and 030. The source archive expands to approximately 1.205 GB if fully extracted; each selected case requires approximately 11 MB of original files. Construction reserves 2 GiB per case above the configured HDD safety floor. The pinned software runtime closure includes SimpleITK. No new registration or interpolation step is required.

Open **Cerebral MRA** in the anatomy workspace. The three source-bound curricula contain four observation groups and eight views per case. The course `thu-mra-arterial-observation` organizes all 24 views. Prepare it with an explicit package mapping using `neuroimage teaching course-prepare`, or use the existing teaching workspace controls. Scene exports bind the exact package, source coordinate frame, view settings and attribution.

`verify_thu_mra_source.py` compares original MHA samples, independent SimpleITK physical points, paired grids and original FCSV coordinates. `browser_thu_mra.js` exercises all views, saved-scene restoration, portable import and teaching exports through the accepted frontend. `verify_fine_anatomy_browser.py` checks restored MRI pixels and archive attribution. The local dated benchmark folder contains full results; acquired data and derived packages remain outside software distributions.

## Image clarity and source projections

The October 14 instructor response requested clearer review images. Revised presets use the complete opaque arterial context, an inferior 3D camera, source intensity window 0.5–11, and section-label opacity 0.16. All 24 revised views passed native-position, saved-scene, portable-import and attributed-export checks. Original rejected captures and superseded notebooks remain in the dated benchmark history. The current course ID is `e3a0d26c-8ed7-53b7-94a7-813f99373b3e`.

For a continuous source-signal overview, `scripts/export_native_mra_projection.py` computes an axial maximum-intensity projection directly from a declared original slice interval. It records the complete provenance, slice indices, physical slab edges, selected source label, intensity window and image hash beside the PNG. The figure labels its computed projection and overlapping depths. It retains native X,Y samples with nearest-sample display. The case 009 review uses original slices 18–63 and a separate complete inferior 3D view at zoom 2.0. Both show anterior toward the top and the source right side on the left. The exact-image instructor record is separate from engineering acceptance.

```bash
python -m pip install -r requirements-teaching.lock.txt
python scripts/export_native_mra_projection.py \
  --manifest /path/to/data/derivatives/thu_mra_case009/PACKAGE/manifest.json \
  --output /path/to/data/exports/thu_mra_case009/native-mip.png \
  --first-slice 18 --stop-slice 64 --selected-value 1
```

The optional projection utility is included in the software source archive. Its Matplotlib dependency closure is pinned in `requirements-teaching.lock.txt`; install it in the dedicated NeuroImage environment. Ordinary atlas construction, browsing and the browser's credited image export use the core runtime.
