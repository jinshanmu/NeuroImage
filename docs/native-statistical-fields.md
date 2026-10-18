# Native statistical fields

Manifest 1.8 adds `scalar-fields`: original scalar NIfTI volumes on one explicitly verified native grid, with no MRI backdrop or structure labels. Every field declares its source input, metric, units, statistic, interpretation, processing basis and reference. Field definitions are separate from spatial millimeter units. A supplied value range, when declared, is checked against actual samples. Byte identity with original source inputs is mandatory.

The same acquisition, construction, local library, validation and browser interfaces apply. Construction writes individual checkpoints, verifies source hashes and reuses complete outputs. Volumes load on demand; switching a field releases the previous renderer volume metadata. A shared template name is not enough to overlay an unrelated source.

## VENAT

Use the pinned [Figshare v4 release](https://doi.org/10.6084/m9.figshare.7205960.v4), licensed CC BY 4.0. Its source publication is [Huck et al., 2019](https://doi.org/10.1007/s00429-019-01919-4). Original publication and data licenses are recorded separately.

```bash
conda run -n NeuroImage python -m neuroimage acquire venat --data-root /path/to/imaging-data
conda run -n NeuroImage python -m neuroimage build venat --data-root /path/to/imaging-data --workers 2
conda run -n NeuroImage python -m neuroimage validate /path/to/imaging-data/derivatives/venat/VERSION/manifest.json
conda run -n NeuroImage python -m neuroimage workspace --data-root /path/to/imaging-data
```

Open **Arteries and veins**, choose VENAT, then use **Field**. The local package contains partial-volume mean and standard deviation, detection density, diameter mean and standard deviation, and curvature mean and standard deviation. The recipe preserves each field's definition and units. The two acquired torsion files remain in source storage pending reconciliation of their interpretation with the final paper.

These are population computations from healthy participants, not named normal-variant frequencies or individual vascular segmentations. Source sampling and processing limit coverage; missing field support is not proof of missing anatomy. No reference MRI is synthesized or borrowed. Keep other source comparisons in independent panels.

## Verification and recovery

`tests/test_scalar_fields.py` checks exact source bytes, units, grid consistency, declared value bounds and no-op recovery. The browser fixture checks all seven fields against original source voxels, contrast-independent values, source-bound scene restoration and credited exports. Saved, restored and imported views were pixel-identical. These checks establish software behavior, not an anatomical judgment.

Rerun the same acquisition and build commands after interruption. Keep source files and the original package required by exported scenes. Do not replace the source volume, metric definition or native affine under an existing package identity.
