# Cortical surface anatomy in the original Z-Anatomy model

This source guide includes historical teaching-validation records. Curricula, lessons and course workflows described here are retained in `codex/release-testing`; the formal release exposes the same source anatomy through [Browse anatomy](getting-started.md).

The existing pinned source file supplies 56 additional hemisphere-specific surface objects. Together with the earlier neurovascular, cranial, cerebellar and ventricular content, the 14 October 2026 Z-Anatomy selection contained 213 objects. The [current detailed-anatomy selection](detailed-anatomy-and-variation.md) contains 398 objects in the original `z_anatomy` source. Original object names, hemisphere suffixes, polygon topology, local coordinates and metric world transforms are retained. The recipe records a project display palette for visual separation; the original Blender materials remain in the preserved source file. The original source has already been acquired; this increment downloads and expands zero additional bytes.

## Regional teaching content

| Curriculum and course plan | Views | Source objects |
| --- | ---: | --- |
| `z-anatomy-cortical-frontal-central` | 20 | Central sulcus; precentral and postcentral gyri; superior and middle frontal gyri; source opercular, triangular and orbital inferior-frontal parts; superior and inferior frontal sulci |
| `z-anatomy-cortical-temporal-parietal` | 20 | Source lateral superior temporal gyrus, middle/inferior temporal gyri, superior temporal sulcus, supramarginal/angular gyri, intraparietal sulcus, superior parietal lobule, circular insular sulcus and the source composite insular/subcentral object |
| `z-anatomy-cortical-medial-basal` | 16 | Calcarine, parieto-occipital and collateral sulci; lingual, source parahippocampal and lateral occipitotemporal gyri; precuneus and cuneus |

Each named source object is retained separately on each supplied side. Parenthetical source qualifiers, including starred composite names, remain visible in the structure definition. The source object `Insula.j` contains two vertices and zero polygons. It remains in the inspected source inventory as a locator; the supplied polygonal insular/subcentral objects provide the available surface representation.

The three curricula provide source-bound selection, complete regional context, hemisphere-specific viewpoints, discussion prompts and source notes. Three corresponding course plans preserve all 56 views. Splitting the original combined plan into regional courses keeps each portable file within the established 10 MiB limit while preserving the full attribution in every scene. Completed notebook preparation is reused.

## Build and browse

Use the dedicated project environment and configured data drive:

```bash
conda activate NeuroImage
neuroimage acquire z_anatomy --data-root /path/to/data
neuroimage build z_anatomy --data-root /path/to/data --workers 4
neuroimage workspace --data-root /path/to/data --state-root /path/to/ssd/state
```

The acquisition command verifies the retained source archive and file. Construction reserves 3 GiB above the configured data-drive safety floor. Original source educational geometry remains in its native XYZ frame with the explicit meter-to-millimeter conversion. The original source-author viewport geometry stage and any declared modifiers remain recorded, together with base vertices and polygon topology. The project applies source-preserving triangulation and retains the originals for independent verification.

In the testing branch, prepare any of the three curricula with `neuroimage teaching prepare CURRICULUM --atlas MANIFEST --data-root DATA_ROOT`, or choose its exact compatible package in the testing branch teaching library. Use the matching regional plan for a saved course. The source cortical surface model and Julich, NextBrain or other MRI packages can be compared in independent native views. Their different structure definitions and coordinate frames remain explicit.

## Source checks and recovery

`scripts/verify_z_anatomy_source.py` independently reads the original Blender file with embedded scripts disabled and compares every retained object against the atlas. This increment checks all 213 objects, including exact original vertices and topology. The maximum metric affine difference is below 0.000075 mm. `scripts/browser_z_cortical_surface.js` (testing branch) checks all 56 views, native source bindings, visibility, camera settings, scene restoration, portable import and attributed exports through the accepted frontend.

The source original, atlas packages, browser exports and diagnostic course-size record remain on the data drive. Repeating construction reuses unchanged assets. Earlier packages and courses retain their own identities and remain recoverable. Exact-view instructor review is recorded separately from geometry and software acceptance. The source is an author-created anatomical model; its resolution and object extents remain those of that model.
