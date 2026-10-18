"""Prepare an editable example notebook from explicit source IDs and real targets."""
import hashlib
import json
from pathlib import Path
import shutil
import uuid
import nibabel as nib
import numpy as np
from importlib.metadata import version
from neuroimage import __version__
from neuroimage.build import atomic_json, sha256, GIB
from neuroimage.review import scene_for
from neuroimage.validation import validate_package
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import Literal


class TeachingRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)


class SourceRequirement(TeachingRecord):
    id: str = Field(min_length=1, max_length=100)
    version: str = Field(min_length=1, max_length=256)


class TeachingSurfaceCutaway(TeachingRecord):
    axis: Literal[0, 1, 2]
    side: Literal[-1, 1]
    position_mm: float = Field(ge=-1e6, le=1e6)
    structures: list[str] = Field(min_length=1)

    @field_validator("axis", "side", mode="before")
    @classmethod
    def integer_direction(cls, value):
        if type(value) is not int:
            raise ValueError("Cutaway directions require integer RAS axis and side identifiers")
        return value

    @field_validator("structures")
    @classmethod
    def distinct_structures(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Cutaway source structure IDs must be unique")
        return value


class TeachingDisplay(TeachingRecord):
    surface_opacity: dict[str, float] = {}
    surface_cutaway: TeachingSurfaceCutaway | None = None
    section_planes: list[Literal["axial", "coronal", "sagittal"]] = []
    camera: list[float] | None = None
    center_on_target: bool | None = None
    focus_selected_3d: bool = False
    layout: Literal["quad", "anatomy", "axial", "coronal", "sagittal", "3d"] = "quad"
    tile_layout: Literal["auto", "grid", "row"] | None = None
    radiological: bool = True
    overlay: Literal["labels", "mask", "probability", "streamlines", "none"] | None = None
    image_context: bool | None = None
    show_3d_cursor: bool | None = None
    window: tuple[float, float] | None = None
    label_opacity: float | None = Field(default=None, ge=0, le=1)
    slice_zoom: float | None = Field(default=None, ge=1, le=10)
    streamline_level: Literal["preview", "standard", "detail"] | None = None
    streamline_slab_mm: float | None = Field(default=None, ge=.2, le=10)

    @model_validator(mode="after")
    def bounds(self):
        if self.window is not None and self.window[0] >= self.window[1]:
            raise ValueError("Image contrast requires an increasing finite intensity range")
        if any(value < 0 or value > 1 for value in self.surface_opacity.values()):
            raise ValueError("Surface opacity multipliers must be between 0 and 1")
        if len(set(self.section_planes)) != len(self.section_planes):
            raise ValueError("Section guide names must be unique")
        if self.camera is not None and (len(self.camera) != 3 or not .1 <= self.camera[2] <= 20):
            raise ValueError("Camera requires azimuth, elevation and a zoom between 0.1 and 20")
        if self.focus_selected_3d and self.center_on_target is not None:
            raise ValueError("Choose selected structure framing or an explicit target-centering setting")
        return self


class TeachingStep(TeachingRecord):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,60}$")
    title: str = Field(min_length=1, max_length=120)
    selected: str | None = Field(min_length=1)
    visible: list[str]
    background: str = Field(min_length=1)
    prompt: str = Field(max_length=2000)
    note: str = Field(max_length=8000)
    display: TeachingDisplay = Field(default_factory=TeachingDisplay)
    source_voxel: "SourceVoxel | None" = None
    image_anchor: "ImageAnchor | None" = None

    @model_validator(mode="after")
    def unambiguous_anchor(self):
        if self.selected is None and (self.image_anchor is None or self.visible):
            raise ValueError("A scene without source structures requires an image anchor and an empty structure list")
        if self.source_voxel is not None and self.image_anchor is not None:
            raise ValueError("Choose a structure evidence voxel or a regional image annotation, not both")
        return self

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, value):
        if not value.strip():
            raise ValueError("A teaching scene title must contain text")
        return value


class SourceVoxel(TeachingRecord):
    volume_id: str = Field(min_length=1)
    index: tuple[int, int, int]


class ImageAnchor(SourceVoxel):
    label: str = Field(min_length=1, max_length=200)
    reference: str = Field(min_length=1, max_length=1000)
    interpretation: Literal["regional-teaching-annotation"] = "regional-teaching-annotation"


TeachingStep.model_rebuild()


class TeachingRecipe(TeachingRecord):
    schema_version: Literal["1.0"]
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,60}$")
    dataset_id: str = Field(min_length=1)
    required_source: SourceRequirement
    title: str = Field(min_length=1, max_length=120)
    author: str = Field(max_length=200)
    objective: str = Field(max_length=2000)
    review_status: Literal["draft_not_expert_reviewed"]
    scenes: list[TeachingStep] = Field(min_length=1, max_length=50)

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, value):
        if not value.strip():
            raise ValueError("A notebook title must contain text")
        return value

    @model_validator(mode="after")
    def distinct_scenes(self):
        if len({scene.id for scene in self.scenes}) != len(self.scenes):
            raise ValueError("Teaching scene IDs must be unique")
        return self


def curriculum_names():
    return sorted(path.stem for path in Path(__file__).with_name("curricula").glob("*.json"))


def curriculum_path(name_or_path):
    if str(name_or_path) in curriculum_names():
        return Path(__file__).with_name("curricula") / f"{name_or_path}.json"
    path = Path(name_or_path)
    if not path.is_file():
        raise ValueError(f"Unknown teaching recipe {name_or_path}. Use 'neuroimage teaching recipes' or an existing JSON file.")
    return path


def parse_teaching_recipe(text):
    value = json.loads(text)
    if isinstance(value, dict) and value.get("representation") == "surface-model":
        from .model_teaching import ModelTeachingRecipe
        return ModelTeachingRecipe.model_validate_json(text)
    return TeachingRecipe.model_validate_json(text)


def teaching_recipe_schema():
    from pydantic import TypeAdapter
    from .model_teaching import ModelTeachingRecipe
    return TypeAdapter(TeachingRecipe | ModelTeachingRecipe).json_schema()


def curriculum_matches(recipe, manifest):
    """Match a curriculum to this package's actual source and available evidence."""
    if recipe["dataset_id"] != manifest["dataset_id"]:
        return False
    expected = recipe["required_source"]
    if not any(source["id"] == expected["id"] and source["version"] == expected["version"] for source in manifest["sources"]):
        return False
    if recipe.get("representation") == "surface-model":
        from .model_teaching import model_curriculum_matches
        return model_curriculum_matches(recipe, manifest)
    if manifest.get("representation") == "surface-model":
        return False
    structures = {structure["id"] for structure in manifest["structures"]}
    volumes = {volume["id"] for volume in manifest["volumes"]}
    backgrounds = {volume["id"] for volume in manifest["volumes"] if volume["kind"] == ("labels" if manifest.get("representation") == "label-model" else "scalar" if manifest.get("representation") == "scalar-fields" else "image")}
    for step in recipe["scenes"]:
        required = {*step["visible"], *step.get("display", {}).get("surface_opacity", {})}
        if step["selected"] is not None:
            required.add(step["selected"])
        elif manifest.get("representation") not in ("mri-volume", "scalar-fields") or not step.get("image_anchor") or step["visible"]:
            return False
        cutaway = step.get("display", {}).get("surface_cutaway")
        if cutaway:
            if manifest.get("representation") == "mri-streamlines":
                return False
            required.update(cutaway["structures"])
        if not required <= structures or step["background"] not in backgrounds:
            return False
        for name in ("source_voxel", "image_anchor"):
            if step.get(name) and step[name]["volume_id"] not in volumes:
                return False
    return True


def prepare(manifest_path, recipe_path, data_root, minimum_free_gib=400):
    data_root = Path(data_root).resolve()
    if not data_root.is_dir():
        raise ValueError("The configured data root must already exist")
    manifest_path, recipe_path = Path(manifest_path).resolve(), Path(recipe_path).resolve()
    if not manifest_path.is_relative_to(data_root):
        raise ValueError("Select a local atlas inside the configured data root")
    if recipe_path.stat().st_size > 1024 ** 2:
        raise ValueError("Teaching recipe exceeds the 1 MiB limit")
    recipe = parse_teaching_recipe(recipe_path.read_text()).model_dump()
    manifest = validate_package(manifest_path, cache_policy="reuse")
    expected = recipe["required_source"]
    if manifest.dataset_id != recipe["dataset_id"] or not any(s.id == expected["id"] and s.version == expected["version"] for s in manifest.sources):
        raise ValueError("The recipe requires a different source dataset or version")
    if (manifest.representation == "surface-model") != (recipe.get("representation") == "surface-model"):
        raise ValueError("The teaching recipe and atlas require matching image or native surface-model representations")
    steps = recipe["scenes"]
    if not isinstance(steps, list) or not 1 <= len(steps) <= 50 or len({s["id"] for s in steps}) != len(steps):
        raise ValueError("Require 1 to 50 uniquely identified teaching scenes")
    source = {s.id: s for s in manifest.structures}
    implementation = {name: sha256(Path(__file__).with_name(name)) for name in ("teaching.py", "review.py", "provenance.py")}
    if manifest.representation == "surface-model":
        implementation["model_teaching.py"] = sha256(Path(__file__).with_name("model_teaching.py"))
        if any(step.get("source_annotation") for step in steps):
            for name in ("source_annotations.py", "blender_annotations.py"):
                implementation[name] = sha256(Path(__file__).with_name(name))
    inputs = {"manifest": sha256(manifest_path), "recipe": recipe, "implementation": implementation,
              "software_version": __version__, "pydantic": version("pydantic")}
    signature = hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()
    root = data_root / "exports" / manifest.dataset_id / "notebooks" / f"{recipe['id']}-{signature[:12]}"
    if not root.resolve().is_relative_to(data_root / "exports"):
        raise ValueError("Notebook output must stay inside the data export root")
    if shutil.disk_usage(data_root).free < minimum_free_gib * GIB + 64 * 1024 ** 2:
        raise ValueError("Insufficient data-drive space including the safety floor and teaching export budget")
    target, receipt_path = root / "prepared-notebook.json", root / "preparation.json"
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text())
        if receipt.get("signature") == signature and target.is_file() and sha256(target) == receipt.get("notebook_sha256"):
            return {"status": "reused", "notebook": str(target), "directory": str(root)}
        raise ValueError("Existing prepared content changed; preserve it and use a new recipe revision")
    if root.exists() and any(root.iterdir()):
        raise ValueError("An incomplete preparation exists; preserve its files before preparing again")
    entries = []
    annotations = {}
    if manifest.representation == "surface-model" and any(step.get("source_annotation") for step in steps):
        from .source_annotations import prepare_source_annotations
        annotations = prepare_source_annotations(manifest, steps, data_root, minimum_free_gib)
    for step in steps:
        if manifest.representation == "surface-model":
            from .model_teaching import model_teaching_entry
            spec = step.get("source_annotation")
            entries.append(model_teaching_entry(manifest, step, signature, annotations[spec["id"]] if spec else None))
            continue
        selected = source.get(step["selected"])
        visible = step["visible"]
        image_only = manifest.representation in ("mri-volume", "scalar-fields")
        valid_selection = selected is None and not visible and step["image_anchor"] is not None if image_only else selected is not None and selected.id in visible
        if not valid_selection or len(set(visible)) != len(visible) or any(s not in source for s in visible):
            raise ValueError("A teaching scene refers to unknown or duplicate source structures")
        image = next((v for v in manifest.volumes if v.id == step["background"] and v.kind == ("labels" if manifest.representation == "label-model" else "scalar" if manifest.representation == "scalar-fields" else "image")), None)
        if image is None:
            raise ValueError("A teaching scene requires an unavailable source image")
        scene = scene_for(manifest, selected)
        scene["title"] = step["title"]
        target_position = list(scene["state"]["position"])
        anchor_note = ""
        regional = step["image_anchor"]
        if regional is not None:
            if regional["volume_id"] != image.id:
                raise ValueError("A regional annotation must bind to the displayed native image or model")
            index = regional["index"]
            if any(i < 0 or i >= size for i, size in zip(index, image.shape)):
                raise ValueError("A regional annotation is outside the displayed native grid")
            native = nib.load(manifest_path.parent / image.file)
            value = float(native.dataobj[index])
            if not np.isfinite(value):
                raise ValueError("A regional annotation requires a finite source image sample")
            target_position = nib.affines.apply_affine(native.affine, index).tolist()
            scene["state"].update(position=target_position, focus3D=target_position,
                selectionEvidence={"kind": "teaching-marker", "candidates": []})
            anchor_note = (f"\n\nRegional teaching annotation: {regional['label']}. Native {image.id} voxel {list(index)}, recorded value {value:.8g}. "
                           "The marker identifies a region for observation and discussion, not a segmented structure, membrane, foramen or verified anatomical boundary. " +
                           ("No segmented source structure is assigned to this image point. " if image_only else "The selected source structure supplies context and need not occupy the marker voxel. ") +
                           f"Anatomical reference: {regional['reference']}. Expert placement review is pending.")
        if step["source_voxel"] is not None:
            anchor = step["source_voxel"]
            owned = {selected.probability.volume_id} if selected.probability else set()
            if getattr(selected, "mask", None):
                owned.add(selected.mask.volume_id)
            if anchor["volume_id"] not in owned:
                raise ValueError("A teaching voxel must belong to the selected structure's source evidence")
            volume = next(v for v in manifest.volumes if v.id == anchor["volume_id"])
            index = anchor["index"]
            if any(i < 0 or i >= size for i, size in zip(index, volume.shape)):
                raise ValueError("A teaching source voxel is outside the declared native grid")
            native = nib.load(manifest_path.parent / volume.file)
            value = float(native.dataobj[index])
            if not np.isfinite(value) or value <= 0:
                raise ValueError("A teaching source voxel requires positive recorded structure evidence")
            target_position = nib.affines.apply_affine(native.affine, index).tolist()
            scene["state"]["position"] = target_position
            if manifest.representation == "mri-regions":
                scene["state"]["focus3D"] = target_position
                memberships = []
                for ident in visible:
                    mask_volume = next(v for v in manifest.volumes if v.id == source[ident].mask.volume_id)
                    mask = nib.load(manifest_path.parent / mask_volume.file)
                    voxel = np.floor(nib.affines.apply_affine(np.linalg.inv(mask.affine), target_position) + .5).astype(int)
                    if np.all(voxel >= 0) and np.all(voxel < mask.shape) and mask.dataobj[tuple(voxel)] == 1:
                        memberships.append(ident)
                scene["state"]["selectionEvidence"] = {"kind": "independent-mask", "candidates": sorted(memberships)}
            anchor_note = f"\n\nSource voxel: {volume.id}, index {list(index)}, recorded value {value:.8g}. This records an explicit source evidence sample."
        # Source definitions and review status remain in the bound manifest.
        notes = step["note"] + anchor_note
        scene["state"].update(visible=visible, background=image.id, window=[image.cal_min, image.cal_max], panel="learn", note=notes,
            showMarkers=True, annotations=[{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, signature + step["id"] + "marker")),
            "text": (regional["label"] + " · regional teaching location in the source image." if regional else "Recorded source evidence sample for " + selected.name + "." if step["source_voxel"] else "Retained source trajectory vertex in " + selected.name + "; recorded computational trajectory sample." if manifest.representation == "mri-streamlines" else "Reference point within the delivered " + selected.name + " label."), "position_ras_mm": target_position, "structure_id": None if regional else selected.id}])
        display = step["display"]
        if display["overlay"] is not None:
            overlays = {"none"} if image_only else {"streamlines"} if manifest.representation == "mri-streamlines" else {"mask", "probability"} if manifest.representation == "mri-regions" else {"labels", "probability"} if selected.probability else {"labels"}
            if display["overlay"] not in overlays:
                raise ValueError("Teaching evidence overlay is unavailable in this source package")
            scene["state"]["overlay"] = display["overlay"]
        if display["image_context"] is not None:
            if manifest.representation == "label-model" and display["image_context"]:
                raise ValueError("A categorical model without original MRI cannot display MRI intensity context")
            scene["state"]["imageContext"] = display["image_context"]
        if display["show_3d_cursor"] is not None:
            scene["state"]["show3DCursor"] = display["show_3d_cursor"]
        if display["window"] is not None:
            if manifest.representation == "label-model":
                raise ValueError("Image intensity contrast is unavailable for categorical source labels")
            scene["state"]["window"] = list(display["window"])
        if display["label_opacity"] is not None:
            scene["state"]["labelOpacity"] = display["label_opacity"]
        if display["slice_zoom"] is not None or step["source_voxel"] is not None or regional is not None:
            zoom = display["slice_zoom"] or scene["state"]["pan"][3]
            center = [row[3] + sum(row[i] * (size - 1) / 2 for i, size in enumerate(image.shape)) for row in image.affine_ras_mm[:3]]
            scene["state"]["pan"] = [0, 0, 0, 1] if zoom == 1 else [value - zoom * target_position[i] for i, value in enumerate(center)] + [zoom]
        if any(ident not in source for ident in display["surface_opacity"]):
            raise ValueError("A teaching surface opacity refers to an unknown source structure")
        cutaway = display["surface_cutaway"]
        if cutaway is not None:
            if manifest.representation == "mri-streamlines" or any(ident not in source for ident in cutaway["structures"]):
                raise ValueError("Cutaway references unavailable source surfaces")
            scene["state"]["surfaceCutaway"] = cutaway
        scene["state"].update(surfaceOpacity=display["surface_opacity"], sectionPlanes=display["section_planes"],
                              layout=display["layout"], radiological=display["radiological"])
        if display["tile_layout"] is not None:
            scene["state"]["tileLayout"] = display["tile_layout"]
        if manifest.representation == "mri-streamlines":
            scene["state"].update(streamlineLevel=display["streamline_level"] or "standard", streamlineSlabMm=display["streamline_slab_mm"] or 1)
        elif display["streamline_level"] is not None or display["streamline_slab_mm"] is not None:
            raise ValueError("Streamline display settings require a streamline package")
        if display["camera"] is not None:
            scene["state"]["camera"] = list(display["camera"])
        if display["center_on_target"] is True:
            scene["state"]["focus3D"] = target_position
        elif display["center_on_target"] is False:
            scene["state"].pop("focus3D", None)
        if display["focus_selected_3d"]:
            if selected is None:
                raise ValueError("Selected structure framing requires a source structure")
            low, high = selected.bounds_ras_mm
            span = max(*(upper - lower for lower, upper in zip(low, high)), 1)
            field = max(size * spacing for size, spacing in zip(image.shape, image.voxel_size_mm))
            scene["state"]["focus3D"] = [(lower + upper) / 2 for lower, upper in zip(low, high)]
            scene["state"]["camera"][2] = max(.8, min(12, .8 * field / span))
        if len(step["title"]) > 120 or len(step["prompt"]) > 2000 or len(notes) > 10000:
            raise ValueError("Teaching text exceeds the portable notebook limits")
        entries.append({"id": str(uuid.uuid5(uuid.NAMESPACE_URL, signature + step["id"])), "title": step["title"], "prompt": step["prompt"], "captured_utc": scene["saved_utc"], "scene": scene})
    notebook = {"schema_version": "1.0", "kind": "neuroimage-teaching-notebook", "id": str(uuid.uuid5(uuid.NAMESPACE_URL, signature)),
        "title": recipe["title"], "author": recipe["author"], "objective": recipe["objective"], "package_id": manifest.package_id,
        "package_version": manifest.package_version, "build_signature": manifest.build["signature"], "space_id": manifest.space.id,
        "review_status": "user-authored-unreviewed", "scenes": entries}
    if manifest.representation == "surface-model":
        from .build import utc_now
        notebook.update(created_utc=utc_now(), updated_utc=utc_now())
    if len(json.dumps(notebook).encode()) > 10 * 1024 ** 2:
        raise ValueError("Notebook exceeds the portable size limit")
    root.mkdir(parents=True, exist_ok=True)
    atomic_json(target, notebook)
    atomic_json(root / "recipe.json", recipe)
    atomic_json(receipt_path, {"signature": signature, "notebook_sha256": sha256(target), "package_version": manifest.package_version,
        "preparation_inputs": inputs,
        "scenes": len(entries), "regional_annotations": sum(step.get("image_anchor") is not None for step in steps),
        "source_model_annotations": len(annotations),
        "method": "Prepared from original source mesh targets in native XYZ millimeters" if manifest.representation == "surface-model" else "Prepared from explicitly recorded source image voxels and contextual structure targets; regional annotations record teaching locations" if any(step.get("image_anchor") for step in steps) else "Prepared from exact retained source trajectory vertices; render and inspect before teaching" if manifest.representation == "mri-streamlines" else "Prepared from actual source-labelled target voxels; render and inspect before teaching", "review_status": "not_performed"})
    return {"status": "prepared", "notebook": str(target), "directory": str(root), "scenes": len(entries)}

