# Native MRA image observations

NeuroImage 0.10 adds an explicit image-only representation (`mri-volume`, manifest 1.6). It packages one original NIfTI acquisition in its native space, with zero invented structures and no label volume, segmented surface or computed vessel centerline. It uses the same acquisition, construction, validation, workspace, scene, notebook and credited-export interfaces as the labelled atlas sources.

The first recipe selects `IXI002-Guys-0828-MRA.nii.gz` from the existing IXI MRA archive. The [official IXI page](https://brain-development.org/ixi-dataset/) describes a healthy-subject cohort and specifies [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Preserve the source attribution and applicable data-license terms in derivatives. Cohort membership is not an independent expert review of this particular image.

## Acquisition and construction

```bash
conda activate NeuroImage
neuroimage acquire ixi_mra --data-root /path/on/hdd/NeuroImage --dry-run
neuroimage acquire ixi_mra --data-root /path/on/hdd/NeuroImage
neuroimage build ixi_mra --data-root /path/on/hdd/NeuroImage --workers 1
neuroimage workspace --data-root /path/on/hdd/NeuroImage --state-root /path/on/ssd/neuroimage-state
```

The official `IXI-MRA.tar` archive is 12,377,712,640 bytes (11.53 GiB). The selected compressed image is 14,750,716 bytes (14.07 MiB). Acquisition verifies the selected source file if it already exists under `raw/ixi_mra`; it then requires neither a new archive download nor another extraction. The receipt explicitly states that an unused archive was not rehashed. Otherwise, the normal download checkpoint and selective TAR extraction retrieve only the pinned member. TAR links, duplicate names and unexpected selected sizes are rejected. Other source members and user originals are preserved.

Construction reserves 2 GiB above the configured data-drive floor, although this one image produces only about 15 MB of output. The original compressed NIfTI is copied byte for byte into the separate local atlas; header forms, units, voxel values and obliquity are unchanged. The construction receipt and validation record bind the original hash. Repeated construction reuses all four completed assets. The acquired slab is approximately 240 × 240 × 80 mm; it does not cover every cranial structure.

## Browsing and teaching

Choose **Vascular anatomy** in the workspace and open the IXI image package. The left panel shows source dimensions, native spacing and the source intensity sampled at the physical cursor. **Image contrast** changes display settings while retaining the original values. The three complete acquired sections and the 3D intensity view share the same native position.

The initial contrast gives surrounding image context. For this selected image, an illustrative window of 65–250 emphasizes bright signal. This is a viewing choice, not a vessel segmentation or classification. The `ixi-native-mra-observation` notebook starts with a 0–150 window, compares the same point at 65–250, and then visits lower and upper acquired sections. Each view starts at full section coverage. **Magnify at cursor** enlarges that same point; **Full sections** restores global acquired context.

The 3D intensity view uses the pinned renderer's ray rendering. It is not a maximum-intensity projection or a validated vascular surface. Volume picking uses the renderer's quantized coordinate fractions and is approximate; use the section cursor and native intensity readout to inspect source samples. Image intensity, display contrast and apparent continuity do not establish a vessel identity or anatomical boundary.

Teaching markers and notes may describe an observation, with their structure association left empty. No automatic structure-identification answers are provided. Scene files and prepared notebooks retain contrast, intensity-render visibility, camera, native position and annotations. Exported images retain source attribution, exact display state, renderer identity and source-license evidence. The notebook can be prepared directly:

```bash
neuroimage teaching prepare ixi-native-mra-observation \
  --atlas /path/on/hdd/NeuroImage/derivatives/ixi_mra/PACKAGE_VERSION/manifest.json \
  --data-root /path/on/hdd/NeuroImage
```

Use `neuroimage review notebook` with the captured views for image-observation review. Structure-review packets require actual source structures and are not generated for image-only packages. Independent review remains pending until an explicitly scoped instructor judgment is recorded.

## Geometry and verification

The native voxel axes are LAS in an oblique millimeter grid. RAS display coordinates describe this acquisition only; they do not establish AC-PC alignment, template registration or correspondence with another IXI contrast. Different images remain independent in comparison panels. Filename subject identity alone does not validate an image fusion.

`scripts/browser_native_image.js` exercises source-voxel sampling, outside-coverage handling, contrast, volume visibility, display convention, magnification, annotations and scene recovery in a real Linux browser. `scripts/check_native_image.py` independently reads the original NIfTI and compares bytes, arrays, affine, source samples, unchanged 2D pixels during 3D toggling, restored pixels and export attribution. `scripts/browser_native_image_teaching.js` captures the four prepared views and a same-point full/magnified pair. These are engineering checks, not expert anatomical approval or evidence of a population variation distribution.
