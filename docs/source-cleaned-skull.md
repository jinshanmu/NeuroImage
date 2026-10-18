# Original author-cleaned skull surfaces

The original MUG500+ A0101 binary-mask teaching pair was rejected by the instructor because it contained too many scattered points. Preserve that pair and its source-bound response. It is not an accepted teaching example.

The same pinned healthy-source archive includes `A0101_clear.stl`. The [primary publication](https://pmc.ncbi.nlm.nih.gov/articles/PMC8591340/) distinguishes this author-cleaned surface from the noisier original STL and NRRD. The authors removed most background noise, artifacts and non-skull structures. This supplies a source-backed alternative for three-dimensional observation; it does not repair the original binary sections or provide original CT intensity.

```sh
conda activate NeuroImage
neuroimage acquire mug500_source_mesh --data-root /path/to/data
neuroimage build mug500_source_mesh --data-root /path/to/data --workers 2
```

The shared acquisition interface reuses the existing `mug500_healthy/A0101-A0105.zip` archive and extracts only its 90,265,284-byte clear STL. The source SHA-256 is `3c0b3ffc7f9b5306ba83ca5503a8b4b7034599476799d0541743b4b2f8913f42`. Keep the original NRRD, archive, license and rejected review images.

The `stl-source-surfaces` adapter reads an explicitly declared binary STL. It verifies the facet count, source extent and finite coordinates, then indexes only exactly equal coordinates. Every supplied triangle's positions and winding survive unchanged; close but unequal coordinates are retained separately. An explicit positive source-to-millimeter scale and source unit evidence are required. STL files do not generally declare units; do not assign millimeters to an unrelated STL without its own evidence.

The package remains an independent source model with its original XYZ coordinates. It supplies no new anatomical axis assignment, reference image, filled segmentation, named foramen labels or normal-variant classification. The same-case original noisy STL declares RAS in its header; the source-coordinate inspection compares the cleaned vertices directly with that file without alignment. This technical relationship does not establish the completeness of author cleanup or fine anatomical boundaries.

Open **Skull base**, choose the author-cleaned MUG500+ source, and browse the complete model. Rotate, zoom and use clipping to inspect the interior. Notes and the source-processing lesson remain in the secondary teaching drawer. Save/export scenes and teaching images through the same model interface used by other native sources. Original noisy source sections remain available as a separate package for explicit source comparison.

`scripts/inspect_skull_mask_components.py` inspects the five already archived A0101-A0105 binary masks in memory without extraction or modification. Component size describes source connectivity; it does not identify bone or justify removal. All five inspected masks contain many disconnected components, so selecting a different unprocessed case does not by itself establish a suitable teaching view.

Expert review of the new cleaned-surface views is separate from the rejected original pair. Engineering validation does not imply that either representation is suitable for identifying small foramina, thin bony walls or normal anatomical variants.
