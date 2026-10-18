# BigBrain cortical boundaries and hippocampal subfields

The `bigbrain_layers` and `bigbrain_hippocampus` recipes use the original GIfTI files from the official BigBrain 2015 histological release. They provide 14 bilateral cortical boundary surfaces and 14 hippocampal source surfaces. The original vertices, vertex order, triangle indices and winding are retained. These independent native surface packages use the accepted source-model viewer.

## Source definitions

The [cortical release](https://ftp.bigbrainproject.org/bigbrain-ftp/BigBrainRelease.2015/Layer_Segmentation/3D_Surfaces/PLoSBiology2020/) accompanies [Wagstyl et al., 2020](https://doi.org/10.1371/journal.pbio.3000678). Surface indices 0 through 6 describe the pial boundary, five successive interlaminar boundaries and the layer VI / white matter boundary. A boundary surface is distinct from a cortical layer volume. The authors used learned histological profiles and source surface processing. Regional confidence and the histological definition of the gray/white boundary matter when comparing these surfaces with MRI-derived cortex.

The [hippocampal release](https://ftp.bigbrainproject.org/bigbrain-ftp/BigBrainRelease.2015/Hippocampus_Segmentation/) accompanies [DeKraker et al., 2020](https://doi.org/10.1016/j.neuroimage.2019.116328). It supplies bilateral CA1, CA2, CA3, CA4, dentate gyrus, subiculum and midsurface objects. The midsurface represents the source's hippocampal folding model and is distinct from a tissue subfield. Definitions follow this source method; identically named NextBrain and Julich regions remain in their own native packages.

BigBrain is a single postmortem male specimen, age 65, with no neurological or psychiatric disease in the source clinical history. The foundation is Amunts et al., Science 340:1472-1475 (2013), [doi:10.1126/science.1235381](https://doi.org/10.1126/science.1235381). The [original data license](https://ftp.bigbrainproject.org/bigbrain-ftp/License.txt) is CC BY-NC-SA 4.0. The full source notice and [contributor credits](https://ftp.bigbrainproject.org/bigbrain-ftp/Credits.txt) are acquired separately from software. The data license remains distinct from a source article or tutorial-code license.

## Native surface construction

The generic `gifti-source-surfaces` adapter accepts self-contained point and triangle arrays, including compressed `.gii.gz` files. It rejects unavailable external arrays, invalid indices and nonfinite geometry. Original coordinate matrices and metadata are retained. The source arrays use millimeter-scale histological coordinates; identity metric scaling is explicit in both recipes. The viewer labels the coordinates as native XYZ. Cross-atlas registration, histology-to-MRI alignment and new categorical voxels are outside these surface packages.

The 28 acquired files total 168,961,465 bytes. The 12 GiB construction reservation covers original sources, retained geometry, complete derivatives and interrupted output, above the configured HDD safety floor. Source GIfTI compression is retained and read directly; a second STL or uncompressed source set is unnecessary.

```bash
conda run -n NeuroImage python -m neuroimage acquire bigbrain_layers --data-root /path/to/data
conda run -n NeuroImage python -m neuroimage build bigbrain_layers --data-root /path/to/data --workers 4
conda run -n NeuroImage python -m neuroimage acquire bigbrain_hippocampus --data-root /path/to/data
conda run -n NeuroImage python -m neuroimage build bigbrain_hippocampus --data-root /path/to/data --workers 4
```

Repeat the same commands to recover completed downloads, source geometry and package checkpoints. Software releases contain only the recipes, source adapter, schemas, code and documentation. Users acquire their own source files and build their own local packages.

## Observation and validation

Five built-in sequences and two curricula provide 30 source-bound views. The `bigbrain-fine-surface-anatomy` course presents cortical boundaries and hippocampal subfields together while retaining exact package bindings. Prepared cutaways expose the supplied nested surfaces through native Y = 0 mm; they are visibility controls with open surface edges. The complete surfaces remain recoverable.

`scripts/verify_gifti_source.py` compares every delivered vertex and triangle directly with the acquired original GIfTI files and checks retained coordinate metadata. An unchanged build reuses all 45 assets in each package. `scripts/browser_bigbrain_fine_surfaces.js` exercises each prepared view and its source binding, portable scenes and attributed image exports. Anatomical instructor review is recorded independently from these engineering checks.

## Retained source-readiness finding

The pinned author tutorial at commit `05b6cce0b85260328b0653044746ed77e68f7e18` includes a 200-micrometer histology demonstration and layer segmentation. Its NIfTI arrays have different first-axis sizes, 770 versus 771, and unit-scale affines with unspecified units. The histology array also differs from the acquired official 200-micrometer reconstruction after the shape-compatible axis permutation. The original tutorial files, solution notebook and inspection receipt remain under `raw/bigbrain_layers/05b6cce0b852` and `benchmarks/bigbrain_layers/source-readiness`. These files were not used to manufacture a millimeter grid or a histology-to-label overlay. The formally released source surfaces provide the current construction path.
