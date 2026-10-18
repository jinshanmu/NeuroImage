# Local atlas construction and validation

Validate normal intracranial anatomy and normal anatomical variation in the current phase. All selected datasets use the same import, construction, viewing and validation interfaces. Record the license, version and source for each dataset. The software release contains code only, and users acquire their own files. See the [current scope](project-scope.md) and [distribution policy](distribution-policy.md).

## Roles and source evidence

| Resource | Atlas development and validation value | Individual license record |
| --- | --- | --- |
| MIDA v1 | Head/neck voxel and STL model; nerves, vessels, foramina and internal voxel/mesh consistency | [Official ITIS MIDA model and license information](https://itis.swiss/virtual-population/regional-human-models/mida-model); original/derived model sharing and published images follow its individual terms |
| Brainstem Navigator v1.0 | 7T templates and nucleus labels; native correspondence and registration checks | [Exact archive containing Copyright.txt](https://www.nitrc.org/frs/download.php/17380/BrainstemNavigatorv1.0.zip); preserve its delivered terms |
| BigBrain | Cytoarchitecture, section anatomy and selected-resolution volumes | [Selected reconstruction metadata](https://raw.githubusercontent.com/conpdatasets/bigbrain-datalad/master/DATS.json); CC BY-NC-SA 4.0 |
| Julich-Brain v3.0.3 | Maximum-probability labels and cytoarchitectural region definitions | [Release record](https://doi.org/10.25493/56EM-75H); CC BY-NC-SA 4.0 |
| HCP1065 | Tract probabilities, streamlines and diffusion orientation backgrounds | [Atlas terms](https://brain.labsolver.org/hcp_trk_atlas.html); tract resources and FIB use their recorded source terms |
| TopCoW 2024 | Paired CTA/MRA, named vessel labels and topology | [Release license](https://zenodo.org/records/15692630); attribution and commercial-permission terms in License.txt |
| Z-Anatomy | Gross anatomy and conceptual relationships | [Fixed source commit](https://github.com/Z-Anatomy/Models-of-human-anatomy/tree/9de5d6912a1b0df9cab739d57f00e036b0496ddc); project CC BY-SA 4.0 plus individual asset notices |

The existing user-provided MIDA archive was copied to HDD with source/copy SHA256 equality, and the original remains unchanged. Its labels and surfaces are in `data/raw/mida`. The archive contains no license file; the official 2024 license is retained separately. MIDA does not include original MRI or dMRI, so it cannot establish same-subject MRI accuracy for nerves. [Official model description](https://itis.swiss/virtual-population/regional-human-models/mida-model).

Brainstem Navigator v1.0 was copied from the user's Downloads without changing the original. The ZIP member CRC check passed, and 522 NIfTI headers were checked with representative probability/binary-label checks. Preserve its separate IIT and MNI grids; these checks do not establish cross-template alignment or independent anatomical accuracy. [Verification record](../config/brainstem-verification.json).

Disease-state benchmarks are temporarily excluded. UCSF-PDGM and MSD BrainTumour project data were removed at user request; previous checks are historical acquisition evidence, not current acceptance requirements. Rhoton Collection is deferred by user choice.

Julich-Brain v3.0.3 labels are in MNI 2009c asymmetric space. BigBrain volumes exist in distinct declared spaces. Preserve those distinctions and validate transformations explicitly. The same anatomical label name does not establish spatial alignment.

## Validation responsibilities

| Task | Sources | Measurements | Interpretation |
| --- | --- | --- | --- |
| Coordinates and laterality | SPL, MNI, CIT168, synthetic volumes | Affine round trips, voxel/world positions and orientation markers | Software behavior |
| Labels to meshes | SPL, CerebrA, CIT168, MIDA | Surface distance, volume change, components and defects | Within-source geometric correspondence |
| Brainstem/nuclei | Brainstem Navigator, NextBrain, BigBrain, Julich | Native-image correspondence, landmarks and expert review | Specimen and preparation differences remain explicit |
| Vessels/topology | TopCoW, reviewed IXI | Dice, centerline distances, branch/connectivity errors | State evaluation split and available annotations |
| Tracts | HCP1065 TRK, TT/FIB | Bounding boxes, laterality, counts and voxelization | Inferred streamlines are not direct axonal measurements |
| Skull-base relationships | MIDA and appropriate reviewed gross-anatomy sources | Adjacency/viewpoint checks and specialist review | Normal anatomy for learning and teaching |

Separate tuning inputs from evaluation inputs. An atlas used for label generation or correction provides a consistency check. Independent accuracy claims require independent annotations and review evidence.

Record input IDs/versions, transforms and processing steps for every derivative. Store outputs in the common HDD layout. Preserve each source license and check its terms for the intended use of an output. Public software CI uses generated synthetic data; acquired volumes and anatomical models stay outside the software release.
