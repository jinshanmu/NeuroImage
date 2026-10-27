# Detailed anatomy source coverage

The current application excludes NextBrain, IXI MRA, HumanBrainAtlas, Meso-vein MRI, VENAT, the Mouches arterial occurrence atlas, Human Inner Ear CT and the clinical TopCoW/TopBrain cohorts. Its catalog retains **52 topic definitions**, of which **46 have enabled sources**, with **136 topic–source bindings** and **1,683 selected structure memberships**. Five NextBrain-only topics and the former Mouches-only population arterial-occurrence topic have no current browse entry. The enabled release contains 22 source configurations from 12 families and 1,390 source-specific entries. Source definitions, licenses, exclusion and inspection records, and saved-scene records are retained. User-authorized removal of out-of-scope data is documented in the [local data cleanup record](maintenance/local-data-cleanup-2026-10-24.md).

The earlier 24 October 2026 anatomy audit reviewed all 52 topics and changed 231 bindings to 229 before these source exclusions. Excluded-source findings and verification counts recorded below are historical results, not current source availability. A binding is one dataset attached to one topic; repeated datasets and separate volunteer cases count separately. These counts describe navigation choices, not anatomical completeness or the number of independent atlases.

Review covered source names, delivered structure IDs, original categories, source geometry and regional limits, historical package membership, and recorded image anchors. The three review partitions covered 16 cerebral/deep-nuclear topics, 18 pathway/CSF/brainstem/cerebellar topics and 18 cranial-nerve/vascular/skull-base topics. Correct existing selections were retained as well as correcting mismatches and recovering omitted subject structures.

## Coverage across the main navigation groups

The counts below aggregate every detailed topic under its parent. Whole brain has no separate subordinate topic in this catalog.

| Parent group | Catalog topics | Topics with enabled sources | Current bindings | Important retained limit |
| --- | ---: | ---: | ---: | --- |
| Whole brain | 0 | 0 | 0 | Its separate main selector is governed by major-compartment coverage requirements. |
| Cerebral cortex | 11 | 10 | 19 | Gross parcels, cytoarchitectonic assignments and laminar surfaces keep separate source definitions. |
| Deep nuclei | 5 | 4 | 19 | A named nucleus is valid partial coverage; a broad tissue class or neighboring pathway is insufficient. |
| White-matter pathways | 8 | 6 | 16 | Educational models, streamlines and probability fields remain distinct representations. |
| Ventricles and cisterns | 3 | 3 | 5 | Ventricular labels are not cistern labels; the cisternal entry is an explicit source-image observation. |
| Brainstem | 3 | 3 | 6 | Named nuclei and gray-matter complexes are distinguished from whole regional backgrounds, roots and fiber tracts. |
| Cerebellum | 4 | 3 | 5 | Lobules, deep nuclei and population assignments remain distinct; peduncles belong in pathway discovery. |
| Cranial nerves | 5 | 5 | 14 | A nerve/root subject must actually be supplied; related central nuclei alone cannot qualify a nerve source. |
| Arteries and veins | 10 | 9 | 47 | A named segment or model must be supplied for its topic; excluded image/statistical sources do not contribute bindings. |
| Skull base | 3 | 3 | 5 | Named bones, local inner-ear structures and pituitary-system context have different extents. |
| **Total** | **52** | **46** | **136** | Source-version checks may further reduce choices for an older or incomplete enabled package. |

During the earlier anatomy audit, source additions and removals partly offset one another. The subsequent source exclusions remove every affected binding while retaining the six now-unavailable topic definitions. Removing the dedicated inner-ear CT binding leaves the inner-ear topic available through MIDA and Z-Anatomy.

## Preserved findings from the earlier anatomy audit

### Cerebral and deep nuclear structures

NextBrain Case 1 block 33 label `433`, the **parasubthalamic nucleus**, was selected by a name resembling “subthalamic.” It was reassigned to hypothalamic discovery during that audit; the NextBrain binding is now excluded altogether. The original anatomical study identifies this nucleus as a differentiation of the lateral hypothalamic area, distinct from the adjacent STN. The actual source STN subdivisions `315`, `316` and `321` were added to the subthalamic selection. [Goto and Swanson, 2004](https://physoc.onlinelibrary.wiley.com/doi/full/10.1002/cne.11036).

CIT168 label `13` and the Z-Anatomy habenula object moved from hypothalamic discovery into the existing topic now explicitly titled **Thalamic, geniculate, habenular and subthalamic regions**. The earlier audit included delivered NextBrain habenular nuclei and commissural context under that stated scope; those source bindings are now excluded. The habenula is part of the epithalamus. [NLM anatomical definition](https://www.ncbi.nlm.nih.gov/mesh/68019262).

Name matching also missed genuine nuclei whose source names use abbreviations or omit their parent region. The earlier corrections recovered NextBrain VA, VL, VLC, MD and VPM subdivisions, amygdalar subnuclei and hippocampal alveus/fimbria. Those records are preserved historically; current enabled content retains the recovered CerebrA entorhinal labels `36` and `87`. In the archived NextBrain definitions, caudate tail `393`, posteroventral putamen `349` and ventral pallidum `120` were treated as nuclear subjects even where the original source hierarchy groups them under “Cerebral White Matter.” Original source categories are preserved rather than rewritten to hide this distinction.

Amygdalar transition areas remain in medial temporal anatomy. They are not added as nuclear subdivisions merely to increase the regional nuclear inventory. Conversely, parafascicular, subparafascicular and fasciculosus nuclei and the bed nucleus of stria terminalis remain actual nuclear subjects despite containing words associated with fibers.

Previously omitted, explicitly named Julich-Brain and MIDA subject regions now appear in the matching detailed topics. CerebrA basal-forebrain labels and Z-Anatomy paracentral models were also recovered. These additions use the delivered regional names; they do not equate cytoarchitectonic assignments, gross parcels and categorical head-model classes. Whole superior frontal gyri were removed from the orbital/frontopolar selection because the source already supplies the specific basal orbital and frontopolar models.

Anterior olfactory nucleus and olfactory tubercle sections were retained as limited basal-forebrain content, with notes distinguishing these sources from hypothalamic or mammillary coverage. This placement is supported by original human basal-forebrain work; it does not require claiming that every supplied olfactory structure is a hypothalamic nucleus. [Ikemoto et al., 1998](https://pubmed.ncbi.nlm.nih.gov/9535130/).

### Pathways, brainstem and cerebellum

Four Z-Anatomy peduncle models moved from cerebellar lobules into **Cerebellar trajectories and peduncles**. That source supplies superior cerebellar and floccular peduncle models; the selection does not imply inferior or middle peduncle models. Delivered Z-Anatomy optic chiasm/tract objects were added to visual pathway sections, and source cingulum probability definitions were recovered alongside the existing HCP pathway choices.

Whole midbrain halves, collicular brachia, commissures and complete mixed tissue-block inventories no longer substitute for named nuclear selections. Brainstem topics now distinguish actual gray matter and reticular regions from tracts, peduncles, nerve roots and broad white matter. Genuine parabigeminal sections and omitted Brainstem Navigator nuclear/subregional fields were recovered. Compound author regions remain unsplit, including tegmental, raphe, vestibular and viscero-sensory-motor complexes. The superior olivary complex is retained under regional brainstem nuclei rather than being presented as a named cranial nerve nucleus. These distinctions follow the published source definitions. [Auditory brainstem source](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2019.00764/full), [combined lower-brainstem source](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2019.01425/full), [expanded Brainstem Navigator source](https://pmc.ncbi.nlm.nih.gov/articles/PMC8817713/).

### CSF, cranial nerves and skull base

The cisternal topic retains the SPL/NAC T2 prepontine observation at its recorded source voxel. Nearby brainstem and fourth-ventricular objects provide orientation. MIDA ventricular CSF and its general CSF class do not establish a named cistern observation, so MIDA no longer qualifies for this detailed topic. No cisternal membrane or independently segmented cistern is inferred.

Nine nuclear-only or tract-only NextBrain bindings were removed from the oculomotor, trigeminal, facial/auditory and lower cranial nerve topics. At that stage those central structures remained accessible through nuclear or tract discovery, and matching nerve-root blocks retained limited nerve-topic membership. The current exclusion removes all NextBrain source choices, including those formerly valid bindings. Computational cranial trajectories retain their own source representation.

Both MUG500 **whole-skull** configurations were removed from **Skull-base bone models**. They remain available as datasets; a whole-skull mask or mesh is not a source of separately named skull-base bones or openings. The bone topic now uses the actual named Z-Anatomy bone surfaces and explicitly states that visible openings are not independently labeled foramina. The dedicated inner-ear CT integration is now archived and excluded from the current scope. Added Z-Anatomy cochlear/vestibular models and MIDA cochlear content retain their separate definitions. The archived NextBrain block 45 sellar selection identified only the infundibular stalk; this source is no longer enabled.

### Arterial and venous observations

Z-Anatomy proximal arterial selections now distinguish main/communicating arterial models from cortical and cerebellar branch models. Author-defined ACA/PCA model extents are not relabeled as THU segment boundaries. The earlier venous-contrast image and statistical-field entries were explicitly observational context rather than named dural-sinus segmentations; both are now excluded.

The paired A1 topic decreased from eight to six case sources: cases `007` and `030` lack one of the required A1 annotations. The anterior communicating topic decreased from eight to six because cases `001` and `021` lack its named annotation. Posterior communicating discovery decreased from eight to seven because case `001` has neither annotated PCom. Cases `006` and `010` remain valid unilateral examples, with the supplied side stated. All eight P1/basilar sources remain eligible; case `007` explicitly supplies left P1 with basilar context and has no right-P1 annotation. An unannotated vessel is not evidence of anatomical absence or a named variant.

## Subject eligibility and partial coverage

Each structure-based detailed binding declares the actual subject IDs that can qualify it. At least one supplied subject must exist in the chosen package. Background models, connected pathways or adjacent nuclei can be retained where the topic describes that context, but they cannot alone establish the named subject. This is a static, reviewed ID selection, not anatomical inference from runtime name substrings.

Honest partial coverage is permitted for enabled sources. One supplied nuclear region, hemisphere or unilateral communicating artery can qualify when it is the actual subject and its limit is stated. Five detailed Z-Anatomy surface topics use their specific sulcal or regional subjects without requiring every bilateral object. Older packages containing only adjacent gyri or medial context remain ineligible. Explicit compound tasks keep stronger requirements: paired A1 needs both A1 annotations, and P1/basilar discovery requires a basilar annotation plus at least one supplied P1. The cisternal image observation requires a recorded source entry. Statistical image fields retain their stated source methods without manufacturing structure labels.

On first opening a topic, the viewer selects one of its actual subject structures. Related source context can remain visible without taking the initial selection. Saved scene selections remain unchanged.

Source notes distinguish tissue blocks, whole-region parcels, separate nuclear subdivisions, statistical assignments, computational trajectories and independent educational surfaces. Neither a binding nor a source count implies complete bilateral anatomy, microscopic accuracy, population prevalence or boundary correspondence between sources.

## Preservation and verification scope

These corrections change discovery metadata, selected IDs, source eligibility and explanatory text. Original images, categorical labels, probability fields, model geometry, source names, acquisition records, citations and coordinate frames are retained. Removed topic membership does not delete a dataset or its original anatomical content.

The historical before/after counts are derived from the saved pre-audit and post-audit catalogs. The current enabled counts are derived from the [detailed topic catalog](../src/neuroimage/catalogs/anatomy-topics.json) after the source exclusions. The internal cerebral, pathway and neurovascular finding records document individual reviewed source IDs and the reasons for changes. Source-definition review remains distinct from an independent expert reassessment of the original anatomical delineations.

Historical verification completed on 24 October 2026 **before the source exclusions**:

- All 229 then-enabled bindings resolved against the delivered manifests. Their 2,503 selected structure memberships include only declared subjects and related context. All 226 structure-based bindings reject context-only packages; three bindings explicitly use image observations or statistical fields.
- All 68 stored package manifests, including 29 historical versions, passed metadata verification: 490 runtime topic bindings, 4,642 selected-ID references and 4,381 primary-ID references. All 486 structure-based runtime bindings reject context-only contents. A further 181 potential historical bindings are correctly excluded because their package lacks the required subject.
- The browser checked all 52 topic cards, their complete source selectors and every source coverage note. One representative source per topic was then opened, reached Ready, and exported as a scene. All 52 exported visible-ID sets exactly match runtime coverage; every initial selection is an actual topic subject, or null for the cisternal image observation. No page errors occurred. This rendering check covers 52 representative sources, alongside the complete metadata audit above.
- The complete Python suite passed: **409 tests**. The frontend suite passed: **158 tests**. Type checking, the production build and diff whitespace checks passed.

These pre-exclusion receipts remain historical evidence; they do not verify or re-enable an excluded source. Current acceptance must exercise the enabled-source policy and the 46 available topics. [Browser regression workflow](../scripts/browser_detailed_anatomy.js) and the detailed anatomy regression tests preserve these checks for future catalog changes.
