# Local anatomy service and CLI maintenance

The local service discovers and verifies prepared atlas packages for anatomy browsing. Source acquisition and atlas construction use command-line tools. The webpage presents dataset introductions, ready atlas buttons and the viewer.

## Start

```bash
conda activate NeuroImage
neuroimage workspace --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state --workers 2
```

Open `http://127.0.0.1:8765`. Use `--no-browser` to print the address, or `--port` to choose another local port. Keep the terminal running. WebGL2 is required.

The data and state roots must be separate, non-nested directories. The default floors are 400 GiB free on the data drive and 60 GiB on the state drive. Use `--storage-policy config/storage-portable.json` for the documented portable profile.

## Prepare or update anatomy through the CLI

Inspect the source version, licenses, required files and storage budget in the terminal. Manual downloads use the declared input paths; the [dataset installation guide](dataset-installation.md) lists source-specific requirements.

```bash
neuroimage recipes cerebra
neuroimage acquire cerebra --data-root /path/to/data/NeuroImage --dry-run
neuroimage acquire cerebra --data-root /path/to/data/NeuroImage
neuroimage build cerebra --data-root /path/to/data/NeuroImage
neuroimage validate /path/to/exact/manifest.json
```

Acquisition reuses verified source files. Repeating construction reuses completed outputs when their signatures match. Use the exact manifest path printed by construction. After adding or replacing packages, restart the local service and reload the browser to discover the updated library.

## Browse and inspect the local library

Choose an anatomical group or dataset on the home page. Dataset pages show the introduction, source terms and atlas buttons grouped by case or resource. Each ready button opens the complete source atlas directly; unavailable entries show their local availability status. The **NeuroImage** logo returns home. Source websites, licenses, acquisition metadata and coordinate definitions remain available in dataset details.

The terminal supports library-wide inspection and structure search:

```bash
neuroimage search "trigeminal" --data-root /path/to/data/NeuroImage
neuroimage library --data-root /path/to/data/NeuroImage
```

The [browser guide](getting-started.md) covers sections, surfaces, cutaway, backgrounds and same-category comparison. Browser scene and image-export tools remain in `codex/release-testing`; existing scene files can still be located and opened through the CLI.

## Stop and retain maintenance records

Ctrl+C stops the service or the active CLI command. Repeating the same acquisition or construction command reuses its verified files and completed checkpoints.

Reuse the same roots to retain maintenance receipts, operation history, logs and saved-scene records. The state lock prevents concurrent service owners. The webpage has no installation, construction or operation-management controls. Teaching operation records remain historical testing-branch material.

Ordinary `neuroimage serve` also provides a viewing service for explicit local packages. Software distributions contain no acquired anatomy.
