# Healthy-volunteer cerebral MRA and arterial segments

This source guide includes historical teaching-validation records. Curricula, lessons and course workflows described here are retained in `codex/release-testing`; the formal release exposes the same source anatomy through [Browse anatomy](getting-started.md).

All 109 delivered volunteers have source recipes, `thu_mra_case001` through `thu_mra_case109`, pairing original MRA with author-provided semantic vessel segments. Their actual nonempty inventories contain 2,027 source-specific segment entries. The original eight recipes (001, 006, 007, 009, 010, 014, 021 and 030; 151 entries) remain unchanged; the other 101 cases add 1,876 entries. A per-case catalog records source hashes, physical grids, label voxel counts and delivered landmark IDs. The common acquisition retains one shared 1,198,822,695-byte archive and extracts only the selected case files. Existing original files are verified and reused.

The [publisher dataset page](https://ivg.au.tsinghua.edu.cn/dataset/Cerebral-MRA/Cerebral-MRA.html) describes 109 healthy UNC volunteers and permits noncommercial research and educational use. Preserve that exact permission notice and cite Tan et al., *Computerized Medical Imaging and Graphics* 114 (2024), 102364, [doi:10.1016/j.compmedimag.2024.102364](https://doi.org/10.1016/j.compmedimag.2024.102364). The study's other clinical cohorts are separate from this public healthy-volunteer archive. The paper reports 104 public cases in its semantic experiments, whereas the downloaded archive contains 109 image/label pairs; the acquisition inventory records the delivered files without assigning an undocumented experimental inclusion flag.

## Source geometry and representation

Each supplied image and label has 192 × 160 × 96 samples at 0.513393 × 0.513393 × 0.799999 mm. The publisher performed rigid preprocessing and cropping. These exact source values, origin, direction and spacing are retained. The source frame has a cropped local origin, so the sign of a coordinate alone does not identify a hemisphere. Each case has a distinct space ID.

The generic `source-mri-label-volume` adapter uses explicit source values and source evidence. Self-contained MetaImage files are read with the verified SimpleITK 2.5.6 runtime. Z,Y,X array storage becomes X,Y,Z indexing; the LPS-to-RAS basis conversion retains every physical point. Millimeter units require an explicit recipe declaration. NIfTI export preserves original scalar values. The source labels remain discrete, and the 3D boundary is extracted at half-voxel level. The complete MRI and categorical arrays are compared with the originals after construction.

The delivered preprocessed Slicer FCSV files contain 20 points. The website describes 19 landmarks and its figure uses a different numbering convention. The original point IDs remain unchanged. Original-acquisition FCSV coordinates are archived separately; no transform to the original UNC scans or another atlas is inferred.

Twelve delivered points fall outside the cropped image in five cases: 002 (three), 003 (two), 005 (five), 012 (one) and 079 (one). Their original coordinates and crop-external indices are retained in the case catalog and package provenance. They are not moved, clamped or reconstructed. The engineering verifier distinguishes these explicitly inventoried source limitations from an unexpected coordinate mismatch.

## Arterial name correspondence

The archive supplies numeric segment values rather than a textual numeric-to-name lookup table. `src/neuroimage/catalogs/thu-cerebral-mra-segments.json` therefore explicitly records a **project correspondence**, based on the author's arterial diagram, source MRA, categorical topology and delivered landmark endpoints. Original numeric IDs remain in structure names and provenance. The correspondence includes bilateral ACA A1/A2, MCA M1, posterior communicating artery, PCA P1/P2A and ICA C5/C6/C7 courses, with anterior communicating and basilar segments.

For the first three constructed cases, distances from the proposed original endpoint points to their associated label voxel centers range up to 1.600 mm. This supports a geometric relationship but does not independently establish all artery names or segment definitions. Engineering checks and instructor interpretation have separate receipts. Exact-case introductory suitability does not approve the full numeric correspondence catalog.

Twenty-one of the 109 delivered cases contain all twenty nonzero values. The remaining cases have varying source annotation coverage. The observation course compares actual MRA signal with that coverage. An absent label is recorded as an absent source value; a named normal anatomical variant requires separate image interpretation and instructor evidence. No case is assigned agenesis, hypoplasia or a fetal configuration by an automated label-count rule.

## Reproduce and use

Activate the dedicated NeuroImage environment, then run:

```bash
neuroimage acquire thu_mra_case009 --data-root /path/to/data
neuroimage build thu_mra_case009 --data-root /path/to/data --workers 2
neuroimage workspace --data-root /path/to/data --state-root /path/to/ssd/state
```

Open the matching source through **Browse anatomy**; use the [current browser guide](getting-started.md) for display and scene controls. Any delivered three-digit case ID from 001 to 109 can be used in these commands.

```bash
python -m pip install -r requirements-teaching.lock.txt
python scripts/export_native_mra_projection.py \
  --manifest /path/to/data/derivatives/thu_mra_case009/PACKAGE/manifest.json \
  --output /path/to/data/exports/thu_mra_case009/native-mip.png \
  --first-slice 18 --stop-slice 64 --selected-value 1
```

The optional projection utility is included in the software source archive. Its Matplotlib dependency closure is pinned in `requirements-teaching.lock.txt`; install it in the dedicated NeuroImage environment. Ordinary atlas construction, browsing and the browser's credited image export use the core runtime.
