# CIT168 native probability evidence

The CIT168 adapter imports the already delivered native T1-weighted and T2-weighted templates, categorical navigation labels and all 16 bilateral probability channels. It uses the same acquisition, construction, validation, viewing and teaching interfaces as other datasets. No cross-atlas transform is assumed.

## Source meaning

The source templates combine 168 typical adults aged 22–35. Left-side support averages 24 delineated template volumes; the authors generated right-side support through a reflection warp with affine and diffeomorphic mapping and interpolation. The two sides therefore have different evidence histories. The probabilities describe observer assignment support, rather than an individual's tissue boundaries or population prevalence. See Pauli, Nili and Tyszka, [Scientific Data 5, 180063 (2018)](https://doi.org/10.1038/sdata.2018.63), particularly the construction methods and usage notes; an open published copy is available from [CaltechAUTHORS](https://authors.library.caltech.edu/records/g96gp-wn036).

The [author's delineation notes](https://github.com/jmtyszka/CIT168-SubCorticalAtlas/wiki/Region-Delineation) distinguish boundaries visible in MRI from boundaries estimated using landmarks. Source names and coverage remain attached to every structure. The combined extended-amygdala label is not a whole-amygdala label. The project does not split a bilateral source value into invented side-specific labels.

## Acquisition and storage

```bash
conda activate NeuroImage
neuroimage acquire cit168_native --data-root /path/to/existing/data-root --dry-run
neuroimage acquire cit168_native --data-root /path/to/existing/data-root
neuroimage build cit168_native --data-root /path/to/existing/data-root --workers 4
neuroimage validate /path/to/generated/manifest.json
neuroimage serve --atlas /path/to/generated/manifest.json
```

The recipe pins five direct source files from [OSF](https://osf.io/jkzwp/) by exact size and SHA256. They total 34,250,832 bytes, approximately 32.66 MiB. An additional small license snapshot records the source's CC BY 4.0 terms. Existing verified downloads are reused in place; no archive expansion or duplicate raw copy is required. The construction budget reserves 2 GiB above the configured free-space floor.

The pre-existing unilateral probability file and observer metric tables remain preserved but are not required for the current adapter. The local source license and original acquisition receipts remain separate from the software distribution. The software contains recipes and processing code, with no acquired templates, labels, probability arrays or meshes.

## Construction and validation

The common schema 1.2 adds optional probability assets and explicit per-structure channel references. Each 4D source channel becomes a separately loadable 3D NIfTI. Its scalar values, array order, shape and affine are preserved exactly. No new interpolation, thresholding, clipping, mirroring or registration is performed. The source's own prior transformations remain disclosed.

The delivered `det_atlas_25` map is retained for categorical selection and surface navigation. A full voxel comparison establishes that this pinned file equals maximum-channel selection with inclusive support of at least 0.25; ties select the first source channel. This is a measured relationship for this release, not an interpretation inferred from the filename. Construction fails if the delivered map disagrees with the declared rule. Validation also checks the relationship using the actual packaged probability volumes, alongside hashes, value ranges, coordinate consistency, real member targets and every surface vertex.

The surfaces are unrefined binary boundaries of the delivered categorical map. Their apparent sharpness does not establish a sharp tissue boundary. The inspector calls the measured categorical extent a **threshold label volume**, not a probability-integrated anatomical volume.

Complete packages retain a manifest digest and asset checkpoints. If the construction signature and all output bytes still match, a repeat build returns the verified package without decompressing source arrays again. Missing or modified products enter ordinary repair; acquired originals remain unchanged.

## Browsing and teaching

The initial 2D overlay shows the selected probability channel with a fixed 0–1 scale. Only one probability channel is loaded at a time. Moving the cursor samples that fixed channel; selecting a structure or a visible 3D surface changes the target. The readout uses nearest-voxel sampling and four decimal places. GPU textures use the renderer's numerical representation; exact original values remain in the package. A coordinate outside the volume reports unavailable, while a valid zero-valued voxel reports zero.

Switch **2D evidence** to inspect the categorical navigation map. The 3D surfaces remain confined to the 3D view. MRI contrast, physical coordinates, probability selection, opacity, evidence mode and lesson state survive scene export and restoration. Teaching exports preserve source licenses, full channel derivation and rendering records.

Five draft teaching sequences cover probability interpretation, striatal/pallidal relationships, midbrain nuclei, diencephalic regions and bilateral inference. These sequences use actual packaged structures and measured images. Engineering checks and source citations do not constitute independent anatomical or lesson approval.
