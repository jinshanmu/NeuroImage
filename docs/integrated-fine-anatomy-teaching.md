# Integrated fine-anatomy teaching

Four advanced course plans connect previously prepared observations into coherent teaching sequences. They reuse the original scenes, source targets, display settings and package provenance. Each entry keeps its own source, case or population, side, sampling and native coordinate frame. Comparing views is a structured observation exercise across independently retained datasets.

| Course plan | Views | Teaching sequence |
| --- | ---: | --- |
| `integrated-hippocampal-fine-anatomy` | 15 | NextBrain CA1 and dentate layers, CA4 and local white matter; BigBrain subfields and midsurface; Julich CA1/DG population assignments; HCP1065 left/right fornix fields |
| `integrated-brainstem-cranial-anatomy` | 24 | Petrous/cochlear source models and CN VIII components; NextBrain auditory, vestibular, trigeminal, facial/abducens, oculomotor/trochlear and lower cranial nuclear assignments; independent Brainstem Navigator context |
| `integrated-cerebellar-fine-anatomy` | 26 | Z-Anatomy hemisphere, vermis and peduncular surfaces; SUIT lobular, vermal and nuclear fields; NextBrain individual cerebellar nuclear, layer and white-matter labels |
| `integrated-cortical-surface-layers` | 17 | Central cortical folds in Z-Anatomy; source cytoarchitectonic assignments in Julich; BigBrain pial and layer-boundary sheets with preserved surface cutaways |

The 82 entries select existing curriculum views. They add teaching organization and source-specific discussion prompts, rather than additional anatomical observations. The source curricula retain their own complete regional sequences.

## Prepare a session

Start the installed workspace with the intended data and SSD state directories. In **Teaching library**, choose **Start from a course plan**, select the exact local package for each required source, and prepare the desired plan. The prepared course appears in the organizer with a direct presentation link. Use `neuroimage teaching course-plans PLAN` to inspect source requirements from the command line, or `neuroimage teaching course-prepare PLAN --packages source-choices.json --data-root DATA_ROOT` for reproducible scripted preparation.

Introduce the source and representation at each chapter. A NextBrain view identifies an individual reconstructed block; a probability or maximum-probability map identifies its source population product; an original surface model identifies the delivered geometry. Each chapter prompt asks learners to name visible structures and describe relationships within that source. The full-section and same-point detail views retain identical physical targets.

Use **Compare another recorded view** to keep a second source visible while advancing the main course. Each panel retains its own source coordinates and selected structure. Ask learners to compare the source definitions, anatomical coverage and representation before comparing shape or extent. This is especially useful for a source-defined nuclear group versus separate histological subdivisions, or a cortical boundary sheet versus a tissue-layer label.

## Classroom use and recovery

After live rotation or structure exploration, **Return to course view** restores the recorded source state. Save additional teaching observations as scenes or notebook entries when they should become part of the session. **Export course** retains the portable source-bound sequence, prompts and provenance. The recipients use their own matching local atlas packages.

Use **Export scene** for a durable collection of individual observations and **Export teaching image** for an attributed image package. Browser saves are convenient for short sessions; the tested Chromium profile provides about 5 MB of local storage, shared by scene and notebook drafts at the same service address. A complete scene includes source definitions and processing records. A long teaching session can therefore fill browser storage with a few dozen saved views. The scene-file, notebook-file and data-drive course workflows continue to work at that limit. Retain exported copies before managing browser storage.

The workspace stores the last successfully opened course entry on the data drive. Restart the service with the same data root and open the saved course link to continue. Keep historical package versions while a saved scene or course references them. Original source files, large atlas packages and teaching exports remain separate from the code-only software distribution.

The engineering checks exercise all 82 entries, cross-source transitions, recorded selections and positions, native-space comparison and course-position recovery. Instructor review remains attached to exact image sets and their recorded judgments. Each new course is available for independent lesson assessment.
