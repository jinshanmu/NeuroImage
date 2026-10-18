# Stable auxiliary surface-volume calculation

Original inner-ear CT inspection exposed cancellation in the auxiliary signed-volume sum when float32 triangle coordinates are far from the origin. For the three small CT surfaces, the previous auxiliary values were 85.4590, 69.6347 and 46.0959 cubic millimeters. Computing the same stored triangles in a centered float64 frame gives 80.4412, 73.6756 and 47.5978 cubic millimeters. The original voxel-count volumes remain 80.5488, 73.7629 and 47.8841 cubic millimeters; a label isosurface and a voxel union have different boundaries.

NeuroImage 0.14.1 changes the signed-volume computation used for winding and auxiliary QC. It subtracts a mesh-local reference in float64, processes at most 131,072 triangles per chunk and combines chunk sums accurately. The output vertices, source-derived faces and voxel-count measurements retain their original definitions. Two regression cases verify identical geometry, volume and outward winding after a large translation with ordinary and reflected affines.

The historical preferred-package audit recomputes 1,401 generated-label surfaces across 24 packages from their existing GIfTI files. All have positive outward signed volume. One stored auxiliary estimate differs by more than one percent; the maximum is approximately 1.51 percent. Thus the audited meshes retain their correct winding. The viewer's structure volumes are based on voxel counts and are unaffected.

Original packages remain immutable so historical scenes, manifests and build receipts retain their exact identities. Corrected auxiliary values are in `benchmarks/integration/fine-anatomy-20261014/surface-volume-audit.json` under the data root. New construction fingerprints include the corrected geometry implementation and create a distinct package version. A rebuild is needed only when requesting a newly constructed package; existing teaching packages remain usable with their preserved geometry and corrected QC sidecar.

Reproduce the read-only audit with:

```bash
python scripts/audit_surface_volume.py --data-root data \
  --preferred config/preferred-atlas-packages-2026-10-14.json \
  --output data/benchmarks/integration/fine-anatomy-20261014/surface-volume-audit.json
```

The full backend suite after the correction passed 222 checks with 173 dependency API warnings in 16.07 seconds. The accepted frontend remains unchanged. The 0.14.1 distribution receipt records its independent reproduction and installed acceptance, while the earlier 0.14.0 artifacts and validation remain available.
