# Native image frames and source skull masks

The anatomy browser can display a complete original image, one explicitly selected frame of a source series, or a categorical source mask. These representations share acquisition, construction, validation, navigation, scenes and attributed export interfaces. They do not imply equivalent anatomical evidence.

## Meso-vein MRI

Recipe `mesoveins` uses the original healthy participant 01, session 06, run 01 magnitude sequence from [Zenodo release 19332208](https://zenodo.org/records/19332208), under CC BY 4.0. The 11,066,268,869-byte archive is downloaded once. Only the selected 542,068,920-byte NIfTI member is extracted. Its three-frame sequence is retained byte for byte in the local package; stored frame index 2 is extracted without changing samples or the oblique millimeter grid. The source has approximately 0.34965 × 0.34965 × 0.35 mm stored spacing. No prepared 2× interpolated image is substituted.

The interface identifies frame 3 of 3 and provides both the selected frame and original sequence. No frame-specific echo time is invented from the publication: the original header and protocol differ. The image has no named vessel segmentation. A dark line is an image observation requiring adjacent-section interpretation, not an automatically identified vein or variant.

The normal-participant source and processing are described by [Gulban et al., Science Advances (2026)](https://doi.org/10.1126/sciadv.aea4540). The software adds no averaging, motion correction, registration or inferred vessel surface.

## Healthy skull mask

Recipe `mug500_healthy` uses only the publisher-designated healthy A0101 skull from [MUG500+ version 20](https://figshare.com/articles/dataset/MUG500_Repository/9616319/20), under CC BY 4.0. Reuse the 964,272,652-byte A0101–A0105 archive and extract only A0101.nrrd (1,698,816 bytes). No defective B-series skull or implant is acquired.

A0101 supplies a binary segmentation, not measured CT intensity. Preserve all source foreground, including noise and any attached facial or cervical components. The NRRD LPS directions and origin convert exactly to RAS; its categorical voxels are not resampled. The surface is the unrefined half-voxel isosurface. It has no new smoothing, topology repair, component removal, individual-bone division or separately named foramina.

The stored grid is 512 × 512 × 307 at 0.529296875 × 0.529296875 × 0.75 mm. [Li et al., Data in Brief (2021)](https://doi.org/10.1016/j.dib.2021.107524) report a 1.5 mm healthy-cohort slice thickness. Retain this distinction: file spacing does not establish effective acquisition resolution. Small holes, thin walls, source artifacts and apparent asymmetry are not automatically validated normal variants.

## Construction and use

```sh
conda activate NeuroImage
neuroimage acquire mesoveins --data-root /path/to/data
neuroimage build mesoveins --data-root /path/to/data --workers 2
neuroimage acquire mug500_healthy --data-root /path/to/data
neuroimage build mug500_healthy --data-root /path/to/data --workers 2
neuroimage workspace --data-root /path/to/data
```

Acquisition estimates additional download and extraction space and enforces the configured HDD reserve. Reuse verified archives and selected members. Construction checkpoints each asset, checks native samples and physical coordinates, and repairs missing outputs on resume.

Choose **Arteries and veins → Meso-vein MRI** or **Skull base → MUG500+** on the anatomy home. Begin with **Full sections**, move the shared location through neighboring sections, then use **Magnify at cursor**. **Full 3D context** restores a broad view without moving the 2D cursor. Learning tools remain beside the atlas; dataset downloads and builds remain in the secondary dataset workspace.

Save or export a scene to retain its exact source package, cursor, camera and display. A teaching image export includes the scene, source citations, original license records and processing manifest. It does not include acquired images, meshes or the original series. Download source data only from the separate source links when needed.

## Verification and limitations

The native-frame tests check original-series byte identity, selected-frame sample equality, oblique geometry, invalid frame rejection and interrupted output repair. Browser checks compare six actual samples with the original 4D source and verify identical restored/imported pixels and attributed export. The source-mask tests check exact LPS-to-RAS conversion, unchanged labels and source-derived surface correspondence. These are engineering checks; expert review remains separately recorded for exact teaching cases.

## HumanBrainAtlas T2

Use recipe `hba_native` with the common acquisition and construction commands. It selects the original sub-01 T2 file version 1 from the HumanBrainAtlas OSF release. The source authors skull stripped, averaged and oriented this image to ACPC; this project retains its 625 × 725 × 555 float32 samples and coded qform without additional resampling. The 0.25 mm reconstructed grid must not be described as the original acquisition spacing. The source image is 734,503,773 bytes compressed and 1,005,937,500 voxel bytes uncompressed; construction reserves an 8 GiB peak budget plus the configured data-drive floor.

The earlier package `711ca733452e83ae` passed fresh source validation and actual Linux browser checks. Initial opening took 49.15 seconds on the development workstation, including source validation and the first image load. Six native voxel readouts matched the original image, contrast changes preserved values, and restored/imported canvases had zero changed pixels. This is one measured run, not a general performance guarantee. See `config/hba-browser-verification-2026-10-13.json` for that exact historical run.

Recipe version 2 and package `b130a9babcc07247` retain identical source image bytes and make the masked coverage explicit in the manifest and teaching exports. The [primary Methods](https://doi.org/10.1007/s00429-023-02653-8) describe HD-BET masks, alternate mask margins and manual correction; the selected file header does not specify the precise mask variant. Black background or a mask edge does not establish absent anatomy or a cisternal wall. This source is therefore available for retained brain-tissue observation, not listed as complete extra-axial cistern coverage. Existing scenes keep their original package binding.


## Ready-to-use observation notebooks

Four installed curricula add 22 source-bound views: `hba-native-t2-observation` (six), `mesoveins-native-observation` (four), `venat-native-field-comparison` (eight) and `mug500-skull-observation` (four). They pair complete sections with the same physical point enlarged, retain source contrast and compare image observation with explicit evidence limits. VENAT compares all seven statistics at one source-grid point; the chosen point is a reproducible field observation, not a named vein.

In the secondary dataset tools, choose **Local atlases**, select the curriculum beside the matching package and select **Prepare teaching**. **Open prepared notebook** opens its exact source and the teaching panel automatically. The equivalent command is:

```sh
neuroimage teaching prepare hba-native-t2-observation --atlas /path/to/hba/manifest.json --data-root /path/to/data
neuroimage open /path/to/prepared-notebook.json --data-root /path/to/data
```

Select **Next view** to follow the sequence. **Return to recorded view** recovers its cursor, contrast and full or enlarged view after live exploration. Export the notebook to preserve the complete sequence; teaching image exports retain individual source and license records. Viewing or importing a notebook does not overwrite a previously saved browser notebook.

New observation recipes explicitly request a broad 3D context and a horizontal row of sections. `center_on_target: false` keeps the original volume framing while leaving the recorded source point unchanged; `true` centers the 3D view on that point. `tile_layout: "row"` uses the available width for complete sections; users can change this live. Omitting these fields preserves legacy recipe behavior. Existing prepared notebooks and their scene-bound source packages remain unchanged.

## Original author-cleaned surface alternative

The supplied A0101 binary sections contain many scattered source foreground components. A separate [author-cleaned skull surface](source-cleaned-skull.md) is available through `mug500_source_mesh`. Its original STL facets remain unchanged and its independent 3D model can be rotated, clipped, saved and exported. It is not a new CT image or a cleaned raster mask; source-bound teaching suitability records distinguish these representations.
