# Current project scope

NeuroImage currently targets normal intracranial neuroanatomy and normal anatomical variation for neurosurgical learning and teaching. Develop a general, extensible 2D and 3D platform first, then add reviewed anatomy modules. The current scope was confirmed on 2026-10-11.

## Learning objectives

- Identify the same structure in axial, coronal and sagittal images and in 3D.
- Understand cortex, deep nuclei, ventricles, brainstem, cerebellum and their spatial relationships.
- Add reviewed white-matter pathways, major vessels, normal vascular variants, cranial nerves and skull-base relationships as anatomy modules.
- Compare imaging, voxel labels, geometric models and histological evidence with explicit specimen and space records.
- Support lessons, hidden-name exercises, saved views and teaching annotations in canonical English.

Disease states, lesion/tumor labels, pathological deformation and diagnostic or treatment workflows are temporarily outside the software scope. They are not current features, lessons, benchmark requirements or completion criteria. Keep general adapters and structure IDs extensible; a later module requires a new scope decision.

## Resources and acquisition

Prioritize SPL/NAC, MNI/CerebrA, CIT168, HCP1065, IXI, NextBrain, MIDA, Brainstem Navigator, BigBrain, Julich and relevant gross-anatomy references. TopCoW may support reviewed normal vascular anatomy and variation. A clinical source does not establish that every scan is normal: select appropriate anatomy examples and document review instead of assigning an unsupported health status.

UCSF-PDGM and MSD BrainTumour remain in the acquisition inventory only as source/license records outside the current phase. Their project data were removed at user request; the deletion audit remains a local administration record. Further disease-cohort downloads are stopped. Their planning selection is zero, and they are excluded from current atlas development and acceptance. Rhoton Collection remains deferred by user choice.

The common adapter contract and directory layout remain the same for every dataset. Selection reflects current anatomical needs, not a permission-based dataset hierarchy. The future GitHub/software release still contains code, recipes and English documentation with no acquired data.

## Acceptance

First validate SPL/NAC native-space loading and 20 structures in synchronized 2D/3D views, with correct laterality and geometry. Expand toward 60 to 100 reviewed structures and 8 to 10 anatomy lessons. Acceptance covers coordinates, image/label/mesh correspondence, provenance, offline performance and expert teaching review. Disease-cohort availability is not required.

See the [platform design](platform-design.md), [local validation plan](local-validation.md) and [machine-readable scope](../config/project-scope.json).
