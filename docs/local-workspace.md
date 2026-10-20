# Local anatomy workspace

The workspace provides source acquisition, construction, verification, discovery and browsing through one local browser interface.

## Start

```bash
conda activate NeuroImage
neuroimage workspace --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state --workers 2
```

Open `http://127.0.0.1:8765`. Use `--no-browser` to print the address, or `--port` to choose another local port. Keep the terminal running. WebGL2 is required.

The data and state roots must be separate, non-nested directories. The default floors are 400 GiB free on the data drive and 60 GiB on the state drive. Use `--storage-policy config/storage-portable.json` for the documented portable profile.

## Source to atlas

1. In **Browse anatomy**, choose a dataset and open **Download, install and build**.
2. Inspect source versions, licenses, required files and storage budgets. Manual downloads use the same declared input paths.
3. **Acquire or verify** reuses matching files and resumes interrupted transfers.
4. **Build or resume** reuses completed construction outputs when their signatures match.
5. **Open atlas** validates and opens that exact local package. Historical versions remain separately available.

**Local atlases** provides source-specific structure search. Use names, original abbreviations or stable IDs. Opening a result selects its exact source target and preserves native coordinates. Image-only acquisitions have no invented labels.

```bash
neuroimage search "trigeminal" --data-root /path/to/data/NeuroImage
neuroimage library --data-root /path/to/data/NeuroImage
```

The [browser guide](getting-started.md) covers sections, surfaces, cutaway, backgrounds, comparison and scene export.

## Stop and recover

One operation runs at a time. **Stop operation** interrupts the owned process group while retaining originals and completed checkpoints. Closing the browser does not cancel work. Ctrl+C stops the service.

Reuse the same roots to retain operation history. Acquisition, build and activation records are shown in pages of thirty. An interrupted process is recorded as interrupted; repeat the same source operation to resume. The state lock prevents concurrent owners.

Old teaching operation files remain on disk for the testing workflow but have no actions or links in this release. Notebook and course creation, preparation, import, management and presentation endpoints are removed. The job API accepts only `acquire`, `build` and `activate`; the schema is in `schemas/workspace-request.schema.json`.

All mutations require the local page's exact origin and session token. Ordinary `neuroimage serve` is a viewing service. Software distributions contain no acquired anatomy.
