# Release scope and development plan

The release covers normal intracranial neuroanatomy and normal variation. Existing modules expose complete source-to-viewing workflows within their declared representation. A module's presence does not imply that its sources contain every anatomical subdivision.

| Implemented area | Available workflow | Boundary |
| --- | --- | --- |
| Source library | CLI recipe inspection, acquisition, construction and validation; browser discovery and opening of prepared atlases | Users obtain source data separately; source terms remain individual |
| Image and label atlases | Native orthogonal sections, linked surfaces, source selection, visibility and image controls | No automatic registration between unrelated spaces |
| Independent fields | Original probabilities and overlapping memberships | No forced mutually exclusive segmentation |
| Streamlines | Source trajectories and physical slice slabs | Computational trajectories are identified as such |
| Native images | Original images or explicitly recorded exact frames | No inferred tissue segmentation |
| Independent models | Native XYZ surface viewing, selection, highlighting and cutaway | No invented MRI coordinate assignment |
| Detailed discovery | Ten main groups and 52 topic definitions, with 46 currently backed by enabled sources | Shared topic names do not create anatomical equivalence |
| Normal variation observations | Eight original volunteer MRA cases and independent source comparison | Annotation differences are not automatically named variants or prevalence estimates |
| Historical scene opening | CLI location and startup opening of exact-source scene files | Browser scene authoring and image-export tools remain in the development branch |
| Browser layout | Responsive canvas, ordinary page scrolling and zoom, inline libraries and tools | Graphics implementation can affect rasterization |
| Distribution | Code-only source snapshot, installable wheel, pinned requirements, licenses and reproducible archive checks | Local Linux checks; other platforms need independent verification |

Teaching libraries, courses, notebook authoring/presentation, guided lessons and study records remain in `codex/release-testing`. The viewer footer beginning with **Dataset details**, scene controls, image export and MRI interaction-hint/Ready footer are also preserved there at commit `006221e`. The formal browser keeps source introductions on home dataset pages, model status and selected-object controls; it retains CLI opening of historical scenes and leaves saved records intact. See the [footer preservation record](development/anatomy-release-simplification.md#viewer-footer-update-2026-10-24). The formal branch enables 22 source configurations from 12 families, with 1,390 source-specific entries and 136 detailed topic–source bindings. NextBrain, IXI MRA, HumanBrainAtlas, Meso-vein MRI, VENAT, the Mouches arterial occurrence atlas, Human Inner Ear CT and the clinical TopCoW/TopBrain cohorts are excluded from acquisition, construction, discovery and opening. Source definitions, licenses, exclusion and inspection records, and saved-scene records are retained. User-authorized removal of out-of-scope data is documented in the [local data cleanup record](maintenance/local-data-cleanup-2026-10-24.md).

## Next anatomical content work

The [detailed anatomy and variation guide](detailed-anatomy-and-variation.md) records the current 398-object `z_anatomy` selection, nuclear and sellar source models and historical eight-case MRA observation workflow. Future work should extend these finite source modules with independently reviewed variant identities, verified cisternal membranes, finer foraminal and cranial-nerve segment definitions, and deeper nuclear or cerebellar subdivisions where the source actually provides them.

For each template: identify the original source and its limits; define stable structure IDs and English learning objectives; document coordinate and representation semantics; verify references and source arrays or geometry; prepare views and questions; record expert review; then integrate through the existing adapter and atlas contracts. Do not fill absent detail using invented anatomy or present an unfinished template as a completed lesson.

Independent anatomical review and a prospective teaching evaluation remain separate next studies. Educational outcomes should be measured with a predefined learner population, comparator, tasks and assessment, rather than inferred from engineering tests. Disease cohorts, lesion labels, pathological deformation and diagnostic or treatment workflows remain outside this phase.
