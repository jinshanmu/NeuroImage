# MIDA native-space model support

The [official MIDA distribution](https://itis.swiss/virtual-population/regional-human-models/mida-model) provides voxel and surface models but does not distribute the original MR or diffusion images. This adapter uses the already acquired v1.0 voxel NIfTI and original label table. It does not display invented MRI contrast or combine MIDA with another specimen. The full acquisition and model methodology is described by [Iacono et al., 2015](https://doi.org/10.1371/journal.pone.0124126).

## Local workflow

```bash
neuroimage acquire mida --data-root "$ATLAS_DATA_ROOT" --storage-policy config/storage-policy.json --dry-run
neuroimage acquire mida --data-root "$ATLAS_DATA_ROOT" --storage-policy config/storage-policy.json
neuroimage build mida --data-root "$ATLAS_DATA_ROOT" --workers 4 --storage-policy config/storage-policy.json
neuroimage validate "$MIDA_MANIFEST"
neuroimage serve --atlas "$MIDA_MANIFEST" --port 8765
```

Set `MIDA_MANIFEST` to the successful build's printed path. The same viewer can offer this model beside other packages by repeating `--atlas`. The independent comparison panels do not register, fuse or assume anatomical equivalence between their sources.

The verified archive is reused at `downloads/mida/MIDA.zip`. If it is missing, acquisition reports the [official access page](https://doi.org/10.13099/ViP-MIDA-V1.0), expected size (483,104,849 bytes, approximately 0.450 GiB), exact destination and pinned hash. The user must obtain the model through the source's access process. The software does not submit forms or accept terms on the user's behalf. The verified original archive and expanded files remain untouched.

Only the NIfTI and label table are needed from that archive. The current recipe reserves 8 GiB additional construction capacity, above the configured data-drive safety floor. The license is retained as the official ITIS MIDA License 2024 PDF. Software distribution terms do not replace data terms; original or derived MIDA model files do not enter this project's code releases.

## Representation and limits

- The current model package selects 51 source classes: cerebral and cerebellar tissue, deep regions, ventricular and general CSF, brainstem components, selected intracranial pathways, cranial nerves, vessels, dura and skull-base context. The original 25-class package is retained for historical content. Source IDs remain `mida:label:<value>`.
- Source value 50 is background. Every value outside the explicit selection maps to output background 0. Selected whole source nerve and vessel classes retain any delivered extracranial or cervical portions; the software does not crop them into invented intracranial boundaries. Spinal cord and other unselected classes remain excluded from the derivative and intact in the original.
- The original NIfTI has a 480 × 480 × 350 grid, millimetre units and an oblique affine. Its coded qform and sform agree within numerical precision. The approximately 0.5 mm spacing is preserved exactly, including the small delivered third-axis deviation. The adapter does not replace the affine using the rounded source text grid description.
- Source labels often combine both sides. They remain unsplit, with unspecified laterality. Gray/white matter classes are not cortical parcellations, tractography or comprehensive lists of nuclei. The ventricular CSF value is not subdivided artificially.
- Surfaces are computed from the actual selected voxel labels by the shared unsmoothed 0.5-isosurface method. Vendor STL surfaces are preserved but unused because a reliable STL-to-voxel transform has not been established. No assumed reflection, scale or registration is applied.
- The UI names categorical model sections explicitly and offers no MRI contrast or 3D MRI controls. Exports retain that distinction, native coordinates, source version, license and processing history. Ten model-specific exploration sequences and the nine-view `mida-cranial-skull-context` notebook describe the available evidence and missing MRI. Full categorical sections and low-opacity source brain/skull surfaces provide context around small nerves before magnification.

Engineering checks test the actual affine, counts, target voxels, computed surfaces and scene behavior. An unavailable left/right label grouping or MRI comparison is recorded as unavailable or not applicable, not as a successful anatomical check. Independent expert review remains pending.

The general CSF class is not a set of named cisterns, and source arteries/veins are not separately named vascular branches. Skull material classes, sphenoidal sinus air, mastoid air, cochlea and semicircular canals provide delivered context; individual skull bones and foramina are not manufactured. The hypoglossal class contains only 134 source voxels in this model and is preserved without geometric inflation. See [Specialist modules](specialist-modules.md).
