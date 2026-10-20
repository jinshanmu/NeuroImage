# Julich-Brain source MPM with its native asymmetric reference

This source guide includes historical teaching-validation records. Curricula, lessons and course workflows described here are retained in `codex/release-testing`; the formal release exposes the same source anatomy through [Browse anatomy](getting-started.md).

The `julich_selected` recipe constructs the complete delivered Julich-Brain 3.0.3 maximum-probability map described by the pinned source configuration. It retains 314 nonzero entries: 302 hemisphere-specific regional assignments and 12 source GapMaps. These counts refer to source entries, including left/right counterparts; they are not a count of unique anatomical structures. The source filename says 3.0.3 and its explicit labelled-map configuration is retained with the original download.

## Source correspondence and license

The pinned `siibra-configurations` map declares the labelled NIfTI URL, its native ICBM 2009c asymmetric space and every original name-to-value assignment. The adapter requires that exact map identity, space and provider before reading the inventory. Hemisphere identity comes from explicit original names, rather than list order or assumed numeric offsets.

The original 193 × 229 × 193 MPM and the supplied MNI ICBM152 2009c **asymmetric** T1/T2 references have identical 1 mm RAS grids and affines. The MPM header leaves units unspecified; its millimeter interpretation is explicitly recorded from the source's declared reference. The recipe retains all original voxel values and performs no registration or resampling. Symmetric references remain separate source data.

The local license record is the official EBRAINS dataset-version metadata for DOI `10.25493/56EM-75H`, which declares Creative Commons Attribution Non Commercial Share Alike 4.0 International. The original MNI reference `COPYING` file is retained separately. Both records, source versions, citations and hashes accompany the local package and teaching exports. Software distributions contain the acquisition recipe and source-reading implementation; users obtain the atlas data themselves.

Primary source records:

- [Julich-Brain Atlas](https://julich-brain-atlas.de/)
- [Pinned explicit source map configuration](https://raw.githubusercontent.com/FZJ-INM1-BDA/siibra-configurations/236c476dcad972b117fe2573370a6644995f1175/maps/mni152-jba30-labelled.json)
- [Official ICBM152 nonlinear 2009 references and terms](https://www.mcgill.ca/bic/software/tools-data-analysis/anatomical-mri/atlases/icbm152-non-linear-2009)

## Reproducible local workflow

Open the matching source through **Browse anatomy**; use the [current browser guide](getting-started.md) for display and scene controls.

Set `ATLAS_MANIFEST` to the printed successful manifest before validating or preparing teaching. Acquisition reuses the checksum-pinned original inputs. Construction keeps per-asset checkpoints and validates a completed package on resume. The complete source inventory must equal the nonzero values found in the original categorical volume; a dropped region or invented value fails construction.

The accepted local construction took 16.87 seconds with six workers, produced 321 assets totaling 93,692,865 bytes and resumed in 0.45 seconds with every asset reused. These are this machine's observations, not universal timing guarantees. Original T1, T2 and categorical arrays and affines match exactly; all 314 targets sample their original values and agree with explicitly named source hemispheres. See `config/julich-construction-verification-2026-10-13.json`.

## Browse and teach

Julich is available in the general, cortex, deep-nuclei and cerebellum source choices. Search original names or stable source IDs, select a target and use the linked real T1/T2 sections and source-resolution surfaces. GapMaps have their own category, appearance and evidence statement.

Four installed curricula supply 32 recorded views: central cortical regions, medial temporal subdivisions, cerebellar nuclei and ventral striatal/diencephalic regions. They alternate the matching T1 and T2 reference while preserving the source target. Begin with complete sections, magnify at the same point, then return to the recorded scene. Exported views describe population maximum-probability assignments derived from postmortem cytoarchitectonic maps. Their borders express that source model; individual histological boundaries are a different observation.

Engineering browser checks are recorded in `config/julich-browser-verification-2026-10-13.json`. The separate instructor case `JUL-20261013-01` concerns only its captured full-section and magnified left-CA1 pair. Expert feedback remains outside the software engineering denominator.
