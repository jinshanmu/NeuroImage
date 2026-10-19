# Changelog

## 1.0.0 — prepared for author review, 2026-10-19

- Add 64 source-preserved cortical and dural model objects and 32 arterial comparison views across eight healthy-volunteer MRA cases. Keep the ten main groups and expand the detailed index to 46 topics.
- Provide 39 source configurations, 1,965 source-specific entries, 193 built-in teaching sequences, 90 curricula with 796 views and 31 course plans with 684 selected views.
- Add a CerebrA first-session course, written lesson responses, self-rated review queues, and portable study-record import/export with exact source binding.
- Compact repeated recipe metadata in teaching scenes while retaining source and processing records and compatibility with historical scene files.
- Load image/model renderers when opened; use a lightweight cached anatomy catalog, conditional asset requests and session validation reuse. Avoid rendering the anatomy again after text-only edits.
- Restore exact local atlas bookmarks after service restart; keep page-based scrolling and complete wrapping labels.
- Reuse the current image or model viewer between course entries from the same source, while restoring every recorded view and keeping comparison coordinates independent.
- Simplify functional labels and remove decorative slogans.
- Open each anatomy group and detailed topic with all of its corresponding structures selected; whole-brain and direct source entries retain the complete atlas. Keep saved scene and lesson visibility.
- Add separate background switches and opacity controls: 2D context starts on, 3D context starts off in regional views. Use same-source brain surfaces or the available native image extent without changing foreground selection.
- Reuse image textures and batch redraws when adding and removing source meshes, including whole-brain background geometry.
- Render categorical palette indices directly so unlabeled image regions remain transparent.
- Apply the dark theme to native dropdown options while retaining keyboard selection and full selected labels. Verify browser Back and Forward across groups, topics, teaching and dataset pages.
- Center and magnify 28 brainstem nuclear teaching views so small target models remain clear alongside their original nerve context.
- Add a resumable Linux installer, pinned runtime bootstrap, source-aware diagnostics, acquisition/construction quickstart, portable storage profile and a complete dataset access table.
- Remove unused frontend frameworks and their dependencies; retain the four runtime packages used by the application and keep their locked versions unchanged.
- Update citation, installation, contribution, privacy, security and maintenance documentation for a code-only release. Publication remains pending final author review.

## 0.15.0rc2 — detailed normal anatomy, prepared for review, 2026-10-15

- Refine image and model notebook presentation on 2026-10-18: keep author metadata in the editor and exports, and present the lesson in a bordered card with wrapping text and controls.
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
