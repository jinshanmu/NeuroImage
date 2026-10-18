# Linux quickstart

Use Linux x86_64, Conda, a WebGL2 browser and an SSD software directory. Keep acquired anatomy and local atlases on your selected data drive. The installer uses only the `NeuroImage` Conda environment.

## One command

After installing [Conda](https://conda-forge.org/download/) on SSD, enter the software source directory and run:

```bash
bash install.sh --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state --recipe cerebra
```

The installer creates the named Python 3.12 environment if needed, installs the pinned runtime and optional HDF5 library, builds the web application, installs the package, acquires the selected source, constructs and validates an atlas, and starts the workspace. Source builds obtain the pinned Node 24.21.0 Linux runtime from its official distribution when it is unavailable locally; its archive is checked against the recorded official checksum. Node and npm dependencies stay in the SSD software directory. The npm CLI is invoked directly, so local command links are unnecessary.

The data and state directories are created at your explicit paths. They must be separate physical directories. The installer does not format or repartition drives. It reports source terms and expected storage before anatomical acquisition. Review the selected source's terms with `neuroimage recipes NAME` or its linked official page.

Open `http://127.0.0.1:8765`. The workspace continues running until Ctrl+C. Restart with the same data and state paths to retain your library and operation history.

## Install a supplied wheel

The wheel includes the offline viewer. From the extracted source archive, which supplies the installer and dependency locks:

```bash
bash install.sh --wheel /path/to/neuroimage_atlas-1.0.0-py3-none-any.whl \
  --data-root /path/to/data/NeuroImage \
  --state-root /path/to/ssd/NeuroImage-state --recipe cerebra
```

Node and a frontend build are unnecessary in this mode. The wheel is a local release artifact; the review version has not been uploaded to a package index.

## Useful options

| Option | Effect |
| --- | --- |
| `--install-only` | Install the software and check its runtime dependencies; acquire no anatomy |
| `--recipe NAME` | Select any installed source recipe |
| `--no-start` | Finish acquisition and construction without starting the service |
| `--no-browser` | Start the service and print its URL |
| `--port 8766` | Choose another local service port |
| `--workers 2` | Choose one to eight construction workers |
| `--node /path/to/node-runtime` | Use an existing Node 24.21.0 installation |
| `--storage-policy FILE` | Apply reviewed capacity reserves |

The default installer policy is `config/storage-portable.json`. It reserves 10 GiB on the data drive and 2 GiB on software storage. Acquisition and construction also require the recipe's additional transfer, expansion and working-space estimates. Initial software installation budgets another 4 GiB. These are capacity checks, not estimates of every dataset's size. The development workstation uses the separate, larger reserves in `config/storage-policy.json`.

## Add another dataset

After activating the environment, inspect and run the same integrated workflow:

```bash
conda activate NeuroImage
neuroimage recipes
neuroimage recipes thu_mra_case009
neuroimage quickstart thu_mra_case009 \
  --data-root /path/to/data/NeuroImage --state-root /path/to/ssd/NeuroImage-state \
  --storage-policy config/storage-portable.json --dry-run
neuroimage quickstart thu_mra_case009 \
  --data-root /path/to/data/NeuroImage --state-root /path/to/ssd/NeuroImage-state \
  --storage-policy config/storage-portable.json --no-start
```

A dry run performs no download or construction. The individual `acquire`, `build`, `validate` and `workspace` commands remain available. Without an explicit policy, those commands and `quickstart` retain the conservative development reserves; pass the portable profile for the installation behavior above.

MIDA uses its official manual access workflow. A dry run supplies the exact archive name, destination, byte count and checksum. Obtain the unchanged archive through that page, save it at the reported destination and repeat the command. Download failures from any publisher retain partial files for a later retry. See the [source table](dataset-installation.md).

Blender is a separate application required only to construct Z-Anatomy; install the recipe's recorded Blender version and make `blender` available on `PATH`. Its embedded Python is separate from the NeuroImage Conda environment. The installed wheel includes the optional HDF5 dependency when installed through this script, supporting original inner-ear CT construction. Viewing an existing atlas needs neither Blender nor original-source inspection tools.

## Diagnose and recover

`neuroimage doctor` reports the platform, environment, local viewer and the full application dependency closure. Add `--recipe`, `--data-root`, `--state-root` and `--storage-policy` to inspect a specific setup. The check concerns NeuroImage's dependencies; unrelated optional research packages in an existing environment are independent.

Repeat an interrupted command with the same paths. Verified inputs and completed construction outputs are reused. A conflicting original file is retained and reported. Keep historical atlas versions referenced by saved teaching files. A different browser profile or port has separate browser saves, so export scenes, notebooks and study records for backup.
