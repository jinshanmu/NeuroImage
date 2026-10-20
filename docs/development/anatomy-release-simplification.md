# Anatomy release simplification

The 2026-10-20 formal branch removes Teaching library, course creation/editing/import/preparation/presentation, Learning tools, guided lessons, identification practice, study records and notebook editing/presentation.

The complete implementation remains in `codex/release-testing`, starting at `a712e67`. The formal branch started at `dc77e77`. These are independent checkouts. No removals are applied to the testing checkout.

## Product boundaries

- The browser has anatomy, dataset-management and atlas routes. Historical teaching bookmarks return to anatomy.
- Teaching/course/content APIs and CLI teaching commands are removed. Workspace requests accept only acquisition, construction and atlas activation.
- Teaching preparation recipes, course plans, frontend components and their dedicated helpers/tests are removed from the formal distribution.
- Anatomy sources, acquisition recipes, coverage catalogs, native image/geometry construction and validation remain intact.
- Surface opacity, cutaway, cursor controls and source attribution remain available in viewer details.
- Source-bound scenes, browser scene storage, credited image exports and independent comparison remain available.

Atlas manifest contracts still validate historical `lessons.json` assets. Source recipe lesson definitions and their evidence catalog remain package metadata, so existing packages keep their identities and validation behavior. The browser does not fetch or execute lessons.

Existing image/model scene files retain their anatomical display state, annotations and provenance. Removed lesson state is ignored on import. No notebook/course/study file or browser record is deleted. Historical preparation records remain on disk but are omitted from the current operation list.

## Validation

Run the complete Python and frontend suites, then build the viewer. `tests/test_anatomy_release.py` checks removed routes and commands, rejection of retired jobs, and preservation of historical user records. Scene tests cover historical lesson-state imports without changing native display settings.

Run `scripts/browser_anatomy_release.js` through Playwright CLI with an isolated browser profile and the local source workspace. It visits the latest available package for every source configuration, checks complete initial structure visibility, changes visibility, switches image layouts, tests 2D magnification and model framing, and captures each canvas. It also rejects requests for retired learning resources. Optional `check-from` and `check-count` URL parameters bound a verification batch.

`scripts/browser_anatomy_workflow.js` exercises legacy bookmark recovery, dataset navigation, regional backgrounds, cursor and cutaway controls, scene save/restore/import/export, independent comparison, expanded and narrow layouts, and model scenes. Its image exports go to the configured data drive. For Chromium distributed through Snap, configure a downloads directory accessible to both the browser and Playwright instead of their separate temporary namespaces.

Catalog comparison must retain all 39 source configurations, 68 local package records, main groups and detailed topic coverage from the pre-change snapshot. Every available local package must still pass its asset verification before opening. These local counts include historical versions and are not a claim of anatomical completeness.

Before committing, compare the testing checkout against its recorded file hashes and confirm its original HEAD and clean status. Audit the built wheel/source archives for omitted teaching implementations as well as the existing code-only packaging boundary.

## Verification record — 2026-10-20

- Python: 221 tests passed. Frontend: 135 tests in 23 files passed; type checking and production build passed.
- All 68 local atlas packages passed asset verification. Catalog comparison retained all 39 configurations and their anatomy coverage.
- The browser visited all 39 current configurations in sequence. Structure visibility, image layouts, 2D magnification and model framing passed, with 39 nonblank canvas captures, no page exceptions and no requests for retired teaching resources.
- Seven browser workflow checks passed, including source/model scene recovery, cutaway, independent comparison and narrow layout. Both image-export archives retained their exact source binding and every required source license.
- The wheel and source archive contain all 39 source recipes and none of the removed teaching modules, curricula or course plans. The wheel's bundled viewer and local service also passed an isolated installation check.
- All 581 tracked testing-branch files match the pre-change hashes; its HEAD remains `a712e67` and its working tree is clean. Every deleted formal-branch file has its original copy in that checkout.

These checks establish software behavior and preservation of the existing source data; they do not add an anatomical review judgment.
