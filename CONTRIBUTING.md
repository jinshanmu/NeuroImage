# Contributing

Use English for code, comments, documentation, terminology and teaching content. The current scope is normal intracranial anatomy and normal anatomical variation for learning and teaching. Clinical decision support and disease datasets are outside this release.

Create the dedicated `NeuroImage` Conda environment from `environment.yml`. Install `requirements-core.lock.txt` and `requirements-dev.lock.txt` there. Install `requirements-source-inspection.lock.txt` as well to run the complete HDF5 construction and inspection tests; those modules are skipped if h5py is absent. Use the Node version in `.nvmrc`, run `npm ci`, and keep environments and build workspaces on SSD. Keep acquired anatomical data on your chosen data drive.

Run `python -m pytest`, `npm test`, `npm run build`, and `python scripts/audit_code_release.py --include-untracked` before proposing a change. The synthetic test suite requires a filesystem that supports symbolic links, such as ext4 on Linux. Do not use an exFAT test workspace for the symlink-boundary tests. Tests generate their own small fixtures and require no acquired datasets.

New source adapters must preserve source identity, units, coordinates, definitions, original inputs, license evidence and citations. Use the shared contracts in `src/neuroimage/contracts.py`, the import interface in `adapters.py`, and `build_imported_atlas` for construction. Follow `docs/adapter-development.md`. Do not merge overlapping source definitions into a new atlas without a separately justified method.

Keep tests focused on observable behavior: source preservation, exact scene binding, interrupted build recovery, file boundaries and invalid-input handling. Record the commands actually run and any limitations. Engineering tests do not establish anatomical validity or learning effectiveness.

Do not include acquired images, label arrays, meshes, streamlines, derived anatomy, caches, credentials, local absolute paths or personal teaching files in a pull request. A small analytic fixture generator is acceptable; its generated outputs stay outside the repository. Each source keeps its own license, independently of this project's Apache-2.0 code license.

Changes to scientific content require explicit source evidence and independent review of the intended view or lesson. Clearly identify software-generated drafting or code assistance in research reports when applicable. Do not name a language model as an author.
