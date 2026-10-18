# DICOM source readiness

`scripts/inspect_dicom_series.py` is a read-only repository utility for planning additional source adapters. It uses the existing dedicated NeuroImage environment, including `pydicom==3.0.2` from the project lock file. It reads headers, hashes original files and writes a separate metadata receipt under the data-drive benchmarks directory. It decodes no pixel arrays and creates no atlas, segmentation, registration or resampled image.

```bash
conda activate NeuroImage
python scripts/inspect_dicom_series.py \
  --data-root "$ATLAS_DATA_ROOT" \
  --source-folder raw/visiblehuman_head/MR_CT_DICOM \
  --output visiblehuman_head/dicom-readiness/source-series-v3.json
```

The source folder is relative to the data root. The output is relative to its `benchmarks` directory. Existing differing receipts are not overwritten; choose a new name when inputs or the utility change. Original files are unchanged. This utility supports inspection of classic single-frame human image planes; unsupported per-frame geometry remains explicit. It is not a general DICOM converter or an atlas acceptance shortcut.

## Geometry and contrast

The utility separates SeriesInstanceUID, echo number/time, temporal position and ImageType. It retains every source instance, rescale field and image-plane origin. Duplicate instances, mixed reference frames, unsupported anatomical orientation, missing metadata and inconsistent shape/spacing/orientation are explicit. A stable series UID alone does not establish one contrast volume.

Physical positions and directions determine the observed plane intervals. PixelSpacing retains its row/column order. SliceThickness remains a separate recorded quantity, rather than replacing center-to-center sampling pitch. For human orientation, the DICOM patient axes are L/P/S. The authoritative field definitions are in [DICOM PS3.3 Image Plane Module](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.2.html), inspected as version 2026d. No coordinate transformation is applied by this utility.

A 0.0001 mm step-comparison tolerance and 0.000000001 mm floating-point guard are explicitly recorded. This describes header precision only. The first observed step is reported for diagnosis, not supplied as a replacement affine. A future converter must validate its complete source-to-volume mapping. Rescale units are retained exactly as declared; modality-specific interpretation needs the applicable source and IOD. ImageType NORMAL does not certify anatomical normality.

## Existing additional-head source findings

The current receipt covers 691 existing files: 463 CT images and three 76-image MRI contrasts. The PD and T2 inputs share one series UID but use different echo numbers and times. They remain separate. The three MRI groups have regular positions within recorded header precision. All original file hashes match the earlier audit.

The CT has 460 adjacent intervals of 0.5 mm, one of 1.0 mm and one of 1.5 mm. The irregular intervals lie between original J.450/J.451 and J.451/J.452, whose positions are -6.0/-5.0/-3.5 mm along the source LPS z-axis. A hypothetical 0.5 mm lattice lacks positions -5.5, -4.5 and -4.0 mm in the supplied headers. This observation does not establish whether images are absent or coordinates erroneous. DICOM SliceThickness is 1.5 mm throughout. All 463 files listed by the [official source directory](https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Additional-Head-Images/MR_CT_DICOM/CAT/index.html) are present, and five compressed original members around the intervals decode exactly to the local DICOM files.

The [official specimen description](https://data.lhncbc.nlm.nih.gov/public/Visible-Human/Additional-Head-Images/README) identifies a 72-year-old donor preserved in formalin with araldite-filled vessels. This is distinct from living-normal MRI. Clinical normality and teaching suitability are not established by file geometry. This source is not a ninth delivered atlas and contributes nothing to the current source or structure counts.

## Follow-up development

1. Resolve or explicitly represent irregular source coordinates without inventing planes, changing header positions silently or combining different contrasts.
2. Add an explicit modality and intensity-unit contract before displaying CT through the current MRI-specific native-volume interface.
3. Preserve original source-instance and acquisition-method provenance when creating any independent native-space package.
4. Produce clearly identified original-plane evidence for instructor suitability review before proposing normal skull-base teaching content.
5. Validate image/volume correspondence, laterality and source sampling separately from expert assessment. Do not infer CT/MRI/cryo alignment from shared specimen identity.

The compact results are `config/dicom-readiness-verification.json` and `config/visiblehuman-ct-import-readiness.json`. The recorded numerical-boundary diagnostic is `config/dicom-readiness-rounding-diagnostic.json`. Full source-file metadata remains under the configured HDD root. These checks are used for this prospective DICOM adapter, not added as mandatory repeated work for already accepted native NIfTI packages.
