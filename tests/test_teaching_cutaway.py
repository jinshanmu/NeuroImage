import copy
import pytest

from neuroimage.teaching import TeachingSurfaceCutaway, curriculum_matches


def test_cutaway_requires_valid_unambiguous_native_plane_and_scope():
    record = {"axis": 2, "side": 1, "position_mm": 0.0, "structures": ["source:skull"]}
    assert TeachingSurfaceCutaway.model_validate(record).model_dump() == record
    for change in [{"axis": True}, {"side": False}, {"axis": 3}, {"side": 0},
                   {"position_mm": float("nan")}, {"position_mm": float("inf")},
                   {"structures": []}, {"structures": ["source:skull", "source:skull"]}]:
        with pytest.raises(ValueError):
            TeachingSurfaceCutaway.model_validate({**record, **change})


def test_cutaway_curriculum_requires_all_target_surfaces_in_actual_package():
    manifest = {"dataset_id": "source", "representation": "label-model", "sources": [{"id": "source", "version": "1"}],
                "volumes": [{"id": "labels", "kind": "labels"}], "structures": [{"id": "source:nerve"}]}
    recipe = {"dataset_id": "source", "required_source": {"id": "source", "version": "1"},
              "scenes": [{"selected": "source:nerve", "visible": ["source:nerve"], "background": "labels",
                          "display": {"surface_cutaway": {"axis": 2, "side": 1, "position_mm": 0.0, "structures": ["source:skull"]}}}]}
    assert not curriculum_matches(recipe, manifest)
    expanded = copy.deepcopy(manifest)
    expanded["structures"].append({"id": "source:skull"})
    assert curriculum_matches(recipe, expanded)
    expanded["representation"] = "mri-streamlines"
    assert not curriculum_matches(recipe, expanded)
