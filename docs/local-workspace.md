# Local data and teaching workspace

The installed workspace brings acquisition, construction, library and teaching into one local browser interface. Every source recipe uses the same controls and retains its own license, native space and provenance. Software archives contain no acquired data. Linux is the currently verified platform; the job controller uses Linux process groups and file locks.

## Start

Activate the dedicated `NeuroImage` environment and install the wheel as described in [Getting started](getting-started.md). Create an imaging directory on the intended data drive and a separate state directory on SSD. Set these variables to your own paths:

```bash
export ATLAS_DATA_ROOT=/path/on/data-drive/NeuroImage
export ATLAS_STATE_ROOT=/path/on/ssd/NeuroImage-workspace
mkdir -p "$ATLAS_DATA_ROOT" "$ATLAS_STATE_ROOT"
neuroimage workspace --data-root "$ATLAS_DATA_ROOT" --state-root "$ATLAS_STATE_ROOT" --workers 2
```

The command opens `http://127.0.0.1:8765`. Use `--no-browser` to print the address without opening a tab, or `--port 8766` if another viewer uses that port. Keep the terminal running. Only the local computer can reach the service. A WebGL2 browser is required; Node is unnecessary with an installed wheel.

Default safety floors are 400 GiB free on the data drive and 60 GiB on the state drive. `--storage-policy path/to/storage-policy.json` accepts the existing `hdd_minimum_free_gib` and `ssd_minimum_free_gib` fields. The two roots must be separate, non-nested directories. The software does not reformat or select drives.

## Source to atlas

1. In **Browse anatomy**, select a source from the dataset list and choose **Download, install and build**. In **Source recipes**, inspect input presence and acquisition/construction budgets. Open **Source, license and required files** for versions, citations, official links and relative save paths. Presence does not assert checksum validation.
2. Use **Acquire or verify**. Matching files and selected extracted members are reused. Interrupted HTTP transfers use the acquisition resume mechanism. Archives requiring manual access show their official link, size and destination. Save the original archive there and repeat the operation.
3. Use **Build or resume** after required inputs are present. Construction checks source hashes, parameters and implementation signatures. Complete matching packages reuse their assets; interrupted matching builds reuse completed checkpoints.
4. Select **Browse atlas**, or **Local atlases → Open atlas** for an existing version. Opening validates assets and geometry. Historical versions remain distinct. No registration or cross-source label correspondence is implied.

The viewer begins with **Full sections**, showing the complete available source field of view. Select a location, then **Magnify at cursor** or adjust **2D zoom**. **Full sections** returns to context while preserving the physical point and selection. Partial source coverage remains partial; magnification adds no anatomical detail.

**Browse anatomy** returns to the source catalog. Choose a source and **Download, install and build** to open its manager; use **Local atlases → Open atlas** to return to a verified package. Export scene and notebook files before navigating away when they should be retained for another session.

Use **Expand viewer** to give the complete section more screen space. Select Axial, Coronal or Sagittal for one large plane, or retain the 2D + 3D layout. **Structure library** and **Learning tools** remain available; on wide screens they dock beside the image. **Exit expanded view** or Escape returns to the ordinary layout. Keyboard navigation stays within the expanded controls. The same canvas, graphics context, source coordinates and selection are retained. Expansion is a temporary workspace presentation choice; portable scenes retain their anatomical viewing state independently of the recipient's screen size.

## Search across source atlases

In **Local atlases**, use **Find a structure across local atlases** to search English names, source abbreviations or stable IDs. Dataset and learning-module filters apply. Results retain their exact dataset, native space and package version, including historical versions; a matching name is not an anatomical equivalence. Results are paged in groups of 100. Image-only acquisitions have no structure entries.

**Open structure** checks that exact package and opens its own source target with complete sections and 3D context. It clears a previous lesson or surface cut for this navigation, retains scene notes, and does not overwrite saved scenes or notebooks. Reach the manager again through **Browse anatomy**, the source entry and **Download, install and build**. Returning to an atlas preserves subsequent live exploration within the current browser session rather than repeating the original search jump.

The same metadata-only search is available offline at the command line:

```bash
neuroimage search "trigeminal" --data-root "$ATLAS_DATA_ROOT"
neuroimage search "RN_l" --data-root "$ATLAS_DATA_ROOT" --dataset brainstem_navigator_mni
neuroimage search "left" --data-root "$ATLAS_DATA_ROOT" --offset 100
```

Search checks metadata and declared file sizes without decoding images or computing geometry. Opening performs the normal asset/hash validation. Unavailable or incomplete packages are counted and omitted; they are not treated as sources with no anatomy.

## Prepare and present

In **Local atlases**, choose a package and compatible teaching recipe, then **Prepare teaching**. **Open prepared notebook** opens its exact source package and presents the first recorded view. This navigation reloads the page: save or export unsaved work first. Opening does not overwrite a previously saved browser notebook.

Use previous/next controls, live exploration and **Return to recorded view**. **Export teaching image** retains the image, scene, source/processing records and license snapshots. Source rights continue to apply. Prepared curricula remain unreviewed drafts; engineering acceptance does not confer anatomical expert approval.

## Stop and recover

One operation runs at a time; `--workers` controls construction concurrency from 1 to 8. **Stop operation** interrupts its owned process group. Original files, completed checkpoints and bounded failure logs remain. Repeat the operation to reuse them. Closing the browser does not cancel a job; use Stop or Ctrl+C in the terminal when desired.

Restart with the same roots to retain history. The SSD state records requests, progress, outcomes and at most 1 MiB of diagnostics per job. The interface displays thirty records per page; **Older operations** and **Newer operations** reach all saved records. After an unexpected exit, unfinished records become interrupted. An inherited lock prevents another controller while an orphaned owned job still runs. Do not remove this lock or run another workspace against the same data while an operation remains active.

Prepared-notebook links survive restart. The controller rechecks their hash, exact build signature and native-space binding before validating the original atlas. Open intentionally edited files explicitly with `neuroimage open <file> --data-root "$ATLAS_DATA_ROOT"`. Recover a missing original package; no newer version is substituted.

Retain the SSD state with recovery records and keep acquired originals and referenced atlas versions on the data drive. Prior accepted software can still open its original packages independently. No workspace action pushes, publishes or distributes anything.

## Interfaces and acceptance

The optional loopback API accepts installed recipe IDs, discovered package keys and compatible curricula, following `schemas/workspace-request.schema.json`. Arbitrary commands and paths are rejected. Mutations require the local page's exact origin and ephemeral session token. Ordinary `neuroimage serve` remains a viewing service.

`tests/test_workspace.py` covers cancellation, checkpoint retention/reuse, persisted recovery, controller ownership, request boundaries and teaching-source identity. `scripts/browser_workspace.js` exercises the real offline source-to-teaching interface using existing local fixtures. It verifies reuse, not a fresh internet download. Transfer and extraction behavior have separate checks in `tests/test_acquire.py`.


## Older operations after restart

**Operations** retains every saved operation and displays thirty records per page. Use **Older operations** and **Newer operations** to find earlier construction and teaching work. Starting an operation returns to the most recent page. **Browse atlas** always verifies and registers the exact original package before opening, including after the service restarts. **Open prepared notebook** restores its original package, source coordinates and teaching content. Missing or changed assets remain an explicit error; selecting another version never substitutes for the recorded package.
