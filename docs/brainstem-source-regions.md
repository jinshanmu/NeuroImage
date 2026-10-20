# Independent brainstem regions

This source guide includes historical teaching-validation records. Curricula, lessons and course workflows described here are retained in `codex/release-testing`; the formal release exposes the same source anatomy through [Browse anatomy](getting-started.md).

NeuroImage 0.10.0 extends the original twelve-region package to all 76 delivered MNI brainstem fields and all ten delivered MNI diencephalic fields through the shared local workflow. The catalogue retains both whole regions and their source subdivisions, so its 86 entries are not 86 independent nuclei. The original twelve-region package remains available for earlier teaching scenes. Each region retains its complete scalar probability field and its independently delivered binary navigation mask. Overlaps remain simultaneous memberships.

## Source and scope

The [official Brainstem Navigator 1.0 release](https://www.nitrc.org/projects/brainstemnavig/) supplies the atlas, BIlab group-average T2-weighted and diffusion fractional-anisotropy images, source definitions and copyright. The release date is 8 October 2024; its Readme states that atlas images are unchanged from version 0.9. Only the supplied MNI-grid files are used. The project does not substitute another MNI template or perform a new registration. The package's space ID is `brainstem-navigator-mni-v1`.

The source regions derive from healthy adult MRI, including the twelve-person acquisition described by [Bianciardi et al. (2015)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4684653/) and the collicular delineations described by [García-Gomar et al. (2019)](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2019.00764/full). The latter work reused the former acquisition. Probability values describe population-template spatial overlap of source delineations; they are not individual tissue probabilities or clinical confidence. The source authors' template transforms are part of source provenance. NeuroImage adds no transforms, mirroring, smoothing or geometric refinement.

The supplied BIlab images have partial brain coverage, including absent temporal-lobe coverage. Zero-valued areas outside that coverage must not be interpreted as absent anatomy. Source grid sampling is 1 mm; the papers describe a 1.1 mm acquisition. These are different stages of the source processing, not a project resolution enhancement. Numbered source subdivisions retain their original names. They are not assigned new histological boundaries or cranial nerve pathways. Compound labels, including vestibular and viscero-sensory-motor complexes, remain combined. The latter does not separately delineate solitary, vagal or hypoglossal nuclei.

The source copyright permits non-commercial research and forbids external distribution of source files or information derived from them. Preserve and consult the original `Copyright.txt`, retained in the local atlas and every teaching export. Software remains Apache-2.0, contains no acquired anatomy and does not confer rights over separately acquired data. A local image export is not permission to publish or redistribute it. This is the same dataset interface and workflow used for all other sources.

## Acquire and construct

Activate the independent `NeuroImage` environment and use the configured HDD root:

```bash
neuroimage acquire brainstem_navigator_mni --data-root "$NEUROIMAGE_DATA_ROOT" --dry-run
neuroimage acquire brainstem_navigator_mni --data-root "$NEUROIMAGE_DATA_ROOT"
neuroimage build brainstem_navigator_mni --data-root "$NEUROIMAGE_DATA_ROOT" --workers 2
neuroimage validate "$NEUROIMAGE_MANIFEST"
neuroimage serve --atlas "$NEUROIMAGE_MANIFEST"
```

Set `NEUROIMAGE_MANIFEST` to the manifest path printed by construction. Acquisition pins the official 89,067,709-byte ZIP and 177 selected members totaling 35,621,417 bytes. Existing verified files are reused. A fresh acquisition needs about 119 MiB for the archive and selected compressed files; construction reserves 2 GiB in addition to the configured free-space floor. Original archives and source files stay intact. No full alternate-space expansion is needed.

Construction writes two image volumes, 86 complete probabilities, 86 independent masks, 86 GIFTI surfaces, source copyright, lessons and validation records. The expanded 0.10.0 construction measured 147.71 seconds with two workers and 763,696 KiB peak resident memory on the development host. All 177 source inputs were verified and reused without downloads or expansion. Complete-package reuse checks source and output hashes and skips geometry. Individual missing or corrupted output assets are rebuilt while intact outputs remain unchanged. Re-run the same command after interruption; checkpoint and source-signature checks protect earlier results.

## Browse the evidence

Selecting a structure focuses a retained member voxel. The default 2D overlay shows that selected region's original probability field. Move the cursor to sample it; selecting another structure changes the field. Switch **2D evidence** to **Selected binary mask** to inspect its original navigation boundary. Other visible structures remain available as 3D surfaces. There is no combined winner-take-all label image.

The mask comparison is inclusive: support **greater than or equal to 0.35**. Source validation found 38 PAG voxels exactly at that threshold. The original twelve-mask package has 14 voxels with two memberships; the expanded catalogue also retains parent/subregion overlaps. These are independently checked; probabilities below the binary boundary remain available.

After moving the cursor, **Source mask membership at cursor** lists every visible source region containing the nearest native voxel. Choose a candidate to change the selected field without moving the cursor. Hidden regions leave this list. A population-map overlap does not establish tissue interpenetration in an individual. Surface picking separately reports proximity to visible mask boundaries, which lie between voxel centers.

**Full sections** shows the complete available source field of view and is the default for new views and this curriculum. First establish global location, then use **Magnify at cursor** to inspect the current position at 3× or the existing higher zoom. **2D zoom** adjusts magnification around that location; returning to 1× restores full sections. Changing the field of view preserves the source cursor and selected structure. The source MRI itself has partial brain coverage; the full view does not add missing anatomy. **Center 3D on cursor** sets a physical rotation center; **3D zoom** controls magnification. These operations change only view parameters. Both centers, evidence mode, visibility, opacity, notes and markers survive scene export, restoration and notebook presentation. **Reset view** restores the package's starting state.

## Prepare and teach

Open the matching source through **Browse anatomy**; use the [current browser guide](getting-started.md) for display and scene controls.

Set `NEUROIMAGE_NOTEBOOK` to the preparer's printed notebook path. The installed six-view curriculum covers paired red nuclei with nigral context, the binary mask in FA context, collicular source regions, a verified PAG/DR overlap voxel, positive PAG support outside its binary mask, and paired inferior olivary regions. The views include editable prompts, notes, source-bound points and exact display settings. Return to the recorded view after exploration, advance through the sequence and export a credited image or the portable notebook. Opening a file preserves an existing saved browser notebook.

Teaching recipes may specify `source_voxel` with a selected region's probability or mask `volume_id` and an integer native `index`. The preparer checks ownership, bounds and positive source evidence, reads its original package value and maps that voxel through the recorded affine. It records the sample in the notes and marker. This permits teaching low support or simultaneous membership without inventing an anatomical landmark. Such a sample can lie outside the binary navigation mask when its reference is the complete probability field.

The expanded nine built-in exploration sequences, retained six-view example and additional 18-view `brainstem-expanded-regions` notebook are instructor-editable drafts. The new notebook uses at most six visible source regions per view and begins each view with complete available sections. Engineering acceptance is separate from anatomical and teaching review. A single instructor-approved view does not approve another region, a whole atlas or each criterion.

## Verify and recover

`scripts/check_independent_regions.py` compares every output scalar value and affine with the independently acquired NIfTI files using direct NiBabel reads. It also checks the inclusive threshold, source-side centroids and every overlapping voxel. `scripts/browser_independent_regions.js` (testing branch) exercises the actual browser; `scripts/check_region_browser.py` independently compares its readouts and GPU mesh digests with source arrays and GIFTI geometry, and checks restoration pixels and export notices. These engineering checks do not establish histological accuracy.

Scenes and notebooks require the exact package signature and native space. Use `neuroimage locate <file> --data-root <root>` to find the matching manifest, then `neuroimage open <file> --data-root <root>`. Preserve user-edited exports and review assessments separately from reconstructible caches. Build and serving use the same entry points as all other datasets, including side-by-side native-space comparison. No cross-atlas anatomical fusion is implied.

## Expanded source definitions

The 18-view expanded notebook covers vestibular and olivary complexes, the medullary viscero-sensory-motor complex, parabrachial and coeruleus regions, reticular fields, raphe regions, source subregions and geniculate/subthalamic fields. It retains original probability support and simultaneous memberships instead of resolving parent/component overlaps. The source describes the nigral numbered subdivisions as compatible with reticulata and compacta; that interpretation is disclosed as source evidence, not independent histological confirmation.

Relevant added sources are [Bianciardi et al. 2018](https://doi.org/10.1016/j.neuroimage.2017.04.070), [Singh et al. 2020](https://doi.org/10.3389/fnins.2019.01425), [Singh et al. 2021](https://doi.org/10.1089/brain.2020.0975) and [Garcia-Gomar et al. 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9018552/). In the latter paper, the atlas-generation method explicitly uses the earlier Bianciardi 2015 acquisition; its separate clinical connectivity experiment is not imported. Source references are attached to each region in the recipe.
