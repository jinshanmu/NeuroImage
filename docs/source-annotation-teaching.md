# Original source annotations in model teaching

The native model teaching contract can attach an original author annotation to its own source model. The installed `z-anatomy-skull-landmarks` curriculum contains nine annotations and eighteen views. Each pair presents the source bone and a focused view of the same indicated location. Source mesh geometry, topology, native coordinates and atlas identity remain unchanged.

The selected original labels are **foramen magnum, foramen ovale, foramen rotundum, foramen spinosum, hypoglossal canal, optic canal, pterygoid canal, condylar canal**, and **foramen caecum of frontal bone**. They belong to the original occipital, sphenoid or frontal bone model. These are author-indicated points. Their representation describes a location; the surrounding bone mesh supplies the displayed surface. Canal extents and foraminal boundaries retain whatever geometry the author supplied. Source names determine laterality; a source label with an unspecified side remains unspecified.

The additional [sellar and clinoid curriculum](z-sellar-landmarks.md) uses the same contract for nine sphenoid landmarks and eighteen further views. Together the two curricula contain eighteen original source annotations and thirty-six recorded views.

## Source definition

The curriculum requires Z-Anatomy commit `9de5d6912a1b0df9cab739d57f00e036b0496ddc` and its original `Startup.blend`. The source archive contains `Z-Anatomy/__init__.py`. In `OBJECT_OT_make_label`, the author constructs a two-vertex annotation line, places the text at vertex 0, and attaches vertex 1 to the original anatomical object with a Hook modifier. The line belongs to a text object whose parent is that same anatomical object. The extractor checks this explicit convention before accepting the indicated endpoint.

The original archive, original Blender file and accepted atlas input hashes bind extraction to the source. Blender `5.2.2 LTS` runs in its own embedded runtime with factory settings and automatic source-script execution disabled. The project extractor evaluates the original visible Hook, retains both original and evaluated line vertices, and applies the original world matrix and declared metric unit scale. The numeric affine last row is normalized only within the same rounding tolerance used for source meshes; the raw matrix and discrepancy remain recorded. Native coordinates use `SOURCE_XYZ` in millimeters.

The [pinned upstream README](https://raw.githubusercontent.com/Z-Anatomy/Models-of-human-anatomy/9de5d6912a1b0df9cab739d57f00e036b0496ddc/Readme.md) supplies the license and complete attribution. The local atlas retains those files. Original source terms govern locally extracted annotations and their exports, separately from the Apache-2.0 software. Acquired annotation coordinates and source geometry belong on the data drive and stay outside software distributions.

## Prepare and browse

Acquire and build `z_anatomy` through the common workflow in [source-model construction](source-model-construction.md). Select its `author-viewport` package in the local workspace, choose **Skull foramina and canals: original source annotations**, and prepare the notebook. Alternatively:

```bash
conda activate NeuroImage
neuroimage teaching prepare z-anatomy-skull-landmarks \
  --atlas "$ATLAS_DATA_ROOT/derivatives/z_anatomy/VERSION/manifest.json" \
  --data-root "$ATLAS_DATA_ROOT"
neuroimage open /path/to/prepared-notebook.json --data-root "$ATLAS_DATA_ROOT"
```

Open the notebook in the teaching library. **Next view** alternates whole-bone context and focused location. Rotate the model, adjust opacity, and use **Return to recorded view** to recover its saved framing. The numbered marker projects through the displayed surface, so its screen position should be interpreted with the current viewing angle. **Notes** identifies the original annotation and context. Additional markers represent the instructor's observations. Export a scene or notebook to retain the exact source binding and view state.

**Export teaching image** includes the image, scene, model provenance, original licenses, notes and a separate `source-annotations.json`. Each source annotation retains the source hash, source object, indicated vertex, original context, evaluated line vertices, metric transform, Hook parameters, runtime and extraction signature. The image identifies the marker as an original source annotation. Re-import checks the native point, affine, source input and original context before restoring the scene.

## Recovery and validation

Initial extraction reserves 64 MiB above the data-drive safety floor and uses two Blender threads. It reads the existing source and writes small records; atlas geometry is reused. Annotation cache identities include source hashes, original context, declared mappings, runtime and extractor implementation. Each completed record is written atomically with a checksum. After interruption, repeat the preparation command: only missing records are extracted. A completed notebook is reused byte-for-byte without starting Blender. Edited prepared content is preserved and requires a new recipe revision.

Engineering checks cover source endpoint convention, original parent associations, meter-to-millimeter transforms, independent numerical comparison, interrupted extraction recovery, scene/notebook evidence retention and actual browser restoration. `tests/test_source_annotations.py`, `web/src/modelScene.test.ts` and `scripts/browser_source_annotations.js` provide repeatable checks. Browser acceptance uses a local notebook selected by its `teaching-content` key and saves captures and exports under the data-drive benchmarks directory.

Anatomical and teaching suitability is recorded separately for each reviewed view. Engineering acceptance does not assign an instructor judgment. Continue specialist development from the [source follow-up list](specialist-follow-up.md), including evidence-backed surface extent and normal-variant work.
