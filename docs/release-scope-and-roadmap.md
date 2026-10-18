# Release scope and development plan

The release covers normal intracranial neuroanatomy and normal variation. Existing modules expose complete source-to-viewing and teaching workflows within their declared representation. A module's presence does not imply that its sources contain every anatomical subdivision.

| Implemented area | Available workflow | Boundary |
| --- | --- | --- |
| Source library | Recipe inspection, storage-aware acquisition, construction, validation, discovery and activation | Users obtain source data separately; source terms remain individual |
| Image and label atlases | Native orthogonal sections, linked surfaces, source selection, visibility and image controls | No automatic registration between unrelated spaces |
| Native inner-ear CT | Original Dataset A specimen CT, complete fluid-space labels and six recorded teaching views | Reconstructed sampling and acquisition metadata stay separate; intensity calibration is not inferred |
| Independent fields | Original probabilities and overlapping memberships | No forced mutually exclusive segmentation |
| Streamlines | Source trajectories and physical slice slabs | Computational trajectories are identified as such |
| Native images | Original images or explicitly recorded exact frames | No inferred tissue segmentation |
| Independent models | Native XYZ surface viewing, selection, highlighting and cutaway | No invented MRI coordinate assignment |
| Detailed discovery | Ten main groups and 35 subordinate topics with actual source-version coverage | Shared topic names do not create anatomical equivalence |
| Normal variation observations | Eight original volunteer MRA cases and individual/population evidence courses | Annotation differences are not automatically named variants or prevalence estimates |
| Teaching | Notes, markers, source-bound scenes, notebook capture/import/export/presentation, cross-source courses and saved progress | Browser storage requires exports for durable archiving |
| Browser layout | Responsive canvas, ordinary page scrolling, inline libraries and tools, expanded view | Graphics implementation can affect rasterization |
| Distribution | Code-only source snapshot, installable wheel, pinned requirements, licenses and reproducible archive checks | Local Linux checks; other platforms need independent verification |

## Next anatomical content work

The [detailed anatomy and variation guide](detailed-anatomy-and-variation.md) records the completed 286-object Z-Anatomy selection, nuclear and sellar model curricula, native inner-ear CT and eight-case MRA observation workflow. Future work should extend these finite source modules with independently reviewed variant identities, verified cisternal membranes, finer foraminal and cranial-nerve segment definitions, and deeper nuclear or cerebellar subdivisions where the source actually provides them.

For each template: identify the original source and its limits; define stable structure IDs and English learning objectives; document coordinate and representation semantics; verify references and source arrays or geometry; prepare views and questions; record expert review; then integrate through the existing adapter and teaching contracts. Do not fill absent detail using invented anatomy or present an unfinished template as a completed lesson.

Independent anatomical review and a prospective teaching evaluation remain separate next studies. Educational outcomes should be measured with a predefined learner population, comparator, tasks and assessment, rather than inferred from engineering tests. Disease cohorts, lesion labels, pathological deformation and diagnostic or treatment workflows remain outside this phase.
