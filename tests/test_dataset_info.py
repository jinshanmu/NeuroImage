"""Dataset introductions must be available before a source atlas is built."""

from copy import deepcopy
import json
from pathlib import Path

import pytest

from neuroimage.adapters import load_recipe, recipe_names
from neuroimage.contracts import Manifest
from neuroimage.dataset_info import dataset_info, manifest_dataset_info, metadata_paragraphs
from neuroimage.workspace import Workspace


@pytest.mark.parametrize("name", recipe_names())
def test_every_enabled_source_has_serializable_original_space_and_evidence(name):
    recipe = load_recipe(name)
    original = deepcopy(recipe)
    info = dataset_info(recipe)
    assert json.loads(json.dumps(info, allow_nan=False)) == info
    assert info["description"] and all(isinstance(item, str) and item for item in info["description"])
    assert isinstance(info["scope_notes"], list)
    assert all(isinstance(item, str) and item for item in info["scope_notes"])
    assert info["space"]["name"] == recipe["space"]["name"]
    assert info["space"]["correspondence"] == recipe["space"]["correspondence"]
    if recipe["space"].get("unit_basis"):
        assert info["space"]["unit_basis"] == recipe["space"]["unit_basis"]
    assert info["representation"] == recipe.get("representation", "mri-labels")
    assert info["atlas_label"]
    for field in ("model_evidence", "streamline_evidence", "probability_interpretation",
                  "probability_derivation", "region_evidence"):
        if recipe.get(field):
            assert recipe[field] in info["description"]
    assert set(recipe.get("scope_notes", [])) <= set(info["scope_notes"])
    assert set(recipe.get("region_notes", [])) <= set(info["scope_notes"])
    assert "nextbrain" not in json.dumps(info).casefold()
    assert recipe == original


def test_source_cases_are_explicit_volunteers_with_original_zero_padded_ids():
    from neuroimage.case_selection import selected_cases
    names = [name for name in recipe_names() if name.startswith("thu_mra_case")]
    assert len(names) == 10
    cases = set()
    for name in names:
        recipe = load_recipe(name)
        info = dataset_info(recipe)
        assert info["case_id"] == recipe["source_case"]["case"]
        assert info["case_label"] == "Volunteer " + info["case_id"]
        assert info["atlas_label"] == "Source MRA and arterial segments"
        assert "missing annotations do not establish anatomical absence" in info["description"][0]
        cases.add(info["case_id"])
    assert cases == selected_cases("thu_mra")
    for case in ["001", "006", "007", "009", "010", "014", "021", "030"]:
        # The original eight packages retain their exact hand-written recipes.
        path = Path(__file__).parents[1] / "src/neuroimage/recipes" / f"thu_mra_case{case}.json"
        assert load_recipe(f"thu_mra_case{case}") == json.loads(path.read_text())


def test_mug_mask_and_cleaned_surface_share_the_explicit_a0101_case():
    names = ["mug500_healthy", "mug500_source_mesh"]
    metadata = [dataset_info(load_recipe(name)) for name in names]
    assert {info["case_id"] for info in metadata} == {"A0101"}
    assert {info["case_label"] for info in metadata} == {"Skull A0101"}
    assert {info["atlas_label"] for info in metadata} == {
        "Original skull mask", "Author-cleaned skull surface"
    }
    assert metadata[0]["space"] != metadata[1]["space"]
    for name in names:
        recipe = load_recipe(name)
        assert "A0101" in recipe["title"]
        assert any("A0101" in source["citation"] for source in recipe["sources"])


@pytest.mark.parametrize("names", [
    ["hcp1065_tracts", "hcp1065_prob"],
    ["bigbrain_layers", "bigbrain_hippocampus"],
])
def test_source_representations_are_not_invented_as_cases(names):
    metadata = [dataset_info(load_recipe(name)) for name in names]
    assert all(info["case_id"] is None and info["case_label"] is None for info in metadata)
    assert len({info["atlas_label"] for info in metadata}) == 2


@pytest.mark.parametrize("source_alias", [False, True])
def test_archived_inner_ear_recipe_cannot_bypass_metadata_exclusion(source_alias):
    path = Path(__file__).resolve().parents[1] / "src/neuroimage/recipes/inner_ear_ct_specimen1.json"
    archived_bytes = path.read_bytes()
    recipe = json.loads(archived_bytes)
    if source_alias:
        recipe["id"] = "historical_alias"
    original = deepcopy(recipe)
    with pytest.raises(ValueError, match="Specialist ear anatomy is deferred"):
        dataset_info(recipe)
    assert recipe == original
    assert path.read_bytes() == archived_bytes


def test_case_identity_is_not_guessed_from_a_title_space_or_version():
    recipe = {
        "id": "custom_source", "title": "Subject 999 representation 2",
        "version": "case-999", "sources": [],
        "space": {"name": "Case 999 XYZ", "correspondence": "Original source coordinates."},
    }
    info = dataset_info(recipe)
    assert info["case_id"] is None and info["case_label"] is None
    assert info["atlas_label"] == recipe["title"]
    assert info["description"] == [recipe["title"]]


def test_scalar_descriptions_retain_the_source_metric_interpretations():
    recipe = {"id": "synthetic_scalar", "title": "Synthetic scalar metadata", "sources": [],
              "images": [{"name": "Source metric", "scalar": {
                  "interpretation": "A source statistic, not the probability of a named vessel.",
                  "derivation": "Original synthetic statistical derivation."}}]}
    info = dataset_info(recipe)
    for image in recipe["images"]:
        assert any(image["scalar"]["interpretation"] in paragraph for paragraph in info["description"])
        assert image["scalar"]["derivation"] in info["scope_notes"]
    assert "not the probability of a named vessel" in " ".join(info["description"])


def test_region_limitations_are_exposed_and_archived_comparison_invitations_are_filtered():
    recipe = load_recipe("brainstem_navigator_mni")
    assert len(recipe["region_notes"]) == 6
    assert set(recipe["region_notes"]) <= set(dataset_info(recipe)["scope_notes"])
    paragraphs = [" Preserved source boundary. ", "Compare with NextBrain native packages.",
                  "Preserved source boundary.", "Different source spaces remain independent."]
    original = list(paragraphs)
    assert metadata_paragraphs(paragraphs) == [
        "Preserved source boundary.", "Different source spaces remain independent."
    ]
    assert paragraphs == original
    assert metadata_paragraphs(
        "Open IXI for native MRA.", "Choose VENAT for statistical fields.",
        "Compare with Mouches arterial occurrence.", "HumanBrainAtlas is available for viewing.",
        "Open Arterial occurrence atlas for population context.",
        "Meso-vein MRI remains available.",
        "MRI and MRA intensity observations are distinct from segmented boundaries.",
    ) == ["MRI and MRA intensity observations are distinct from segmented boundaries."]
    hippocampus = load_recipe("bigbrain_hippocampus")
    assert any("NextBrain" in note for note in hippocampus["model_notes"])
    assert not any("NextBrain" in note for note in dataset_info(hippocampus)["scope_notes"])


@pytest.mark.parametrize("ident", ["nextbrain_case1_block05", "ixi_mra", "hba_native",
                                   "mesoveins", "venat", "mouches_arteries", "inner_ear_ct_specimen1",
                                   "topcow2024", "topbrain2025", "tcia_cases", "msd_brain_tumour"])
def test_excluded_sources_cannot_receive_current_dataset_descriptions(ident):
    with pytest.raises(ValueError, match="excluded"):
        dataset_info({"id": ident, "title": "Historical source", "sources": []})


def test_browse_and_catalog_include_identical_information_without_built_atlases(
        tmp_path, monkeypatch):
    data, state = tmp_path / "data", tmp_path / "state"
    data.mkdir()
    workspace = Workspace(data, state, data_floor_gib=0, state_floor_gib=0)
    monkeypatch.setattr(workspace, "package_records", lambda **kwargs: [])
    monkeypatch.setattr("neuroimage.workspace.acquisition_plan",
                        lambda *args, **kwargs: {"free_bytes": 10 ** 15})
    try:
        browse = workspace.browse()
        catalog = workspace.catalog()
        assert browse["packages"] == [] and catalog["packages"] == []
        assert not list(data.iterdir())
        browsed = {source["id"]: source for source in browse["sources"]}
        full = {source["id"]: source for source in catalog["sources"]}
        assert set(browsed) == set(full) == set(recipe_names())
        for name, source in browsed.items():
            assert source["dataset_info"] == full[name]["dataset_info"] == dataset_info(load_recipe(name))
            assert source["sources"] == full[name]["sources"] == load_recipe(name)["sources"]

        # Acquisition/storage failures must not remove the introduction needed
        # to understand an unbuilt dataset or alter the original source terms.
        def unavailable(*args, **kwargs):
            raise ValueError("Synthetic acquisition planning issue")

        monkeypatch.setattr("neuroimage.workspace.acquisition_plan", unavailable)
        failed = {source["id"]: source for source in workspace.catalog()["sources"]}
        for name in browsed:
            assert failed[name]["error"] == "Synthetic acquisition planning issue"
            assert failed[name]["dataset_info"] == browsed[name]["dataset_info"]
            assert failed[name]["sources"] == browsed[name]["sources"]
    finally:
        workspace.close()


def _historical_manifest():
    """Complete synthetic manifest metadata; no assets are read or generated."""
    evidence = {
        "modality": "MRI", "source_input": "original_image", "source_dataset": "original-run",
        "intensity_units": "Source integer samples", "calibration": "Actual package calibration.",
        "acquisition": "Synthetic original acquisition record.", "sampling": "Native synthetic sampling.",
    }
    return {
        "schema_version": "1.6", "package_id": "historical_source", "dataset_id": "historical_source",
        "title": "Historical source atlas", "package_version": "old-version", "representation": "mri-volume",
        "space": {"id": "old-native", "name": "Historical native coordinates", "reference": "Original header",
                  "correspondence": "Only this historical image's physical grid."},
        "sources": [{
            "id": "historical_source", "title": "Original publisher title", "version": "old-release",
            "url": "https://example.org/original-source", "citation": "Complete original publication citation.",
            "license_name": "CC0", "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
            "license_file": "licenses/original.txt",
        }],
        "volumes": [{
            "id": "image", "name": "Historical native image", "kind": "image", "image_evidence": evidence,
            "file": "volumes/image.nii.gz", "shape": [2, 2, 2], "voxel_size_mm": [1, 1, 1],
            "affine_ras_mm": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
            "orientation": "RAS", "cal_min": 0, "cal_max": 1,
        }],
        "structures": [],
        "assets": [{"path": path, "role": role, "bytes": 1, "sha256": "a" * 64}
                   for path, role in [("volumes/image.nii.gz", "image"),
                                      ("licenses/original.txt", "license"), ("lessons.json", "lessons")]],
        "lessons_file": "lessons.json",
        "build": {"created_utc": "2025-01-01T00:00:00Z", "recipe": {
            "representation": "mri-labels", "scope_notes": ["Original stored recipe limitation."],
            "space": {"name": "Recipe declaration", "correspondence": "Superseded by the actual header.",
                      "unit_basis": "This recipe-only basis must not leak into the actual MRI space."},
            "images": [{"image_evidence": {**evidence, "calibration": "Superseded recipe calibration."}}],
        }},
        "validation": {"warnings": [
            "Retained field-of-view limitation.", "Retained field-of-view limitation.",
            "Independent expert review remains pending.", "No anatomical review has been recorded.",
            "Unreviewed source metadata.", "Compare this package with NextBrain.",
        ]},
    }


def test_exact_package_metadata_overrides_recipe_space_representation_and_image_record():
    manifest = _historical_manifest()
    original = deepcopy(manifest)
    info = manifest_dataset_info(manifest)
    assert info["description"] == ["Historical source atlas"]
    assert info["space"] == {
        "name": "Historical native coordinates", "correspondence": "Only this historical image's physical grid."
    }
    assert info["representation"] == "mri-volume"
    assert info["scope_notes"] == ["Original stored recipe limitation.", "Retained field-of-view limitation."]
    assert info["image_evidence"] == [manifest["volumes"][0]["image_evidence"]]
    assert manifest == original
    assert manifest_dataset_info(Manifest.model_validate(manifest)) == info
    info["image_evidence"][0]["calibration"] = "Mutated caller copy"
    assert manifest == original


def test_manifest_fallback_needs_no_current_recipe_and_retains_actual_model_units(monkeypatch):
    manifest = _historical_manifest()
    manifest["build"] = {}
    manifest["space"]["unit_basis"] = "The actual package's recorded unit basis."

    def current_recipe_must_not_be_loaded(*args):
        pytest.fail("Historical metadata must not be replaced by today's recipe.")

    monkeypatch.setattr("neuroimage.adapters.load_recipe", current_recipe_must_not_be_loaded)
    info = manifest_dataset_info(manifest)
    assert info["description"] == [manifest["title"]]
    assert info["space"]["unit_basis"] == manifest["space"]["unit_basis"]
    assert info["scope_notes"] == ["Retained field-of-view limitation."]


def test_manifest_image_evidence_is_nonempty_unique_and_never_invented_from_the_recipe():
    manifest = _historical_manifest()
    evidence = manifest["volumes"][0]["image_evidence"]
    manifest["volumes"] = [{"image_evidence": evidence}, {"image_evidence": dict(evidence)},
                           {"image_evidence": None}, {"image_evidence": {}}, {}]
    assert manifest_dataset_info(manifest)["image_evidence"] == [evidence]
    manifest["volumes"] = [{"image_evidence": None}]
    assert "image_evidence" not in manifest_dataset_info(manifest)


def test_manifest_package_identity_cannot_reenable_an_excluded_source():
    manifest = _historical_manifest()
    manifest["package_id"] = "nextbrain-retained-package"
    with pytest.raises(ValueError, match="excluded"):
        manifest_dataset_info(manifest)


def test_available_and_cached_packages_keep_exact_metadata_and_full_source_citations(
        tmp_path, monkeypatch):
    data, state = tmp_path / "data", tmp_path / "state"
    data.mkdir()
    manifest = _historical_manifest()
    path = data / "manifest.json"
    path.write_text(json.dumps(manifest))
    original_bytes = path.read_bytes()
    # Emulate library_records' deliberately abbreviated source summary. Both
    # public workspace endpoints must replace it from this exact manifest.
    record = {
        "dataset_id": manifest["dataset_id"], "package_id": manifest["package_id"],
        "package_version": manifest["package_version"], "title": manifest["title"],
        "representation": manifest["representation"], "created_utc": manifest["build"]["created_utc"],
        "manifest": str(path), "status": "available",
        "sources": [{key: source[key] for key in ("id", "version", "license_name")}
                    for source in manifest["sources"]],
    }
    discovery_reads = []

    def library_records(*args, **kwargs):
        discovery_reads.append(True)
        return deepcopy([record])

    monkeypatch.setattr("neuroimage.workspace.library_records", library_records)
    monkeypatch.setattr("neuroimage.workspace.acquisition_plan",
                        lambda *args, **kwargs: {"free_bytes": 10 ** 15})
    workspace = Workspace(data, state, data_floor_gib=0, state_floor_gib=0)
    try:
        first = workspace.browse()
        first["packages"][0]["sources"][0]["citation"] = "Mutated browser caller"
        snapshots = [workspace.browse(), workspace.catalog(), workspace.catalog()]
        assert len(discovery_reads) == 1  # Cached records still receive complete metadata.
        for snapshot in snapshots:
            package = snapshot["packages"][0]
            assert package["dataset_info"] == manifest_dataset_info(manifest)
            assert package["sources"] == manifest["sources"]
            source = package["sources"][0]
            assert source["title"] == "Original publisher title"
            assert source["url"] == "https://example.org/original-source"
            assert source["citation"] == "Complete original publication citation."
            assert package["dataset_info"]["space"]["name"] == "Historical native coordinates"
            assert package["dataset_info"]["representation"] == "mri-volume"
        assert path.read_bytes() == original_bytes
    finally:
        workspace.close()
