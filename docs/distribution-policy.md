# Code-only software and independently acquired data

NeuroImage is developed locally and is intended for a future open-source release on the owner's GitHub. Publish the source and software packages under Apache-2.0. Users obtain their own datasets and use the software to construct and browse local atlas packages. Every dataset has equal development status and its own license record.

## Distribution boundary

The code repository contains loaders, coordinate handling, preparation algorithms, generic schemas, resource references, acquisition instructions, recipes and English documentation. It contains no acquired images, labels, probability maps, anatomical meshes, streamlines, histological sections, cases or derived atlas packages. This boundary applies to every source, including public-domain and CC0 data.

Local environments, installed applications, caches and machine-specific configuration are excluded from releases. GitHub CI generates synthetic test inputs at runtime and does not upload locally acquired data. The `data` link points to HDD storage; a local atlas package is an application input separate from the software distribution.

## Uniform dataset support

Use one adapter contract for import, atlas construction, viewing and validation. This covers SPL/NAC, MNI, CerebrA, HCP, NextBrain, IXI, MIDA, Brainstem Navigator, BigBrain, Julich and other selected resources. Priority follows anatomical value and implementation needs. Use a common dataset layout and record each license individually.

Each resource record contains its exact version, source, acquisition method, required files, geometry conventions, checksums and license evidence. Some providers offer direct downloads; others use an account, application or manual import. The adapter imports an existing lawfully obtained archive without redistributing it. These acquisition differences do not change the dataset's development status.

## Shared storage and workflow

```text
data/downloads/<dataset_id>/              Original archives and standalone files
data/raw/<dataset_id>/                    Expanded source data
data/derivatives/<dataset_id>/<run_id>/    Locally constructed outputs
data/benchmarks/<dataset_id>/<run_id>/     Validation inputs and results
data/licenses/<dataset_id>/               Original license evidence
data/exports/<dataset_id>/                User-created atlas packages
```

1. Install the code and select SSD workspace and HDD data storage.
2. Choose a resource recipe and obtain its files under its license.
3. Verify files and preserve the source/version/license records.
4. Import native geometry and construct a local atlas package.
5. Validate correspondence and specialist interpretation before teaching use.
6. Browse the package offline and retain provenance for outputs.

Record license terms individually. Dataset and derivative licenses remain separate from the code license. A user's screenshot, scene-sharing or atlas-export action follows the relevant source terms, with credits and input versions preserved.

No data directory is included in a software release. A code-file audit protects that boundary. The local server exposes explicitly selected local packages rather than the entire HDD root.
