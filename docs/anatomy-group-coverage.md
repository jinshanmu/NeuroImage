# Anatomical group coverage

The main selectors offer sources with broad relevant anatomy and state each source's actual range. A source count does not imply a complete inventory of every structure in that system. Enabled regional sources, isolated nuclei, adjacent context and source-image observations remain accessible through detailed topics or their dataset page. NextBrain, IXI MRA, HumanBrainAtlas, Meso-vein MRI, VENAT, the Mouches arterial occurrence atlas, Human Inner Ear CT and the clinical TopCoW/TopBrain cohorts are excluded from the current application. Source definitions, licenses, exclusion and inspection records, and saved-scene records are retained. User-authorized removal of out-of-scope data is documented in the [local data cleanup record](maintenance/local-data-cleanup-2026-10-24.md).

| Group | Main sources | Scope retained in the interface |
| --- | --- | --- |
| Cerebral cortex | SPL/NAC, CerebrA, Julich-Brain, BigBrain layers, Z-Anatomy | Parcels, cytoarchitectonic regions or cortical boundary surfaces; no whole-tissue masks or hippocampal-only source counted as a broad cortical atlas |
| Deep nuclei | SPL/NAC, CerebrA, CIT168, MIDA, Julich-Brain, Z-Anatomy | Source nuclear and hypothalamic regions; hippocampal cortex, glands, optic chiasm and undivided ventral diencephalon are excluded |
| White-matter pathways | HCP1065 streamlines, HCP1065 probabilities, Z-Anatomy | Named bundles or source pathway models; probabilities and trajectories are distinguished |
| Ventricles and cisterns | SPL/NAC, CerebrA, MIDA, Z-Anatomy | Ventricular compartments, broad CSF classes or a declared image observation anchor; no invented cistern segmentation |
| Brainstem | SPL/NAC, CerebrA, Brainstem Navigator, MIDA, Z-Anatomy | Source brainstem regions, nuclei and models; Brainstem Navigator's partial reference coverage is explicit |
| Cerebellum | SPL/NAC, CerebrA, MIDA, SUIT, Z-Anatomy | Tissue classes, regional labels, lobules or source models; individual deep nuclei and single tissue blocks stay in detailed topics |
| Cranial nerves | MIDA, HCP1065 streamlines, Z-Anatomy | Nerve classes, roots or computational trajectories; HCP supplies II, III, V, VII and VIII only |
| Arteries and veins | MIDA, Z-Anatomy and eight THU MRA cases (10 configurations) | Named models, broad source vascular classes and proximal arterial segments remain distinct; no complete vascular tree is inferred |
| Skull base | MIDA, Z-Anatomy | Named skull-base anatomy and declared dural, sellar or petrous context; whole-skull backgrounds remain on their dataset pages; MIDA and Z-Anatomy retain their explicitly named inner-ear structures in detailed topics |

The whole-brain selector remains limited to SPL/NAC, CerebrA and MIDA, with labels required across all five declared major compartments.

Category names alone do not establish anatomy. Explicit exclusions prevent the Z-Anatomy corpus callosum from becoming a cortical region and prevent hippocampal cortex, glands and visual pathways from being counted as deep nuclei. Brainstem Navigator's four STh1/STh2 subdivisions belong to subthalamic discovery, and are excluded from brainstem selection. Z-Anatomy red nuclei remain available under midbrain anatomy.

The catalog retains five topic definitions that previously depended entirely on NextBrain: cortical tissue blocks, deep nuclear tissue blocks, forebrain tract sections, brainstem tract sections and cerebellar tissue-block anatomy. These definitions have no enabled sources and are not shown as available choices. The former Mouches-only population arterial-occurrence topic also has no enabled source. The other 46 topics retain 136 enabled topic–source bindings.

Engineering verification checks source-version membership and selection against the delivered manifest. These checks preserve source definitions and do not constitute independent anatomical review.

The subsequent [Detailed anatomy coverage audit](detailed-anatomy-coverage.md) records the earlier 52-topic audit and the current exclusion status, including historical package eligibility.
