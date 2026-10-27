# Extend the normal-anatomy platform

A new dataset should add a source recipe and a catalogue adapter while reusing construction, validation, viewing, scenes, notebooks and review. Current development covers normal intracranial anatomy and normal variation. Specialist evidence types should extend explicit contracts when needed; do not encode streamlines, overlapping labels or vascular graphs as ordinary categorical regions merely to fit an existing renderer.

## Where changes belong

| Module | Responsibility |
| --- | --- |
| `src/neuroimage/recipes/*.json` | Source identity, versions, official links, acquisition pins, license evidence, native space and construction parameters |
| `src/neuroimage/adapters.py` | Source catalogue parsing and the common `ImportedDataset` result |
| `src/neuroimage/acquire.py` | Capacity planning, resumable downloads and selected archive members |
| `src/neuroimage/geometry.py` | Explicit physical units, affines, scalar arrays and source-resolution surface extraction |
| `src/neuroimage/streamlines.py`, `streamline_build.py`, `streamline_validation.py` | TrackVis header decoding, complete source preservation, indexed display levels and independent trajectory checks |
| `src/neuroimage/build.py` | Content-addressed construction, checkpoints, output metadata and verified reuse |
| `src/neuroimage/contracts.py` | Portable manifest fields and cross-field constraints |
| `src/neuroimage/validation.py` | Actual asset, geometry, structure and lesson correspondence checks |
| `src/neuroimage/lessons.py` | Draft sequences grounded in the structures present in a package |
| `web/src/viewer.ts`, `scene.ts`, `notebook.ts` | Shared interaction, exact version-bound view states and user-authored teaching sequences |
| `web/src/streamlines.ts`, `streamlineRenderer.ts` | Explicit trajectory boundaries, physical slab selection and per-bundle line rendering |
| `src/neuroimage/review.py` | Source-bound materials for independent human review |

All datasets follow these interfaces. License terms are individual source metadata; they do not choose a platform tier or a separate implementation path.

## Establish a source before writing an adapter

Record the official dataset page, exact release, citation, download endpoints and license text. Check whether supplied images and labels actually refer to the same specimen or declared template version. Keep a different native space when correspondence is unproven. A shared word such as MNI does not establish a transform.

Inspect delivered dimensions, scalar types, coded NIfTI forms or NRRD directions, units, label tables and probability definitions. Unknown units or contradictory transforms need an explicit source-supported resolution. A recipe's `nifti_units` or `nrrd_units` override requires `units_evidence`; it must not be an undocumented guess. Preserve original files on the data drive and record any mismatch or missing coverage.

Use the dedicated `NeuroImage` environment. Estimate peak transfer, selected expansion and construction space before acquisition. Reuse verified local originals; the common acquisition command already implements resumable `.partial` downloads and SHA256 checks. A pinned local hash establishes repeatability, not publisher authentication.

## Add the recipe and catalogue

Add a uniquely named JSON recipe under `src/neuroimage/recipes`. `load_recipe` and the CLI discover these bundled recipes by filename. The `adapter` value is dispatched explicitly by `import_dataset`; add a catalogue parser there and return the existing `ImportedDataset(recipe, input_paths, structures)` contract.

`input_paths` maps recipe input IDs to existing, verified paths under the configured data root. It is a runtime value and must not become a machine-specific path in the recipe. Acquisition recipes support pinned direct `files`, archive `members` selected for expansion, or an explicit official access URL for a file the user must obtain manually. Keep license snapshots under the same uniform license layout.

Each catalogue entry describes an actual delivered structure. A categorical region uses the following interface illustration, which is not anatomical data or a working acquisition recipe:

```python
structure = {
    "id": "example:label:1",
    "name": "Source region A",
    "source_name": "Delivered name or abbreviation",
    "label_value": 1,
    "source_values": [1],
    "category": "Source-defined group",
    "laterality": "unspecified",
    "color": [90, 160, 180],
    "evidence": "Describe how the source established this label.",
    "source_notes": ["Record ambiguity, missing coverage or documented derivation."],
}
```

IDs are stable and independent of display language. Do not infer laterality by array order or the sign of a coordinate when the source does not define separate sides. Record a named union's original `source_values` and describe it as a computed group. Output label values must be unique positive integers no greater than 65535; source values cannot overlap between ordinary categorical entries.

Choose `mri-labels` only when the package includes measured scalar MRI. Choose `label-model` when it contains a categorical model without original MRI. This distinction describes the available evidence, independently of source rights. Do not invent an intensity image from label values.

For probability evidence, provide exact source channels, their interpretation and derivation. Channels retain their source values and native grid. The current probability contract uses scalar 0–1 support maps paired with an explicitly defined categorical navigation layer. A source-specific relationship such as an inclusive maximum-probability threshold must be measured and declared before the builder verifies it. It must not be guessed from a filename. Evidence that does not fit this contract needs a deliberate schema extension.

The viewer and image captions use these source declarations; observer averages, population templates and inferred hemispheres are not assumed for every probability source. CIT168's five source-specific lesson sequences stay scoped to CIT168. Other probability sources receive a basic channel-exploration sequence until a contributor supplies a source-grounded curriculum and independent review.

For source trajectories, the `trackvis-bundles` adapter returns the same `ImportedDataset` container with `kind: streamline-bundle` entries and input references. Representation dispatch selects the trajectory builder within the common `build_atlas` entry point. The source recipe declares reference images and their documented correspondence; header geometry and source definitions are checked before construction. Do not invent label values or categorical union rules for overlapping bundles. The expanded `hcp1065_tracts.json` recipe is a working example of schema 1.3.

## Reuse the construction and display path

The builder selects declared source values, preserves native arrays and world geometry, writes scalar volumes and extracts full-resolution binary 0.5 isosurfaces. It computes structure counts, bounds and actual member-voxel targets. It does not smooth, mirror, decimate or register structures. Rendering supports nearest-neighbor categorical display, shared physical coordinates, on-demand surfaces and selected probability channels.

Source/recipe bytes, relevant construction implementation and numerical library versions determine a package version. Changing construction code may create new versions when a package is rebuilt. Existing validated packages remain usable without reconstruction; keep them while scenes, notebooks or review packets refer to them. Serving, discovery and software release-number changes do not themselves change construction identity.

The viewer should not need dataset-name branches for a source already described by the existing representation contract. Extend contracts and rendering behavior together when adding a new evidence type. Do not hide missing data behind a fabricated representation. Generate the updated manifest schema with `neuroimage schema` if the Python contract changes, and keep older supported schemas readable where their meaning remains clear.

## Validate the meaningful failure cases

Use small generated asymmetric fixtures for orientation, units, native target positions and malformed inputs. Place imaging fixtures and real-data checks on the configured data drive. Test only the new adapter's meaningful assumptions and affected shared behavior. Current examples are in `tests/test_geometry.py`, `tests/test_acquire.py` and `tests/test_pipeline.py`.

Then exercise a real source through the same commands:

```bash
neuroimage acquire <recipe> --data-root "$ATLAS_DATA_ROOT" --storage-policy config/storage-policy.json --dry-run
neuroimage acquire <recipe> --data-root "$ATLAS_DATA_ROOT" --storage-policy config/storage-policy.json
neuroimage build <recipe> --data-root "$ATLAS_DATA_ROOT" --workers 4 --storage-policy config/storage-policy.json
neuroimage validate "$ATLAS_MANIFEST"
neuroimage serve --atlas "$ATLAS_MANIFEST"
```

Repeat construction once to verify completed work is reused. Compare source arrays and transforms independently where a new conversion is introduced. Check actual browser interactions and rendered pixels, not only in-memory options: native coordinates and left/right presentation, 2D slice evidence, selected 3D surfaces, saved scenes and source-bearing exports. The reusable Playwright fixtures and independent pixel checks are described in [browser validation](development/browser-validation.md).

Prepare an [independent review packet](anatomical-review.md) for anatomy and teaching judgments. Numerical consistency, correct rendering and a source paper do not constitute an expert review. Keep unassessed judgments explicit and preserve concise records of failures that change an implementation decision.

## Keep the release boundary intact

Code, recipes, schemas and English documentation belong in the software repository. Acquired images, labels, surfaces, probability maps, real-data screenshots and teaching exports remain independent local artifacts. Use `scripts/build_distribution.py` and the code-release audit before distributing software. Never embed local license-dependent atlas products in a wheel or source archive. Preserve source notices and processing records when a user exports a permitted data-derived teaching artifact.

## Independent source fields

The `independent-nifti-regions` adapter returns the common `ImportedDataset` container with separate mask and probability references. The `mri-regions` dispatch uses `region_build.py` and `region_validation.py`; no exclusive label values are assigned. The working `brainstem_navigator_mni` recipe pins each original scalar field and its source template. This contract requires exact reference-grid correspondence and an explicitly verified inclusive threshold. Retain each overlapping membership, positive support outside masks, and the original probabilities.

`web/src/independentRegions.ts` holds sparse source-voxel memberships and full-affine lookup, while the common viewer loads the selected scalar field and visible surfaces on demand. Physical view centers belong to scenes, not to source geometry. A teaching recipe can bind a positive `source_voxel` to the selected structure's mask or probability volume; preparation validates the sample before producing a notebook.

## Original image-only acquisitions

Use `native-nifti-volume` with representation `mri-volume` when a source supplies one original scalar NIfTI image without anatomical structure labels. The adapter returns the same `ImportedDataset` contract with an empty structure list. `volume_build.py` retains exact compressed source bytes, original millimeter units, coded forms and voxel arrays; the package contains no label, mesh, streamline or probability assets. Schema 1.6 explicitly permits this empty catalogue only for the image-only representation.

The archived, currently excluded `ixi_mra` recipe records the selected TAR acquisition contract; its source cannot currently be acquired, built or opened. For an enabled source using this contract, declare `format: tar`, the exact regular member name, byte count and hash; ZIP remains the default. Already extracted, hash-verified members can be reused without fetching an unused archive. The receipt must disclose that the archive itself was not verified in that run. Planning reads file sizes only; execution verifies selected source hashes.

Image-only teaching uses `image_anchor` with no `selected` structure and an empty `visible` list. A recorded `display.window` and `image_context` preserve contrast and 3D intensity visibility. The viewer samples the original image independently of display contrast and keeps observations distinct from structure-identification lessons. Use notebook review for these observations; structure-review packets still require actual source structures.
