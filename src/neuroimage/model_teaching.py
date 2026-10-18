"""Prepare native surface-model teaching through the shared notebook workflow."""
from typing import Literal
import json
import uuid

from pydantic import Field, field_validator, model_validator

from .build import utc_now
from .provenance import processing_record
from .teaching import TeachingRecipe, TeachingRecord, TeachingSurfaceCutaway


class ModelTeachingDisplay(TeachingRecord):
    camera: tuple[float, float, float] = (110.0, 15.0, 0.65)
    center_on_target: bool = False
    opacity: float = Field(default=1.0, ge=0, le=1)
    surface_opacity: dict[str, float] = {}
    surface_cutaway: TeachingSurfaceCutaway | None = None
    highlight_selected: bool = True
    show_markers: bool = False

    @model_validator(mode="after")
    def bounded_display(self):
        if not 0.1 <= self.camera[2] <= 20:
            raise ValueError("Model camera zoom must be between 0.1 and 20")
        if any(not 0 <= value <= 1 for value in self.surface_opacity.values()):
            raise ValueError("Model surface opacity must be between 0 and 1")
        return self


class ModelSourceAnnotation(TeachingRecord):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,80}$")
    mapping: Literal["blender-hooked-label-tip-v1"]
    source_input: str = Field(min_length=1, max_length=100)
    source_object: str = Field(min_length=1, max_length=200)
    source_vertex_index: Literal[1] = 1
    context_structure_id: str = Field(min_length=1, max_length=200)
    reference: str = Field(min_length=1, max_length=2000)

    @field_validator("source_vertex_index", mode="before")
    @classmethod
    def integer_vertex(cls, value):
        if type(value) is not int:
            raise ValueError("Source annotation vertex index must be an integer")
        return value


class ModelTeachingStep(TeachingRecord):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,60}$")
    title: str = Field(min_length=1, max_length=120)
    selected: str = Field(min_length=1)
    visible: list[str] = Field(min_length=1)
    prompt: str = Field(max_length=2000)
    note: str = Field(max_length=8000)
    display: ModelTeachingDisplay = Field(default_factory=ModelTeachingDisplay)
    source_annotation: ModelSourceAnnotation | None = None

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, value):
        if not value.strip():
            raise ValueError("A model teaching view needs a title")
        return value

    @model_validator(mode="after")
    def selected_is_visible(self):
        if self.selected not in self.visible or len(set(self.visible)) != len(self.visible):
            raise ValueError("Model teaching requires one visible target and unique visible objects")
        if self.source_annotation and self.source_annotation.context_structure_id != self.selected:
            raise ValueError("Select the source annotation's original context model")
        return self


class ModelTeachingRecipe(TeachingRecipe):
    representation: Literal["surface-model"]
    scenes: list[ModelTeachingStep] = Field(min_length=1, max_length=50)


def model_curriculum_matches(recipe, manifest):
    if manifest.get("representation") != "surface-model" or manifest.get("volumes"):
        return False
    try:
        value = ModelTeachingRecipe.model_validate_json(json.dumps(recipe)).model_dump()
    except ValueError:
        return False
    ids = {item["id"] for item in manifest["structures"]}
    for step in value["scenes"]:
        display = step["display"]
        required = {step["selected"], *step["visible"], *display["surface_opacity"]}
        if display["surface_cutaway"]:
            required.update(display["surface_cutaway"]["structures"])
        if not required <= ids:
            return False
        if step["source_annotation"]:
            spec = step["source_annotation"]
            context = next(item for item in manifest["structures"] if item["id"] == step["selected"])
            model_recipe = manifest.get("build", {}).get("recipe", {})
            if (model_recipe.get("adapter") != "blender-source-surfaces" or model_recipe.get("mesh_geometry_stage") != "author-viewport"
                    or context["geometry"].get("source_stage") != "author-viewport"
                    or context["geometry"]["source_input"] != spec["source_input"] or context["geometry"]["source_type"] != "MESH"):
                return False
    return True


def model_teaching_entry(manifest, step, signature, source_annotation=None):
    """Keep source XYZ, source targets and authored geometry independent of images."""
    structures = {item.id: item for item in manifest.structures}
    if not model_curriculum_matches({"schema_version": "1.0", "representation": "surface-model",
            "id": "entry", "dataset_id": manifest.dataset_id,
            "required_source": {"id": manifest.sources[0].id, "version": manifest.sources[0].version},
            "title": "Entry", "author": "", "objective": "", "review_status": "draft_not_expert_reviewed",
            "scenes": [step]}, manifest.model_dump()):
        raise ValueError("The model teaching view requires unavailable source objects")
    selected, display = structures[step["selected"]], step["display"]
    if bool(step.get("source_annotation")) != bool(source_annotation):
        raise ValueError("A source annotation view requires its checked original annotation record")
    position = source_annotation["position_native_mm"] if source_annotation else selected.target_native_mm
    # Structure definitions remain in the bound manifest and image export.
    # Editable notes contain the instructor's observation task.
    notes = step["note"]
    if source_annotation:
        notes += "\n\nOriginal source annotation: " + source_annotation["spec"]["source_object"]
        notes += "; indicated endpoint 1; context: " + source_annotation["context_object"] + "."
        notes += "\n" + source_annotation["spec"]["reference"]
    if len(notes) > 10000:
        raise ValueError("Model teaching notes exceed the portable size limit")
    now = utc_now()
    binding = {"package_id": manifest.package_id, "package_version": manifest.package_version,
               "build_signature": manifest.build["signature"], "space_id": manifest.space.id}
    state = {"kind": "source-model-view", "coordinate_system": "SOURCE_XYZ", "selected": selected.id,
        "visible": step["visible"], "position_native_mm": position,
        "camera": list(display["camera"]),
        "focus_native_mm": position if display["center_on_target"] else None,
        "opacity": display["opacity"], "surfaceOpacity": display["surface_opacity"],
        "highlightSelected": display["highlight_selected"], "showMarkers": display["show_markers"],
        "annotations": [{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, signature + step["id"] + "marker")),
            "text": "Source annotation: " + source_annotation["spec"]["source_object"].removesuffix(".j") if source_annotation else "Source mesh reference vertex for " + selected.name,
            "position_native_mm": position, "structure_id": selected.id}],
        "note": notes, "lesson_id": None, "lesson_step": 0, "lesson_answer": "", "lesson_revealed": False}
    if display["surface_cutaway"] is not None:
        state["surfaceCutaway"] = display["surface_cutaway"]
    if source_annotation:
        state["annotations"][0]["source_annotation"] = source_annotation
    scene = {"schema_version": "1.0", "kind": "neuroimage-scene", "title": step["title"], "saved_utc": now,
        **binding, "state": state, "provenance": {"sources": [s.model_dump() for s in manifest.sources],
            "processing": processing_record(manifest.build), "anatomical_review": manifest.validation["anatomical_review"],
            "representation": "surface-model", "preparation": "Original source mesh target in native XYZ millimeters"}}
    if source_annotation:
        scene["provenance"].update(source_annotations=[source_annotation],
            preparation="Original author annotation endpoint in the unchanged native model space")
    return {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, signature + step["id"])), "title": step["title"],
            "prompt": step["prompt"], "captured_utc": now, "scene": scene}
