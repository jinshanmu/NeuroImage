# NeuroImage Atlas

NeuroImage 0.15.0rc2 constructs local normal intracranial atlases and presents linked 2D source sections, 3D anatomy, teaching notebooks and courses. It includes the 0.15.0-rc.2 offline frontend with IndexedDB teaching storage and legacy scene compatibility. Four equal panels remain in one row with 3D on the right; **Fit visible 3D** keeps complete visible anatomy within its frame as the window or camera changes.

Run `neuroimage workspace --data-root <data-drive-directory> --state-root <ssd-state-directory>` in the dedicated `NeuroImage` Conda environment. The anatomy home opens local atlases, **Teaching library** organizes source-bound views, and **Data tools** provides acquisition and construction. Linux is the verified installation platform. Viewing uses a WebGL2 browser; Node is needed only to rebuild frontend sources.

The package supplies 39 source configurations, 75 English curricula with 700 views and 26 course plans selecting 580 views. The development collection has 1,901 source-specific entries and eighteen original source point annotations. Source definitions may overlap. All datasets use the same acquisition, construction, validation, viewing and teaching interfaces with individual source versions and licenses.

## Coverage

General cortex, deep regions, ventricles, brainstem and cerebellum are available through SPL/NAC, CerebrA, MIDA, CIT168, Julich-Brain and Brainstem Navigator. Fine anatomy adds eleven normal-case NextBrain tissue blocks (571 block entries), 28 BigBrain cortical-layer and hippocampal surfaces, 64 HCP1065 probability fields, eight healthy-volunteer MRA cases (151 source segments), 34 SUIT cerebellar compartments, 286 Z-Anatomy source objects and native inner-ear CT with all three source fluid-space labels. Existing HCP1065 trajectories, source-native MRI, arterial occurrence, venous statistics, skull evidence and cisternal observation views remain available.

See `docs/nextbrain-fine-anatomy.md`, `docs/bigbrain-fine-surfaces.md`, `docs/hcp1065-probability-fields.md`, `docs/thu-cerebral-mra.md`, `docs/suit-cerebellar-anatomy.md` and `docs/z-cerebellar-ventricular-context.md` for exact source definitions, acquisition sizes, geometry, build parameters and teaching paths. `docs/specialist-follow-up.md` records the next bounded content increments.

## Build and use

Install the code-only wheel into `NeuroImage`, then run `neuroimage recipes`, `neuroimage acquire`, `neuroimage build`, `neuroimage validate` and `neuroimage workspace`. `docs/getting-started.md` provides complete commands. SSD holds software, environments, configuration and build caches; the data drive holds original sources, local atlases, large benchmarks and literature. Acquisition estimates peak storage, resumes transfers and verifies source hashes. Construction checkpoints completed assets and reuses unchanged results.

Images retain original units, axes, affines and sampling. Source-labelled targets use actual member voxels. Probability fields and overlapping compartments retain their independent values. Source models retain their declared native XYZ coordinates. Explicit verified correspondences connect image and label representations; native comparisons remain independent. Individual source methods and coverage accompany the browser and exports.

Choose an installed curriculum with `neuroimage teaching recipes`. Prepare it using `neuroimage teaching prepare CURRICULUM --atlas MANIFEST --data-root DATA_ROOT`, then open the printed notebook with `neuroimage open NOTEBOOK --data-root DATA_ROOT`. **Start from a course plan** in the teaching library prepares a multi-source course from exact package choices. Teachers can edit prompts, add scene notes, capture numbered location markers, save notebooks, compare recorded views and continue from the last course entry after restart.

**Save scene**, **Export scene** and **Export teaching image** preserve camera, source position, selected/visible structures, contrast, overlays, annotations and source identity. Teaching image ZIPs include a credited PNG, portable scene, rendering details, provenance and source licenses. Historical package identities remain resolvable with `neuroimage locate`; preserve any package referenced by saved teaching content. `docs/teaching-library-and-courses.md` and `docs/local-workspace.md` describe recovery.

## Software and source rights

The software is Apache-2.0. Distributions contain code, schemas, recipes, build methods and English documentation. Users obtain their own source images, labels, models and trajectories and construct separate local atlas packages. Each source retains its own terms and attribution; permitted exports retain those records. Z-Anatomy construction uses the separately installed Blender 5.2.2 LTS application runtime.

Engineering checks cover native coordinates and laterality, source identity, linked interaction, reproducible builds, scene restoration, offline installation and teaching export. Instructor review is tracked for exact named image sets, independently of software development progress. Accepted examples support their stated introductory teaching purpose; the remaining source and lesson judgments stay separately recorded.
