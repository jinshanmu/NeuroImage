# Learning and normal-variation workflows

Version 1.0.0 combines source-specific guided lessons, notebook views and reusable course plans. The main anatomical groups stay stable; detailed topics expose the definitions actually present in each local source version.

## Begin with linked anatomy

With CerebrA installed, prepare **First session: cortex, deep structures and ventricles** in the Teaching library. Its eight views introduce cortical, deep, ventricular, hippocampal, brainstem and cerebellar regions. Inspect the selected region in all three sections, rotate the 3D view and describe its relationship to a neighboring structure.

Within an atlas, open **Learning tools → Learn**. Choose a lesson and move through its structures. Identification practice hides names until you reveal the source answer. A response can describe both the identity and the supporting spatial observation. Answers and source terminology provide material for self-study and instructor discussion.

## Keep a study record

Use **Save response** to retain the current answer, **Review again** to mark a step for another visit, or **Understood** to record your confidence. **Restore response** returns the saved text for the current step. The review list links directly to marked steps.

Study records are separate from display scenes. They are saved in the browser against the exact atlas package and lesson targets. Under **Review and backup**, export a JSON record or import a previous one. Import merges steps and retains the newest response for a repeated step; it checks the source package and lesson target before accepting the file. Ratings are personal learning notes rather than automatically graded performance. Browser data clearing can remove local saves, so keep exported backups.

## Advanced anatomical views

The 1.0.0 Z-Anatomy selection contains 350 original objects. The new 64 objects extend cortical surface and dural arterial context. Seven new curricula provide 64 views:

| Curriculum | Views | Learning focus |
| --- | ---: | --- |
| Precentral, postcentral and paracentral sulci | 8 | Sulcal courses beside the central and medial cortical context |
| Orbital and frontopolar surface anatomy | 14 | Basal frontal subdivisions, olfactory sulci and gyrus rectus |
| Cingulate and medial parietal surface anatomy | 12 | Cingulate, paracentral, precuneal and subparietal relationships |
| Temporal plane, transverse temporal gyri and pole | 6 | Superior temporal and insular spatial context |
| Inferior temporal and collateral sulcal anatomy | 6 | Inferior temporal and occipitotemporal relationships |
| Occipital poles, gyri and sulcal landmarks | 14 | Lateral and medial occipital orientation |
| Middle meningeal arterial model context | 4 | Supplied arterial branches and transparent skull-base bones |

The **Advanced cortical surface anatomy** course combines the 60 cortical views. The dural arterial course contains the four remaining views. These objects retain the source's original geometry and combined naming. They are educational models in independent XYZ coordinates. Their bilateral shape is a model representation; individual anatomy is studied through measured-image sources.

Other existing modules cover deep nuclear and brainstem regions, NextBrain tissue blocks, cerebellar probability fields, inner-ear CT, white-matter trajectories and source models. Source-based geometry and image checks accompany those modules; anatomical coverage depends on the supplied source definitions.

## Compare normal arterial variation

Eight healthy-volunteer cases from the original Cerebral MRA resource support four focused topics: paired A1 courses, the anterior communicating region, posterior communicating regions, and the P1–basilar configuration. Each case has four prepared views. The anterior and posterior comparison courses each contain 16 views, ordered by region across the eight volunteers.

The [source authors](https://ivg.au.tsinghua.edu.cn/dataset/Cerebral-MRA/Cerebral-MRA.html) describe physiological variation in the cohort and provide numeric segment annotations. The supplied images are author-processed, registered and cropped MRA; the project retains that delivered grid and its annotation definitions.

For a comparison:

1. Open the same region in two volunteers with the course comparison control.
2. Follow the visible course across adjacent sections and rotate the displayed context.
3. Adjust label opacity to compare the annotation with the original image signal.
4. Record the side, course, continuity, represented segment labels and unresolved observations.
5. Save supporting scenes or a notebook for instructor review.

The software supplies source observations and comparison tasks. Assigning a named individual variant requires review of the supporting original images and source evidence. A missing label alone is not an anatomical classification. Population occurrence and probability fields remain separate from these individual examples.

## Portable teaching files

Notebook and course views retain their exact source binding, display state, source credits, input records, construction parameters and software versions. New views reference the complete recipe in their required package's `manifest.json`, avoiding a repeated full recipe in every view. Existing files containing the full recipe remain readable. Teaching image exports continue to include the complete package provenance and source license files.

The remaining anatomical development plan includes independently reviewed named variants, finer cisternal membranes and additional verified cranial-nerve or skull-base subdivisions. These are recorded in the [roadmap](release-scope-and-roadmap.md).
