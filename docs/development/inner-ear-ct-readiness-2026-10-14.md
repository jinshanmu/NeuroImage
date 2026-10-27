# Original inner-ear CT source readiness

**Archived inspection:** the dedicated Human Inner Ear CT source is excluded from the current scope. Source definitions, licenses, inspection and exclusion records, and saved-scene records are retained. User-authorized data removal is documented in the [local data cleanup record](../maintenance/local-data-cleanup-2026-10-24.md). Storage statements below describe the earlier inspection.

The selected input is original cadaveric Dataset A specimen `1.hdf5` from [Stebani, Blaimer, Neun, Pelt and Rak, Zenodo release 8277159](https://doi.org/10.5281/zenodo.8277159), version 1.0, licensed CC BY 4.0. The [primary paper](https://doi.org/10.1038/s41598-023-45466-9) distinguishes its 43-specimen Dataset A from clinical Dataset B. Only this Dataset A instance was acquired. Publisher metadata, the paper and individual license evidence are retained on the HDD.

The original file contains 530,856,520 bytes. Its publisher MD5 is `3c5fa93c3ddd037adf48b6f10d631ea6`; the local SHA256 is `6a4e9e6e9b217a4262379dbf03c9b7e67d75e25306a84418c135e4ffc6281f96`. Acquisition reused the first 10 MiB of a slow sequential transfer with the existing eight-connection downloader. Verification completed at 14:11:49 UTC. The 3 GiB peak estimate and 400 GiB HDD reserve were respected.

## Actual source contents

Both arrays have shape 512 × 512 × 405 in original I,J,K indexing. Every one of the 106,168,320 samples was inspected in bounded chunks. The int32 CT contains finite original values from -1000 to 3372. The publication describes HU reconstruction, while the HDF5 does not declare intensity-unit or calibration attributes. Preserve these original values and that evidence distinction when defining a CT adapter.

The original uint8 label attributes supply the following identities; names and colors were read directly from the file.

| Value | Original name | Voxels |
| --- | --- | ---: |
| 0 | background | 105,957,599 |
| 1 | Cochlea | 83,945 |
| 2 | Vestibulum | 76,873 |
| 3 | Canals | 49,903 |

The paper describes these as manually delineated labyrinth fluid spaces. They represent the source's three regions, rather than separately delineated individual semicircular canals or membrane surfaces. The original segmentation attributes also retain their author status tags. Specimen side is not explicitly declared in the HDF5.

## Grid and landmark evidence

The image declares an LPS origin and three NRRD-style axis direction vectors. Stored array dimensions match its `sizes` attribute. Physical axis lengths are 0.0986328125 mm, consistent with the published approximately 98.6 micrometer reconstruction grid. The acquisition protocol reports 0.466 mm slice thickness; reconstructed sampling does not establish that level of acquired anatomical resolution. The label array is paired in the same file and has the same shape, with no separately declared affine.

The three landmark nodes are attribute-only HDF5 datasets with a null dataspace. The inspector retains their original attributes without expecting an image array. Independent affine inversion gives these differences between the original integer IJK record and the original physical XYZ record:

| Original point | Distance (mm) |
| --- | ---: |
| CochleaTop | 0.114659 |
| OvalWindow | 0.126525 |
| RoundWindow | 0.118681 |

All exceed the grid's 0.085419 mm half-voxel diagonal. Both coordinate records are preserved. Their discrepancy requires reconciliation before incorporating those markers as verified physical annotations. The inspection figures show the paired CT and labels, without these markers. No registration, source resampling or anatomical mirroring was performed; the surface figure expresses the declared physical positions in the RAS coordinate basis.

## Inspection figures and review

The figure receipt records three original CT planes, display range, exact crop, color identities, orthographic camera, source attribution, image hashes and half-voxel mesh checks. Surfaces retain the unsmoothed label boundary. The initial layout with crowded footer text and a smaller object is retained in a compact diagnostic folder; the clear revised figures were shown to the owner.

IEC-20261014-01 was accepted for introductory explanation of the displayed cochlear, vestibular and semicircular fluid-space relationships. The exact images and question are recorded in `config/instructor-review-inner-ear-ct-2026-10-14.json`. That judgment concerns these two figures; it does not resolve original landmark coordinates, laterality or full source-catalog assessment.

The source-readiness receipt is `benchmarks/inner_ear_ct/source-readiness/specimen-1.json` under the data root. The two figures and their receipt are in the adjacent `specimen-1-figures` folder. This input remains separate from the installed 33 atlas configurations. Full CT construction, modality presentation, linked browsing, scene recovery and credited export remain prospective adapter work under the [platform's extension requirements](../adapter-development.md).

## Reproduce the inspection

Use the independent NeuroImage environment with the core closure, `requirements-source-inspection.lock.txt` and `requirements-teaching.lock.txt`. The existing Python 3.12.15, h5py 3.16.0 and HDF5 2.0.0 installation was reused. Run from the repository with `data` pointing to the HDD root:

```bash
python scripts/inspect_inner_ear_ct.py \
  --source data/raw/inner_ear_ct/zenodo-8277159/1.hdf5 \
  --output data/benchmarks/inner_ear_ct/source-readiness/specimen-1.json \
  --publisher-md5 3c5fa93c3ddd037adf48b6f10d631ea6 --maximum-memory-mib 256
python scripts/render_inner_ear_ct_inspection.py \
  --source data/raw/inner_ear_ct/zenodo-8277159/1.hdf5 \
  --receipt data/benchmarks/inner_ear_ct/source-readiness/specimen-1.json \
  --output data/benchmarks/inner_ear_ct/source-readiness/specimen-1-figures
```

Four targeted tests cover null landmark objects, rotated anisotropic grids, preservation of source disagreement and invalid coordinate metadata. Initial null-dataspace and NumPy scalar serialization errors were fixed against the actual source. The first Matplotlib shading call used an unsupported singular alias; the supported `facecolors` argument is now used. Original data and the accepted displayed geometry remain intact.

The inspection also exposed a translation-sensitive float32 auxiliary surface-volume calculation. Version 0.14.1 uses centered float64 tetrahedral summation with bounded memory. Its translation/reflection regression and the preferred-package audit are documented in [the numerical correction](surface-volume-correction-2026-10-14.md).
