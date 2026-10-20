# Specialist anatomy on Linux

The specialist extension uses the same acquisition, construction, native-space viewing and teaching interfaces as the general brain atlas. Linux is the current acceptance target. Windows and macOS acceptance is deferred. The code distribution contains no acquired images, labels, trajectories or local atlas packages.

## Coverage and evidence

| Module | Source evidence currently available | Coverage limits |
| --- | --- | --- |
| White-matter pathways | 87 HCP1065 source collections: 77 brain pathway collections and 10 paired cranial-nerve trajectory collections | Population computational tractography, not observed axons, tissue boundaries or validated functional connections. The cerebellum and vermis collections do not each define one tract. |
| Arterial anatomy | Original Mouches/Forkert arterial-occurrence percentages and matched average TOF from screened healthy-source MRA | No named branch partition. The 25% binary mask and navigation surface are project display derivatives. Source percentages remain unchanged, including values below this threshold. |
| Native MRA observations | One original IXI MRA acquisition with native intensities, three sections and 3D intensity rendering | No vessel segmentation, branch labels or independently reviewed anatomical normality. Bright signal alone does not identify a vessel. Acquired slab coverage is limited. |
| Cranial nerves | MIDA source classes I–XII, with separately named V2 and V3 classes; HCP computed pairs II, III, V, VII and VIII | MIDA sides and cisternal, foraminal or extracranial segments are not separately partitioned. HCP trajectories do not establish a complete nerve course. |
| Brainstem nuclear context | All 76 delivered brainstem fields and ten diencephalic fields from Brainstem Navigator, with source T2/FA templates | Compound nuclei remain combined and numbered subdivisions remain source-specific. A named parent and its component fields may overlap. Cranial nerve courses are not inferred. |
| Cisternal regions | Six explicitly unreviewed regional observation anchors in real SPL/NAC T2 MRI; MIDA general and ventricular CSF classes | The observation anchors are teaching annotations. General CSF is not a set of named cistern segmentations. No membrane or compartment boundary is reconstructed. |
| Skull-base context | MIDA skull classes, dura, sphenoidal sinus air, mastoid air, cochlea and semicircular canals | Individual skull-base bones and foramina are not separately labelled. Original MIDA MRI is unavailable. |
| Vascular model context | MIDA whole-source artery and vein classes | Broader head and neck extents are retained. These are not named arterial branches or venous sinus subdivisions. |

All packages preserve their own coordinates and source definitions. HCP uses its publisher-declared ICBM 2009a asymmetric reference. The Mouches volumes retain their delivered shared grid without asserting an interchangeable relation to another MNI release. Compare other sources in independent panels; do not superimpose them without a separately validated correspondence.

The original HCP abbreviation spreadsheet repeats left-side suffixes in the definitions of `C_FP_R` and `TR_S_R`. The recipe retains these discrepancies in source notes. Display-side names follow the original filenames, with independently checked native RAS centroids. No coordinates are mirrored to resolve the naming discrepancy.

## Source-to-teaching workflow

Start the installed Linux workspace with separate data and state roots:

```bash
conda activate NeuroImage
neuroimage workspace --data-root /path/on/hdd/NeuroImage --state-root /path/on/ssd/neuroimage-state --workers 2
```

Use **Learning module** to find the available sources. Open **Coverage** to read their evidence and limitations. **Acquire or verify** checks existing source files before downloading or extracting missing inputs. **Build or resume** uses a content-addressed construction checkpoint. The workspace displays the acquisition and construction budgets before starting work.

Open **Local atlases** and select the intended source version. Older packages remain available for saved-scene recovery. Only compatible teaching recipes are offered: a curriculum must match the source version and find all required structures and image evidence in that specific package.

| Installed teaching recipe | Views | Purpose |
| --- | ---: | --- |
| `hcp1065-specialist-pathways` | 10 | Bounded pathway groups, source subdivisions and computational cranial-nerve trajectories |
| `mida-cranial-skull-context` | 9 | Delivered cranial-nerve classes with categorical brain, skull, vascular and CSF context |
| `mida-skull-cutaway` | 4 | Whole source context, reversible native-RAS surface cuts and inner-ear context |
| `spl-cisternal-regions` | 6 | Source-image regional discussion anchors, with placement review pending |
| `mouches-arterial-occurrence` | 5 | Original percent values, the project display threshold and left/right source samples |
| `ixi-native-mra-observation` | 4 | Original acquired coverage and same-point intensity-window comparisons without invented labels |
| `brainstem-expanded-regions` | 18 | Paired source nuclei, combined regions, independent parent/component fields and diencephalic context |

Choose a teaching recipe, press **Prepare teaching**, and open the resulting notebook. Every view starts with complete available source sections. **Magnify at cursor** enlarges the same physical point; **Full sections** restores global context. The source voxel arrays and surfaces are unchanged. The MIDA notebook includes existing brain-tissue and skull labels so that its global categorical sections remain recognizable; these colors are not MRI intensities.

Image-only MRA packages use the same workflow with an empty structure inventory. Source intensity is available independently of display contrast. The native-image notebook records contrast and 3D intensity visibility; annotations remain image observations without a fabricated structure association. See [native MRA images](native-mra-images.md) for acquisition size, source preservation and display limits.

The optional **Inspect → Show 3D cursor** control hides the thick spatial guide when it covers a small region. Slice cursors remain visible at the same physical point; this display choice is retained by scenes, notebooks and teaching exports. Custom teaching recipes can set `display.show_3d_cursor` to `false`.

Use visibility controls and individual 3D opacity to inspect small structures. **Center 3D on cursor** and **3D zoom** change the view, not anatomy. HCP lessons show no more than six bundles per prepared view; source subsets contain complete retained trajectories at the selected display level. The complete source trajectories remain separately downloadable from the local package.

In **Inspect → 3D surface cutaway**, select the currently visible or search-matched surfaces, choose an R/A/S plane and the side to remove, and adjust its native millimeter coordinate. **Move cut to cursor** uses the existing physical cursor. **Restore whole surfaces** removes the display cut. Only the selected 3D surfaces are clipped; complete 2D sections and all source vertices remain unchanged. The opening has no generated cap and does not identify an anatomical boundary. Zero in a source coordinate axis does not by itself establish an anatomical midline. Scene files, notebooks and credited exports record the exact cut plane and target structures.

**Export notebook** preserves the ordered teaching views. **Export teaching image** includes the PNG, exact scene, original source manifest, renderer identity, notes and source licenses. A recipient needs their own exact matching local atlas to restore a scene. Use `neuroimage locate` or `neuroimage open` with the exported notebook and the data root to resolve that package.

## Paired review material

For each prepared notebook view, export the recorded full-section view as `view-1.zip`, `view-2.zip`, and so on into a folder on the data drive. Optionally export **Magnify at cursor** at the same point as `view-1-magnified.zip`. Restore the recorded view before advancing. Assemble the packet with:

```bash
neuroimage review notebook /path/on/hdd/prepared-notebook.json \
  --captures /path/on/hdd/review-exports \
  --data-root /path/on/hdd/NeuroImage
```

The assembler requires the exact source package, recorded coordinates, annotations, visibility, camera, contrast and teaching notes. An enlarged image may change only the cursor-centered display magnification. It writes a local HTML review sheet with uniquely numbered notebook views, clickable full-resolution images, exact scenes, attribution and an empty assessment template. Source and image hashes are checked when the packet is reused.

Expert observations belong in the assessment or an explicitly scoped instructor-feedback record. Validate a saved assessment with:

```bash
neuroimage review check assessment.json --packet /path/on/hdd/notebook-review-packet
```

This checks record identity and completeness. It does not certify anatomy or reviewer qualifications. Unassessed content remains unassessed, and expert review is excluded from the software-development progress denominator.

## Engineering verification and recovery

`scripts/check_specialist_sources.py` independently compares original HCP TrackVis points with complete TCK trajectories, every selected MIDA voxel with the filtered local model, and original arterial/TOF arrays with the retained volumes. The arterial mask must equal the explicitly declared inclusive percentage threshold. Model surfaces retain the original half-grid construction vertices, including very small source nerve classes.

`scripts/browser_specialist_notebooks.js` (testing branch) exercises actual local workspace preparation, exact notebook startup, full-section magnification, display-convention changes, source-bound image export and portable notebook restoration. Its recorded graphics measurements cover WebGL buffers and JavaScript heap, not complete driver or texture allocation.

`scripts/browser_surface_cutaway.js` records the actual GPU clipping plane, original vertex-buffer identity, complete-section pixels and depth-picking behavior. `scripts/check_surface_cutaway.py` independently checks restored images and the picked point against original surface triangles. The four-view skull-context notebook exercises cutaway preparation, presentation, clearing and source-bound export.

Original acquisitions and accepted older packages are preserved. Repeating acquisition verifies and reuses matching files; repeating construction reuses matching completed assets. Notebook preparation is content-addressed and refuses to overwrite altered user content. Review exports and reviewer assessments remain independent of reproducible build caches.

## Primary references

- HCP source definitions and citations are retained in `src/neuroimage/recipes/hcp1065_tracts.json` and each local package's source notices.
- MIDA: [official model description](https://itis.swiss/virtual-population/regional-human-models/mida-model) and [Iacono et al., 2015](https://doi.org/10.1371/journal.pone.0124126).
- Arterial atlas: [Mouches and Forkert, 2019](https://doi.org/10.1038/s41597-019-0034-5) and [official source collection](https://springernature.figshare.com/collections/A_statistical_atlas_of_cerebral_arteries_generated_using_multi-center_MRA_datasets_from_healthy_subjects/4215089).
- SPL/NAC: [official normal-volunteer atlas description](https://www.openanatomy.org/atlas-pages/atlas-spl-nac-brain.html).
- Cisternal terminology: [University at Buffalo neuroscience teaching reference](https://ubneuro-ccohan.webapps.buffalo.edu/cisterns.html). External illustrations are not incorporated into the software or these teaching images.

The [expanded brainstem guide](brainstem-source-regions.md) describes 86 independent source fields and the additional 18-view notebook. An entry may be a parent region, component or complex; the catalogue count does not mean 86 independent histological nuclei. All original probability values and memberships remain separate.

The [specialist follow-up backlog](specialist-follow-up.md) separates remaining anatomical breadth, required source evidence and future engineering completion conditions. It does not add expert review to the software denominator or change the fixed current-session ledger.
