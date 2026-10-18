# Cerebellar and ventricular source models

The cerebellar and ventricular increment brought the Z-Anatomy selection to 157 objects; the [current detailed-anatomy selection](detailed-anatomy-and-variation.md) contains 350. That 38-object increment reuses the already acquired and pinned `Startup.blend`; its original source commit is `9de5d6912a1b0df9cab739d57f00e036b0496ddc`. These additions provide 31 cerebellar and peduncular objects, four ventricular objects, a midbrain aqueduct and bilateral choroid plexus.

The cerebellar selection includes paired anterior and posterior quadrangular, superior and inferior semilunar, gracile and biventral lobules, tonsils, central lobule wings and flocculi. Nine original vermal objects cover the lingula, central lobule, culmen, declive, folium, tuber, pyramis, uvula and nodule. Original floccular and superior cerebellar peduncle objects supply additional context. Names follow the publisher's traditional terminology. They remain independent of the SUIT numeric labels and histological region definitions.

The ventricular collection includes both lateral ventricles, the third and fourth ventricles, the aqueduct and both choroid plexus objects. The existing source corpus callosum provides translucent context in the ventricular teaching views.

## Build and teaching

Use the common `neuroimage acquire z_anatomy` and `neuroimage build z_anatomy` commands with the data root. Existing source files are reused. Construction uses the recorded Blender 5.2.2 LTS runtime with embedded source-script execution disabled. The original author viewport modifier stack, original base geometry and complete source transforms are preserved. Source meters are converted to millimeters in the original XYZ frame.

Three curricula provide 38 views:

- `z-anatomy-cerebellar-surface`: 18 hemisphere and floccular views.
- `z-anatomy-cerebellar-vermis`: 13 vermal and peduncular views.
- `z-anatomy-ventricular-context`: seven ventricular, aqueduct and choroid-plexus views.

The course plan `z-anatomy-cerebellar-ventricular-context` prepares all views using an exact locally selected package. Each view frames the complete visible model, highlights the selected object and keeps neighboring objects translucent. Source-bound scenes retain camera, visibility, opacity, selected object and native target positions.

These are conceptual anatomical surfaces from the publisher's educational model. The SUIT, NextBrain and general MRI atlases retain their own coordinates and provenance for independent comparison. Source object names establish within-model identity; a shared anatomical term alone does not establish cross-atlas geometric equivalence.

## Validation and recovery

`scripts/verify_z_anatomy_source.py` independently checks all 157 source objects in the pinned Blender runtime. Original evaluated vertices, triangles, base topology and native transforms are retained; the largest floating-point transform difference is below 0.000075 mm. The unchanged package rebuild reuses its assets without geometry computation.

`scripts/browser_z_cerebellar_ventricular.js` visits every view, compares the saved state with each recorded native scene, restores scenes, imports their portable files and exports images with original license and attribution notices. `scripts/verify_model_browser.py` checks restored pixels and exported bindings. Exact package and receipt locations are listed in `config/z-cerebellar-ventricular-verification-2026-10-14.json`.

Historical source-model packages remain available for previously saved lessons and instructor review. Reopen an older notebook with `neuroimage open`; the common locator selects its exact recorded version. Instructor judgments apply to their identified images and teaching purposes, independently of engineering verification.
