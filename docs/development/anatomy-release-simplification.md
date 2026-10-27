# Anatomy release simplification

The 2026-10-20 formal branch removes Teaching library, course creation/editing/import/preparation/presentation, Learning tools, guided lessons, identification practice, study records and notebook editing/presentation.

The complete implementation remains in `codex/release-testing`, starting at `a712e67`. The formal branch started at `dc77e77`. These are independent checkouts. No removals are applied to the testing checkout.

On 2026-10-24, the formal branch also removes the Datasets sidebar's **Find a dataset** and **Ready atlases only** controls, their filter state, reset action and dedicated search styles. The sidebar lists every dataset family by name, with ready-first ordering and dataset navigation. Per-button readiness captions are also removed from the formal sidebar. These two filters remain implemented in the independent `codex/release-testing` checkout; its original HEAD and tracked file hashes are preserved.

On 2026-10-25, the formal atlas page removes **Fit visible 3D**, **Focus selected 3D**, **Center 3D on cursor** and **Full 3D context**. All four remain executable in the independent `codex/release-testing` checkout, which is unchanged. Automatic framing, existing scene camera settings and the underlying 3D display logic remain supported by the formal viewer.

## Current product boundaries (2026-10-24)

- The browser has anatomy, dataset-detail and atlas routes. Historical teaching bookmarks return to anatomy; old workspace-management URLs return to dataset details.
- Teaching/course/content APIs and CLI teaching commands are removed. Source acquisition and construction remain CLI maintenance tasks; the browser has no installation or operation-management controls.
- Teaching preparation recipes, course plans, frontend components and their dedicated helpers/tests are removed from the formal distribution.
- Anatomy sources, acquisition recipes, coverage catalogs, native image/geometry construction and validation remain intact.
- The **2D overlay**, **3D opacity**, cutaway and cursor controls remain in the viewer. Both image-workspace zoom sliders offer 1–10 in 0.1 increments, with a default factor of 1. Source introductions, citations, licenses and coordinate definitions remain on home dataset pages.
- Same-category comparison and CLI opening of exact-source scene files remain available. Browser scene saving/restoration/import/export and credited image-export controls remain in the development branch.

Atlas manifest contracts still validate historical `lessons.json` assets. Source recipe lesson definitions and their evidence catalog remain package metadata, so existing packages keep their identities and validation behavior. The browser does not fetch or execute lessons.

Existing image/model scene files retain their anatomical display state, annotations and provenance. Removed lesson state is ignored when opening scenes through CLI startup. No notebook/course/study file or browser record is deleted. Historical preparation records remain on disk; their management interface is absent from the formal webpage.

## Validation

Run the complete Python and frontend suites, then build the viewer. `tests/test_anatomy_release.py` checks removed routes and commands, rejection of retired jobs, and preservation of historical user records. Scene-contract tests cover historical startup files without changing native display settings.

Run `scripts/browser_anatomy_release.js` through Playwright CLI with an isolated browser profile and the local source workspace. It visits the latest available package for every source configuration, checks complete initial structure visibility, changes visibility, switches image layouts, tests 2D magnification and model framing, and captures each canvas. It also rejects requests for retired learning resources. Optional `check-from` and `check-count` URL parameters bound a verification batch.

Nine formal browser flows now use explicit canvas `data-ready` checks and cover the read-only anatomy interface. `scripts/browser_anatomy_workflow.js` checks legacy routes, dataset navigation, display controls, independent comparison, ordinary page scrolling and narrow layouts without scene or export actions. The formal viewer uses its responsive layout without an **Expand viewer** button or expanded dialog; normal browser scrolling and page zoom remain available. Seven older scene/management workflows, including `scripts/browser_surface_cutaway.js`, are marked as development references. Use the preserved development implementation and matching source fixtures when maintaining those historical checks. Seventeen scripts passed Node syntax checks for the footer update; no browser workflow was executed for the subsequent expanded-view removal.

Catalog comparison follows the [current release inventory](../../config/anatomy-release-1.0.0.json): 22 enabled configurations, 1,390 source-specific entries, 52 topic definitions, 46 available topics and 136 topic-source bindings. Every enabled local package must pass asset verification before opening. Historical package versions and dated inventory counts remain separate records.

Verify the development preservation manifest and the intentional `006221e` update described below, then confirm the development working tree is clean. Audit formal wheel/source archives for the current UI boundary and the existing code-only packaging boundary.

## Verification record — 2026-10-20

- Python: 221 tests passed. Frontend: 135 tests in 23 files passed; type checking and production build passed.
- All 68 local atlas packages passed asset verification. Catalog comparison retained all 39 configurations and their anatomy coverage.
- The browser visited all 39 current configurations in sequence. Structure visibility, image layouts, 2D magnification and model framing passed, with 39 nonblank canvas captures, no page exceptions and no requests for retired teaching resources.
- Seven browser workflow checks passed, including source/model scene recovery, cutaway, independent comparison and narrow layout. Both image-export archives retained their exact source binding and every required source license.
- The wheel and source archive contain all 39 source recipes and none of the removed teaching modules, curricula or course plans. The wheel's bundled viewer and local service also passed an isolated installation check.
- All 581 tracked testing-branch files match the pre-change hashes; its HEAD remains `a712e67` and its working tree is clean. Every deleted formal-branch file has its original copy in that checkout.

These checks establish software behavior and preservation of the existing source data; they do not add an anatomical review judgment.

## Viewer footer update (2026-10-24)

The formal viewer now omits the footer beginning with **Dataset details**: scene saving, restoration, file import/export and image export. The MRI interaction hints and Ready footer are also removed. The original MRI error display has moved above the canvas, retaining viewer-error reporting. The independent model's status row and selected-object/source-geometry controls precede that boundary and remain available. Page- and canvas-level loading recovery remains in the formal interface. Source introductions, citations, licenses and coordinate definitions remain accessible from the home dataset pages.

These tools are retained as working development functionality in `codex/release-testing`, commit `006221e33c6110ac5e6f392bc1b17ea854ea432f`, whose parent is `a712e67cf6fad0766af6e9c84d279b62f05fa958`. Each development viewer adds a **Dataset details** shortcut to its existing Sources tools pane: MRI opens its `sources` panel and model opens its `sources` tab. Their original scene, status, error, teaching and source-information implementations remain intact.

Exact pre-removal formal components and their footer dependencies are preserved in that development checkout at `docs/development/preserved-viewer-footer/2026-10-24`, with a README and capture manifest. They record the former formal implementation separately from the development viewer's executable sources.

Existing scene files, saved browser records, notebooks and teaching records are not deleted. The formal CLI still locates and opens historical scene files against their exact enabled packages, without restoring retired lesson controls. Formal startup support for those files is separate from the removed browser scene toolbar.

### Start the preserved development tools

Use the independent development checkout and the existing `NeuroImage` Conda environment. Its frontend must be built from that checkout. Start its source implementation with `PYTHONPATH=src`, a separate port and a separate state root; the currently installed formal wheel is not the development application.

```bash
conda activate NeuroImage
cd /path/to/release-testing/NeuroImage
PYTHONPATH=src neuroimage workspace --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-development-state --port 8766
```

Browser storage belongs to its profile and service address, so the separate development port has its own browser store. Existing records at the original address remain untouched.

### Verification for this update

The development source passed type checking, its existing scene/model-scene/browser-storage tests (64 tests in three files), and its production build. The preservation commit contains only the two new source-details shortcuts and the source snapshots/documentation; the existing teaching and scene implementations are unchanged. The development working tree was clean after that commit.

The updated formal interface passed 239 frontend tests, type checking and its production build. The 20 October verification record above retains its original counts and original testing-branch HEAD; those statements describe that earlier checkpoint.
