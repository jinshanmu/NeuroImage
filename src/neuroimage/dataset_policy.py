"""Exclude out-of-scope source identities independently of local data cleanup."""
from .case_selection import case_exclusion_reason


class ExcludedDatasetError(ValueError):
    """A recorded source is no longer supported by the current application."""


_EXCLUDED_FAMILIES = (
    ("IXI", ("ixi",)),
    ("HumanBrainAtlas", ("hba", "humanbrainatlas")),
    ("Meso-vein MRI", ("mesoveins",)),
    ("VENAT", ("venat",)),
    ("Arterial occurrence atlas", ("mouches", "arterial_occurrence")),
    ("Human Inner Ear CT", ("inner_ear_ct", "inner-ear-ct")),
    ("TopCoW", ("topcow", "topcow2023", "topcow2024")),
    ("TopBrain", ("topbrain", "topbrain2025")),
    # These are the recorded pathological acquisitions, not all TCIA data.
    ("UCSF-PDGM", ("tcia_cases", "ucsf_pdgm", "ucsf-pdgm")),
    ("MSD BrainTumour", ("msd_brain_tumour", "msd_brain_tumor")),
)


_EXCLUSION_REASONS = {
    "NextBrain": "Excluded by the user's source selection: the selected local tissue blocks do not meet this phase's requirement for complete 3D anatomical structures.",
    "IXI": "The selected native MRA image has no anatomical segmentation labels.",
    "HumanBrainAtlas": "The selected native MRI image has no anatomical segmentation labels.",
    "Meso-vein MRI": "The selected native MRI sequence has no anatomical segmentation labels.",
    "VENAT": "Population venous statistical fields are not named anatomical structure segmentations.",
    "Arterial occurrence atlas": "Population occurrence fields and the project display mask do not provide named arterial branch segmentations.",
    "Human Inner Ear CT": "Specialist ear anatomy is deferred in the current project scope.",
    "TopCoW": "This is a clinical patient cohort; eligibility as a normal-anatomy source has not been established.",
    "TopBrain": "These annotations reuse the clinical TopCoW cohort; eligibility as a normal-anatomy source has not been established.",
    "UCSF-PDGM": "This source contains patients with histopathologically confirmed diffuse gliomas.",
    "MSD BrainTumour": "This source supplies glioma, tumour and oedema segmentation data rather than a normal-anatomy cohort.",
}


def _excluded_family(dataset_id, source_ids=()):
    for identity in (dataset_id, *source_ids):
        if not isinstance(identity, str):
            continue
        identity = identity.casefold()
        if identity.startswith("nextbrain"):
            return "NextBrain"
        for name, prefixes in _EXCLUDED_FAMILIES:
            if any(identity == prefix or identity.startswith((prefix + "_", prefix + "-"))
                   for prefix in prefixes):
                return name
    return None


def dataset_is_excluded(dataset_id, source_ids=()):
    source_ids = tuple(source_ids)
    return (_excluded_family(dataset_id, source_ids) is not None
            or any(case_exclusion_reason(identity) for identity in (dataset_id, *source_ids)))


def dataset_exclusion_reason(dataset_id, source_ids=()):
    """Return the recorded scope reason, or None for an enabled identity."""
    source_ids = tuple(source_ids)
    family = _excluded_family(dataset_id, source_ids)
    return (_EXCLUSION_REASONS[family] if family else
            next((reason for identity in (dataset_id, *source_ids)
                  if (reason := case_exclusion_reason(identity))), None))


def require_supported_dataset(dataset_id, source_ids=()):
    source_ids = tuple(source_ids)
    family = _excluded_family(dataset_id, source_ids)
    if family:
        raise ExcludedDatasetError(
            f"{family} has been excluded from this application. {_EXCLUSION_REASONS[family]} "
            "Source definitions, "
            "exclusion records and saved scenes are retained; local data and built "
            "packages may have been cleaned up. Choose another dataset.")
    reason = next((reason for identity in (dataset_id, *source_ids)
                   if (reason := case_exclusion_reason(identity))), None)
    if reason:
        raise ExcludedDatasetError(reason)
