# Changelog

## 0.15.0rc2 — detailed normal anatomy, prepared for review, 2026-10-15

- Preserve the ten main anatomy groups and add 35 source-specific subordinate topics.
- Connect those topics to all eleven selected NextBrain tissue blocks and all 64 HCP1065 probability fields. Fit visible surfaces when opening detailed image views and keep magnified 3D cursor guides thin.
- Add native Dataset A inner-ear CT with original intensities, complete three-class labels, six recorded teaching views and explicit acquisition/calibration evidence.
- Extend Z-Anatomy from 213 to 286 original author objects with nine curricula and 73 recorded views of nuclear, limbic, commissural, brainstem and sellar context.
- Add five healthy-volunteer MRA configurations. Eight individual cases now support a 16-view comparison course, plus an 11-view course distinguishing individual and population evidence.
- Keep original loose model vertices while fitting the camera to actual triangle surfaces, fixing distant unused vertices that displaced some source models from view.
- Record 39 configurations, 19 source families, 1,901 source-specific entries, 75 curricula with 700 views and 26 course plans with 580 views. These counts do not establish anatomical completeness or confirmed variant diagnoses.
- Keep acquired anatomy outside the code-only review candidate. Publication and submission remain pending author approval.

## 0.15.0rc1 — prepared for review, 2026-10-15

- Group the home sidebar by upstream dataset; show cases, regions and source representations on a secondary page.
- Display complete selected values and anatomical names without ellipsis, preserving native selection and keyboard behavior.
- Keep source libraries, learning tools, notebooks and courses in the browser page scroll flow; resize the canvas with its responsive container.
- Add recoverable URL navigation, source search and direct opening of ready local packages.
- Document the independent software architecture, implemented modules and future anatomical content plan.

- Store scenes, image/model notebooks and course drafts in IndexedDB. Existing localStorage records remain readable and are retired individually only after an explicit replacement commits. Failed writes retain previous records and open work.
- Wait for notebook and course draft recovery before initializing editors. Serialize course draft writes to preserve edit order.
- Allow custom local packages to open without a predefined anatomy-group assignment.
- Expose `build_imported_atlas` for an already imported adapter result, with dataset-directory validation.
- Prepare public installation, contribution, security, citation and release instructions, plus a code-only GitHub candidate and continuous-integration workflow.
- Retain all 33 anatomical source configurations, exact historical atlas packages and source-specific teaching definitions. No new anatomical validation or learning-effectiveness result is claimed.

This is a local release candidate. GitHub publication and journal submission require the author's review and explicit approval.

## 0.14.1 — 2026-10-14

- Stabilize auxiliary mesh-volume estimates using centered float64 tetrahedra and accurate partial sums. Existing geometry and voxel-count volumes are unchanged.
- Record independent, byte-identical code-only wheel/source rebuilds and 222 passing backend checks on Linux.
