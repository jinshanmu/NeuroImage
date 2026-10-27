# Dataset installation and source requirements

All enabled sources use the same command-line `recipes`, `acquire`, `build`, `validate` and `workspace` interfaces. The webpage opens prepared atlases and retains source and license references. The software contains their recipes and references; users obtain the original data under each source's current terms.

Use `neuroimage recipes NAME` for the exact source version, input paths and license references. A `quickstart NAME ... --dry-run` reports the expected transfer and expansion budget for your existing library. Cases sharing an archive reuse that original archive and verified extracted inputs.

| Dataset family | Recipe configurations | Acquisition through CLI | Additional construction dependency |
| --- | --- | --- | --- |
| [SPL/NAC](https://www.openanatomy.org/atlas-pages/atlas-spl-nac-brain.html) | `spl_nac` | Recipe-driven download and build | Pinned Python runtime |
| [CerebrA](https://nist.mni.mcgill.ca/cerebra/) | `cerebra` | Recipe-driven download and build | Pinned Python runtime |
| [MIDA](https://itis.swiss/virtual-population/regional-human-models/mida-model) | `mida` | Manual original archive; automated extraction and build | Pinned Python runtime |
| [CIT168](https://osf.io/jkzwp/) | `cit168_native` | Recipe-driven download and build | Pinned Python runtime |
| [Brainstem Navigator](https://www.nitrc.org/projects/brainstemnavig/) | `brainstem_navigator_mni` | Recipe-driven download and build | Pinned Python runtime |
| [Julich-Brain](https://doi.org/10.25493/56EM-75H) | `julich_selected` | Recipe-driven download and build | Pinned Python runtime |
| [SUIT](https://github.com/DiedrichsenLab/cerebellar_atlases/tree/6857dfa732de6dd60c94da2f84d0b15ccf316618) | `suit_cerebellum` | Recipe-driven download and build | Pinned Python runtime |
| [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy/tree/9de5d6912a1b0df9cab739d57f00e036b0496ddc) | `z_anatomy` | Recipe-driven download and build | Blender 5.2.2 LTS as a separate application |
| [BigBrain](https://ftp.bigbrainproject.org/bigbrain-ftp/BigBrainRelease.2015/Layer_Segmentation/3D_Surfaces/PLoSBiology2020/) | `bigbrain_layers`, `bigbrain_hippocampus` | Recipe-driven download and build | Pinned Python runtime |
| [HCP1065](https://brain.labsolver.org/hcp_trk_atlas.html) | `hcp1065_tracts`, `hcp1065_prob` | Recipe-driven download and build | Pinned Python runtime |
| [THU Cerebral MRA](https://ivg.au.tsinghua.edu.cn/dataset/Cerebral-MRA/Cerebral-MRA.html) | `thu_mra_case001`, `thu_mra_case006`, `thu_mra_case007`, `thu_mra_case009`, `thu_mra_case010`, `thu_mra_case014`, `thu_mra_case021`, `thu_mra_case030` | Recipe-driven download and build | Pinned Python runtime |
| [MUG500+](https://figshare.com/articles/dataset/MUG500_Repository/9616319/20) | `mug500_healthy`, `mug500_source_mesh` | Recipe-driven download and build | Pinned Python runtime |

NextBrain, IXI MRA, HumanBrainAtlas, Meso-vein MRI, VENAT, the Mouches arterial occurrence atlas, Human Inner Ear CT and the clinical TopCoW/TopBrain cohorts are excluded from the current application. Their former configurations cannot be acquired, built or opened, including through saved package links. Source definitions, licenses, exclusion and inspection records, and saved-scene records are retained. User-authorized removal of out-of-scope data is documented in the [local data cleanup record](maintenance/local-data-cleanup-2026-10-24.md). The current release enables 22 configurations from 12 source families.

## Manual source files

MIDA requires its official access workflow. Run a dry run to obtain the access-page URL and exact `downloads/mida/MIDA.zip` destination. Save the unchanged archive there and repeat the command. The software verifies its size and checksum before extraction.

If a publisher changes an automatic download endpoint or requires a browser interaction, inspect the selected recipe. Obtain the exact pinned original file from the official source, place it at the reported archive or input destination, and repeat acquisition. Preserve the expected file name and content. A different source version requires a reviewed recipe update rather than replacing a conflicting original.

The detailed source terms and citations are retained in each recipe and constructed atlas. They apply individually to source data and derivatives. Read those terms before sharing teaching images or atlas packages.

## Optional tools

- **Blender:** Z-Anatomy uses the recipe's exact application version and its embedded Python. Obtain Blender from its official distribution and verify `blender --version`. The construction command checks the recorded version. Viewing a built model uses the browser and does not launch Blender.
- **HDF5:** `requirements-source-inspection.lock.txt` retains optional inspection and development dependencies. Installing these tools does not enable archived or excluded datasets.
- **Projection figures:** Optional command-line teaching projections use `requirements-teaching.lock.txt`. The normal viewer and image export do not need plotting libraries.
- **Other acquisition tools:** `aria2`, `dcm2niix` and `git-annex` in `environment.yml` support optional source inspection and development workflows. The integrated downloader uses the Python standard library.

Existing source arrays, labels, surfaces and trajectories are retained according to their recorded construction methods. The [atlas format](atlas-format.md) describes coordinate and representation contracts.
