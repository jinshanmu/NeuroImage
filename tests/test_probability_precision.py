"""Retain tiny declared source-scaling roundoff without relaxing anatomical rules."""
import json

import nibabel as nib
import numpy as np
import pytest

from neuroimage import build as pipeline
from neuroimage.source_probability import rounding_tolerance
from test_pipeline import source, probability_source, build


@pytest.mark.parametrize("recipe", [
    {"probability_rounding_tolerance": 1e-7},
    {"probability_rounding_tolerance": 1e-4, "probability_rounding_evidence": "Too large"},
    {"probability_rounding_tolerance": True, "probability_rounding_evidence": "Invalid type"},
    {"probability_rounding_tolerance": float('nan'), "probability_rounding_evidence": "Nonfinite"},
])
def test_source_precision_requires_bounded_explicit_evidence(recipe):
    with pytest.raises(ValueError, match="rounding tolerance"):
        rounding_tolerance(recipe)


def test_declared_source_precision_preserves_every_scaled_value(probability_source):
    source, fields = probability_source
    root, imported = source
    fields[2, 3, 4, 0] = float(np.float32(1 / 255)) * 255
    path = imported.input_paths["probabilities"]
    original = nib.load(path)
    image = nib.Nifti1Image(fields, original.affine)
    image.header.set_xyzt_units("mm")
    nib.save(image, path)
    original_bytes = path.read_bytes()
    with pytest.raises(ValueError, match="within 0 to 1"):
        build(source)
    imported.recipe.update(probability_rounding_tolerance=1e-7,
                           probability_rounding_evidence="Generated uint8 sample 255 scaled by a float32 1/255 slope")
    result = build(source)
    manifest = pipeline.validate_package(result)
    for channel, volume in enumerate(v for v in manifest.volumes if v.kind == "probability"):
        np.testing.assert_array_equal(nib.load(result.parent / volume.file).dataobj, fields[..., channel])
    assert path.read_bytes() == original_bytes
    report = json.loads((result.parent / "validation.json").read_text())
    assert report["probability_channels"][0]["maximum"] > 1
    assert report["probability_channels"][0]["source_rounding_tolerance"] == 1e-7
    assert report["hard_label_probability_relationship"]["mismatch_voxels"] == 0
