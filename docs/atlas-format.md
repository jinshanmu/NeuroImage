# Local atlas contracts through 1.9

A software distribution contains code, build recipes, schemas and documentation. An atlas package is an independent local data product constructed under its source licenses. All datasets use the same manifest, asset, build, validation and viewing interfaces. No permissions-based dataset tiers are defined.

## Package layout

```text
manifest.json
volumes/<contrast>.nii.gz
volumes/labels.nii.gz
meshes/label-<value>.gii
streamlines/<bundle>-<level>.tck
streamlines/<bundle>-<level>-indices.json
licenses/<source-notice>
lessons.json
validation.json
.build-state.json
.build.lock
```

Only `manifest.json` and declared assets are exposed by the local server. The checkpoint and lock remain private build state. A completed manifest is written after the required products have been constructed. Files are replaced atomically, and completed products are recorded individually for recovery.

`neuroimage library` inventories the uniform `derivatives/<dataset>/<version>` layout. It reads completed manifests and interrupted checkpoints without interpreting their directory order as a preferred version. Discovery validates metadata, asset paths/sizes and lesson references, and explicitly leaves hashes and voxel geometry unchecked. `neuroimage locate` matches all four saved-content binding fields against available packages. It checks a notebook's embedded bindings but leaves detailed scene-state validation to the viewer. Neither command changes or copies source data.

`schemas/atlas-manifest.schema.json` is generated from the canonical Pydantic contracts by `neuroimage schema`. Asset paths are normalized relative paths, cannot escape the package root and have exact byte counts and SHA256 hashes. An asset identifies its role: image, labels, mask, probability, mesh, streamlines, streamline-index, license, lessons or validation. A manifest references each required asset explicitly. Each representation uses only its applicable geometry assets.

## Native geometry

Image-backed representations declare right-anterior-superior (RAS) millimetres. Independent source models instead use the explicitly separate `SOURCE_XYZ` convention described below. Voxel indices refer to the native array order. Each volume retains its own 4 by 4 voxel-to-RAS affine, shape, spacing and orientation. Array reordering or registration is not implied by the common coordinate convention.

NRRD LPS geometry is converted to RAS by changing the first two physical axes in the affine; the voxel array is retained. NIfTI requires an explicit qform or sform and supported physical units. Conflicting coded forms are rejected. A recipe may supply documented unit evidence when the source header is unspecified; the source geometry and override remain in the processing record. Output NIfTI uses millimetres and an exact sform; a qform is coded only when representable without losing shear.

SPL/NAC's delivered image and label origins differ by half a voxel. The builder preserves the delivered geometry and records the difference. CerebrA and its explicitly matching MNI 2009c symmetric image require the same shape and affine. No transform between these two atlas packages is provided or inferred.

## Labels and surfaces

Schema 1.1 declares the actual representation: `mri-labels` has at least one measured scalar MRI and one categorical label volume; `label-model` has one categorical label volume and no MRI. This describes available source material, independently of license terms. Both use the same adapter, build, validation, viewing, scene, teaching and export interfaces. Existing schema 1.0 MRI packages remain readable and default to `mri-labels`. A missing MRI is never replaced by synthetic intensity derived from label values.

Each selected label has a source-independent software field name and a source-specific, stable structure ID. IDs do not depend on translated display names. Source names, source values, grouping operations, coverage notes and review status remain available. Sources with no explicitly sided labels retain `unspecified` laterality; their left/right group-order check is not applicable, rather than falsely reported as passed.

An explicit recipe union combines existing source labels and retains its input values. It does not add tissue, create missing structures or establish equivalence to another atlas. The software does not invent a cross-source ontology correspondence from similar names.

Schema 1.2 adds optional `probability` assets and volume kinds. Each probability volume has the same grid as the categorical labels, a fixed 0–1 scale and exactly one structure reference. That reference retains the source input/channel, interpretation and derivation. The builder extracts declared 4D channels without altering values; finite range and grid checks reject unsupported data. A recipe can declare a measured categorical-to-probability relationship for independent verification. See the [CIT168 source and viewing guide](cit168-probability-evidence.md). Earlier schema 1.0 and 1.1 packages remain readable.

Surfaces are unsmoothed, undecimated binary 0.5 isosurfaces at the source voxel resolution. GIFTI points are already in native RAS millimetres with identity coordinate transforms. Source-resolution interpolation describes the categorical voxel boundary; it is not newly observed subvoxel anatomy. Ambiguous marching-cubes configurations are not repaired and topology review is recorded as unperformed.

Every categorical region records labelled voxel count, voxel-derived volume, centroid, mesh bounds and an actual member voxel used as the inspection target. A centroid alone is insufficient because it can fall outside a curved or disconnected structure. Post-build validation reopens the volumes and surfaces, checks manifest geometry against actual geometry, confirms every target and count, and samples every surface vertex against the source label's half-voxel boundary.

## Overlapping source trajectories

Schema 1.3 adds `mri-streamlines`, containing scalar reference MRI and `streamline-bundle` structures. Bundles carry source record counts, vertex counts, complete bounds, point-weighted centroid, an actual retained target vertex and its original line/point indices. They do not carry fabricated label values, voxel volumes or tissue surfaces. Original source evidence, stable IDs, laterality and review fields use the same common meaning. Earlier schemas 1.0–1.2 remain readable.

Each bundle contains full RAS-mm TCK geometry and explicit preview, standard and detail levels. Deterministic whole-trajectory subsets retain all selected source vertices and record their original indices in separate JSON assets. The full decoded-coordinate digest includes each line's length and float32 coordinates in source order. Independent validation compares every subset against the full retained source and verifies target membership, counts, bounds, centroid and reference field-of-view coverage. Source header conversions are format semantics, not new anatomical registrations. See the [HCP1065 source guide](hcp1065-streamlines.md).

Physical 2D slabs clip line portions to the stated millimetre width. On-demand 3D loading is bounded to the display levels; complete trajectories remain available separately. The scene records `overlay: streamlines`, `streamlineLevel` and `streamlineSlabMm`. `visible-streamline` selection evidence retains all nearby displayed candidates, with an optional `sectionAxis` for slice-projected proximity. The 1 mm picking tolerance and full slab width are different quantities. Visibility, opacity and sampling changes refresh proximity evidence. Multiple overlapping source estimates never become an exclusive tissue label.

## Interaction and scenes

Three MRI planes, or explicitly identified categorical model sections, and the 3D view share one physical cursor. Two-dimensional selection and explicit coordinate entry sample the actual categorical volume. Three-dimensional depth picking returns a position on an interpolated surface: the nearest categorical voxel can belong to its neighbor. The viewer therefore resolves nearby visible surface geometry first, records the selection basis and marks multiple nearby candidates. This is proximity-based surface selection; confirm ambiguous shared boundaries in adjacent MRI slices.

Scenes contain the exact package/version/build signature, native space ID, physical cursor, selected and visible structure IDs, image contrast/window, camera, display convention, opacity, view layout, annotations and notes. Optional selection evidence preserves whether a target, a voxel, a visible surface or a cursor sampling a fixed probability channel was used. An optional overlay field distinguishes probability evidence from categorical labels. Import rejects an unavailable evidence mode, a different package version/space or malformed state. It cannot create cross-dataset registration. Export waits for pending image/surface loads so the pixels and saved state describe the same completed view.

Optional teaching context preserves the active lesson, step, identification mode, unfinished response and reveal state, together with the inspector panel. The importer checks the lesson and step against that exact package's lesson file. Earlier scenes without teaching context remain readable and open in ordinary inspection; stale lesson text is not retained from the previous view. Responses are self-study notes, not automatically graded or expert assessments.

User annotations appear as numbered markers. Their positions are native RAS coordinates, separate from source labels. In 2D, markers are drawn only on the actual displayed plane, with a 0.05 mm numerical tolerance; off-plane points are not moved onto a nearby slice. In 3D, markers project through anatomy and do not assert visible surface contact or anatomical boundaries. Marker visibility is saved in the scene. Selecting a marker restores its recorded position and associated structure, with `teaching-marker` selection evidence.

Teaching images include a short numbered marker legend and note excerpt, with complete text, coordinates and stable marker IDs in `teaching-notes.txt`. Unrevealed identification images suppress source-answer captions, markers and note excerpts. The accompanying source manifest still contains the source labels; these are self-study exports, not concealed examination answer files.

A teaching ZIP includes the PNG, scene JSON, full manifest provenance, rendering record and every declared source license notice. The renderer record identifies the viewer source fingerprint, software/renderer versions, nearest-neighbor label sampling and absence of complete-mesh projections in 2D. Region windows show the actual image and categorical/probability slice; full surfaces are confined to the 3D window. Trajectory windows add only physical slab intersections and record the complete-trajectory sampling and selection policy. Scene files contain no imaging arrays or geometry; restoration requires the matching local atlas.

## Portable teaching notebooks

A `neuroimage-teaching-notebook` JSON document uses schema version `1.0`. Its top-level binding contains `package_id`, `package_version`, `build_signature` and `space_id`, together with an ID, title, author and learning objective. The ordered `scenes` array contains up to 50 entries. Each has a stable entry ID, title, discussion prompt, author-reported capture time and a complete version-bound scene. A notebook never merges native spaces.

The importer validates every embedded scene against the current manifest and lesson definitions before accepting the document. It rejects incompatible identities, malformed display states, unknown structures or lessons, duplicate entry IDs and exceeded text/count bounds. Exported source and processing declarations are regenerated from the matching local package, and the review status is always `user-authored-unreviewed`. An imported approval claim does not become an anatomical review. Notebook file size is bounded at 10 MiB; browser storage is optional and can have a smaller quota.

Scene capture deep-copies its display and annotation state. Live interaction does not alter earlier entries. Scene ordering, explicit replacement and deletion/undo affect only the user's notebook, never source arrays or atlas packages. The primary and comparison workspaces use separate browser-storage keys and preserve unsaved notebook drafts across source switches within the current page.

## Construction identity and extensions

The build signature hashes selected source files, their recipe, geometry-producing implementation files and numerical library versions. The manifest retains hashes, versions, processing parameters, unit evidence and source mappings. Unchanged completed assets are verified before reuse. A changed source or construction implementation creates a different local package version.

Add datasets by implementing the shared `ImportedDataset` adapter contract and an English recipe with source evidence. An adapter must establish native geometry, label definitions, source versions and license records before construction. New specialist modules should extend explicit contracts; they must not silently treat probabilistic maps as categorical labels or merge native spaces without a verified correspondence. Existing sources, the normal-anatomy scope and original acquisitions must remain intact.

Engineering validation and expert anatomical review are separate fields. The current packages and lessons remain pending independent anatomical review. Source-derived labels, computational surface geometry and user teaching annotations are distinct kinds of evidence.

An optional geometry-validation receipt is keyed by the exact manifest bytes, loaded validation/geometry/contract implementation, Python/architecture and numerical library versions. Serving verifies every asset's actual SHA256 before considering this receipt; a changed asset fails integrity checking, while a changed manifest or validator requires fresh geometry checks. Lesson references are still checked on reuse. Explicit CLI validation always recomputes geometry. The receipt is local auxiliary state, is not in the package manifest or HTTP routes, and grants no anatomical approval. Missing, malformed or unwritable caches fall back to ordinary full validation.

## Independent overlapping regions

Schema 1.4 adds `mri-regions` with `independent-region` structures. Each region references a scalar 3D `probability` volume and a separate binary `mask` volume, each on the exact declared source reference grid. `mask` records the original input, volume ID and inclusive probability threshold. `probability.source_channel` is null for these scalar inputs. Categorical schema 1.2 evidence continues to require an explicit 4D source channel.

Independent regions share physical counts, bounds, source-member targets and unsmoothed GIFTI surface fields with categorical regions, but have no invented categorical label value. Masks may overlap; the contract binds every mask and probability to exactly one region and rejects exclusive label volumes in this representation. Validation checks each threshold relationship, retained memberships and overlap statistics without resolving conflicts.

Scenes use `overlay: probability` or `overlay: mask`. The selected field stays fixed during cursor sampling. `independent-mask` evidence lists all visible masks containing the nearest source voxel. An optional `focus3D` is a RAS-mm rotation center; `pan` retains physical slice offsets and scale. These display settings never modify source arrays or mesh coordinates.

## Explicit probability units and original images

Schema 1.5 records probability units explicitly: `fraction` has range 0–1 and `percent` has range 0–100. A region mask records its inclusive threshold in the same units. The complete original field remains available independently of a thresholded display mask. Existing fractional source channels retain their original interpretation.

Schema 1.6 adds `mri-volume`: exactly one scalar image volume, zero structures, and no label, mask, probability, mesh, streamline or streamline-index assets. Construction and validation bind the image asset to the original input hash and byte count. The native NIfTI is preserved byte for byte. An empty `lessons` array is valid; source-image observations belong to version-bound teaching notebooks. Other representations still require source structures.

Image-only scenes use `selected: null`, `visible: []`, `overlay: none` and `image-cursor` selection evidence. They preserve the physical cursor, contrast window and optional 3D intensity visibility. Image-anchored teaching markers have no invented structure association. Native RAS coordinates and a common file identifier do not establish registration to another image.

## Independent source models (1.7)

A `surface-model` has source geometry and no image volume. Its separate native model contract declares `SOURCE_XYZ` millimeters, original object identity, source-to-native unit conversion, vertices, faces, source definitions and optional original author curve/modifier evaluation. It does not assign RAS or anatomical directions to those axes. The common acquisition, build, validation, library and serving commands dispatch by representation. See [source-model construction](source-model-construction.md).

Model scenes preserve native position, visible objects, camera, opacity, display-only cutaways, annotations, lessons and optional selection highlighting. Older scenes without the highlight field retain source colors. Source-model teaching exports include the exact scene, source attribution and original license records; no acquired model geometry is embedded.

## Native scalar fields (1.8)

A `scalar-fields` package has original native NIfTI scalar volumes and no invented MRI, labels or structures. Each volume declares a quantity, units, statistic, interpretation and source derivation. Byte identity preserves source storage type, including big-endian arrays. Viewer contrast is independent of unchanged cursor samples. The selected field, display range, source and package binding are retained by scenes and teaching exports. See [native statistical fields](native-statistical-fields.md).

## Exact native source frames (1.9)

A native image may select one frame from an original four-dimensional NIfTI series. The `native_frame` record names the source input, retained `source-volume` asset, original four-dimensional shape, zero-based frame index and the `exact-native-frame-no-interpolation` extraction method. The selected three-dimensional image is a separate display asset. Validation checks original source bytes, frame bounds, sample equality and unchanged native affine. The viewer exposes both original-series and selected-frame downloads and preserves frame provenance in export. No temporal, echo-time or modality meaning is inferred from frame index alone.
