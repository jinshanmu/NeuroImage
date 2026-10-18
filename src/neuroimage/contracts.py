"""Portable package contracts shared by all native-space dataset adapters."""
from typing import Literal
from pathlib import PurePosixPath
import math
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


def safe_relative(value: str) -> str:
    path = PurePosixPath(value)
    if not value or path.is_absolute() or ".." in path.parts or "\\" in value or ":" in value or str(path) != value:
        raise ValueError("Expected a normalized relative package path")
    return value


class Asset(Record):
    path: str
    role: Literal["image", "scalar", "source-volume", "labels", "mask", "probability", "mesh", "streamlines", "streamline-index", "source-geometry", "license", "lessons", "validation"]
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    _path = field_validator("path")(safe_relative)


class Source(Record):
    id: str
    title: str
    version: str
    url: str
    citation: str
    license_name: str
    license_url: str
    license_file: str
    _path = field_validator("license_file")(safe_relative)


class Space(Record):
    id: str
    name: str
    coordinate_system: Literal["RAS"] = "RAS"
    units: Literal["mm"] = "mm"
    reference: str
    correspondence: str


class ModelSpace(Record):
    id: str
    name: str
    coordinate_system: Literal["SOURCE_XYZ"]
    units: Literal["mm"] = "mm"
    reference: str
    correspondence: str
    axis_status: Literal["source_axes_not_anatomically_verified"]
    unit_basis: str


class ModelGeometry(Record):
    source_input: str
    source_object: str
    source_type: Literal["MESH", "CURVE", "OBJ"]
    source_geometry_file: str
    provenance_file: str
    vertex_count: int = Field(ge=3)
    triangle_count: int = Field(ge=1)
    target_vertex_index: int = Field(ge=0)
    transform_to_native_mm: list[list[float]]
    method: str
    source_stage: Literal["base", "author-viewport"] = "base"
    _geometry_path = field_validator("source_geometry_file", "provenance_file")(safe_relative)

    @model_validator(mode="after")
    def finite_transform(self):
        matrix = self.transform_to_native_mm
        if len(matrix) != 4 or any(len(row) != 4 for row in matrix) or matrix[3] != [0, 0, 0, 1]:
            raise ValueError("A model requires its explicit affine source-to-native unit transform")
        if not all(math.isfinite(value) for row in matrix for value in row) or self.target_vertex_index >= self.vertex_count:
            raise ValueError("Invalid model transform or retained source vertex")
        return self


class ModelSurface(Record):
    kind: Literal["model-surface"]
    id: str
    name: str
    source_name: str
    category: str
    laterality: Literal["left", "right", "midline", "unspecified"]
    color: tuple[int, int, int]
    mesh_file: str
    center_native_mm: tuple[float, float, float]
    target_native_mm: tuple[float, float, float]
    bounds_native_mm: tuple[tuple[float, float, float], tuple[float, float, float]]
    evidence: str
    source_notes: list[str] = []
    geometry: ModelGeometry
    review_status: Literal["not_reviewed"] = "not_reviewed"
    _path = field_validator("mesh_file")(safe_relative)

    @field_validator("color")
    @classmethod
    def valid_color(cls, value):
        if any(v < 0 or v > 255 for v in value):
            raise ValueError("Invalid RGB color")
        return value


class ScalarEvidence(Record):
    source_input: str
    metric: str = Field(min_length=1)
    units: str = Field(min_length=1)
    statistic: str = Field(min_length=1)
    interpretation: str = Field(min_length=1)
    derivation: str = Field(min_length=1)
    reference: str = Field(min_length=1)
    valid_range: tuple[float, float] | None = None


class NativeFrame(Record):
    source_input: str
    source_file: str
    source_shape: tuple[int, int, int, int]
    frame: int = Field(ge=0)
    extraction: Literal["exact-native-frame-no-interpolation"]
    _path = field_validator("source_file")(safe_relative)

    @model_validator(mode="after")
    def valid_frame(self):
        if any(n < 1 for n in self.source_shape) or self.frame >= self.source_shape[3]:
            raise ValueError("Native frame is outside the original source series")
        return self


class ImageEvidence(Record):
    modality: Literal["MRI", "CT"]
    source_input: str = Field(min_length=1)
    source_dataset: str = Field(min_length=1)
    intensity_units: str = Field(min_length=1)
    calibration: str = Field(min_length=1)
    acquisition: str = Field(min_length=1)
    sampling: str = Field(min_length=1)


class Volume(Record):
    id: str
    name: str
    kind: Literal["image", "scalar", "labels", "mask", "probability"]
    scalar: ScalarEvidence | None = None
    image_evidence: ImageEvidence | None = None
    native_frame: NativeFrame | None = None
    file: str
    shape: tuple[int, int, int]
    affine_ras_mm: list[list[float]]
    voxel_size_mm: tuple[float, float, float]
    orientation: str
    cal_min: float
    cal_max: float
    _path = field_validator("file")(safe_relative)

    @model_validator(mode="after")
    def geometry(self):
        if any(n <= 0 for n in self.shape) or any(v <= 0 for v in self.voxel_size_mm):
            raise ValueError("Invalid volume dimensions or spacing")
        a = self.affine_ras_mm
        if len(a) != 4 or any(len(row) != 4 for row in a) or a[3] != [0, 0, 0, 1]:
            raise ValueError("Expected a 4 by 4 voxel-to-RAS affine")
        if not all(math.isfinite(v) for row in a for v in row):
            raise ValueError("Nonfinite affine")
        if self.cal_max <= self.cal_min:
            raise ValueError("Invalid display range")
        if (self.kind == "scalar") != (self.scalar is not None):
            raise ValueError("Scalar fields require explicit metric, units and source interpretation")
        if self.scalar and self.scalar.valid_range and self.scalar.valid_range[0] >= self.scalar.valid_range[1]:
            raise ValueError("Scalar valid range must increase")
        if self.native_frame and (self.kind != "image" or self.shape != self.native_frame.source_shape[:3]):
            raise ValueError("A native frame must retain the source series spatial shape")
        if self.image_evidence and self.kind != "image":
            raise ValueError("Image modality and acquisition evidence require a measured image volume")
        return self


class ProbabilityEvidence(Record):
    volume_id: str
    source_input: str
    source_channel: int | None = Field(default=None, ge=0)
    interpretation: str
    derivation: str
    units: Literal["fraction", "percent"] = "fraction"

    @property
    def maximum(self):
        return 100 if self.units == "percent" else 1


class RegionGeometry(Record):
    id: str
    name: str
    source_name: str
    category: str
    laterality: Literal["left", "right", "midline", "unspecified"]
    color: tuple[int, int, int]
    mesh_file: str
    voxel_count: int = Field(gt=0)
    volume_mm3: float = Field(gt=0)
    center_ras_mm: tuple[float, float, float]
    target_ras_mm: tuple[float, float, float]
    bounds_ras_mm: tuple[tuple[float, float, float], tuple[float, float, float]]
    evidence: str
    source_notes: list[str] = []
    review_status: Literal["not_reviewed"] = "not_reviewed"
    _path = field_validator("mesh_file")(safe_relative)

    @field_validator("color")
    @classmethod
    def valid_color(cls, value):
        if any(v < 0 or v > 255 for v in value):
            raise ValueError("Invalid RGB color")
        return value


class Structure(RegionGeometry):
    label_value: int = Field(gt=0, le=65535)
    probability: ProbabilityEvidence | None = None


class MaskEvidence(Record):
    volume_id: str
    source_input: str
    threshold: float = Field(gt=0, le=100)
    threshold_operator: Literal[">="]
    derivation: str
    origin: Literal["source", "derived-from-probability"] = "source"


class IndependentRegion(RegionGeometry):
    kind: Literal["independent-region"]
    mask: MaskEvidence
    probability: ProbabilityEvidence


class StreamlineLevel(Record):
    id: Literal["preview", "standard", "detail", "full"]
    file: str
    indices_file: str | None = None
    streamline_count: int = Field(gt=0)
    point_count: int = Field(gt=1)
    _path = field_validator("file")(safe_relative)

    @field_validator("indices_file")
    @classmethod
    def indices_path(cls, value):
        return safe_relative(value) if value is not None else None


class StreamlineEvidence(Record):
    source_input: str
    coordinate_system: Literal["RAS"] = "RAS"
    units: Literal["mm"] = "mm"
    source_streamline_count: int = Field(gt=0)
    source_point_count: int = Field(gt=1)
    decoded_ras_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    target_streamline_index: int = Field(ge=0)
    target_point_index: int = Field(ge=0)
    sampling: Literal["uniform-source-index-whole-streamlines"]
    levels: list[StreamlineLevel]

    @model_validator(mode="after")
    def levels_consistent(self):
        ids = [level.id for level in self.levels]
        if len(ids) != 4 or set(ids) != {"preview", "standard", "detail", "full"}:
            raise ValueError("Streamlines require preview, standard, detail and complete source levels")
        full = next(level for level in self.levels if level.id == "full")
        if (full.indices_file is not None or full.streamline_count != self.source_streamline_count
                or full.point_count != self.source_point_count or self.target_streamline_index >= self.source_streamline_count):
            raise ValueError("Complete streamline level must retain every source streamline and point")
        for level in self.levels:
            if (level.streamline_count > full.streamline_count or level.point_count > full.point_count
                    or (level.id != "full" and level.indices_file is None)):
                raise ValueError("Display subsets require explicit original streamline indices")
        return self


class StreamlineStructure(Record):
    kind: Literal["streamline-bundle"]
    id: str
    name: str
    source_name: str
    category: str
    laterality: Literal["left", "right", "midline", "unspecified"]
    color: tuple[int, int, int]
    center_ras_mm: tuple[float, float, float]
    target_ras_mm: tuple[float, float, float]
    bounds_ras_mm: tuple[tuple[float, float, float], tuple[float, float, float]]
    evidence: str
    source_notes: list[str] = []
    streamlines: StreamlineEvidence
    review_status: Literal["not_reviewed"] = "not_reviewed"
    _color = field_validator("color")(Structure.valid_color.__func__)

    @property
    def probability(self):
        return None


class Manifest(Record):
    schema_version: Literal["1.0", "1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10"] = "1.2"
    representation: Literal["mri-labels", "ct-labels", "label-model", "mri-streamlines", "mri-regions", "mri-volume", "surface-model", "scalar-fields"] = "mri-labels"
    package_id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]*$")
    dataset_id: str
    title: str
    package_version: str
    space: Space | ModelSpace
    sources: list[Source] = Field(min_length=1)
    volumes: list[Volume]
    structures: list[Structure | StreamlineStructure | IndependentRegion | ModelSurface]
    assets: list[Asset] = Field(min_length=1)
    lessons_file: str
    build: dict
    validation: dict
    _path = field_validator("lessons_file")(safe_relative)

    @model_validator(mode="after")
    def references(self):
        def unique(values, what):
            if len(values) != len(set(values)):
                raise ValueError(f"Duplicate {what}")
        unique([s.id for s in self.structures], "structure IDs")
        regions = [s for s in self.structures if isinstance(s, Structure)]
        bundles = [s for s in self.structures if isinstance(s, StreamlineStructure)]
        independent = [s for s in self.structures if isinstance(s, IndependentRegion)]
        models = [s for s in self.structures if isinstance(s, ModelSurface)]
        unique([s.label_value for s in regions], "label values")
        unique([v.id for v in self.volumes], "volume IDs")
        unique([a.path for a in self.assets], "asset paths")
        paths = {a.path: a.role for a in self.assets}
        required = [(v.file, v.kind) for v in self.volumes]
        required += [(v.native_frame.source_file, "source-volume") for v in self.volumes if v.native_frame]
        required += [(s.mesh_file, "mesh") for s in [*regions, *independent]]
        required += [(s.mesh_file, "mesh") for s in models]
        required += [(path, "source-geometry") for s in models for path in (s.geometry.source_geometry_file, s.geometry.provenance_file)]
        required += [(level.file, "streamlines") for s in bundles for level in s.streamlines.levels]
        required += [(level.indices_file, "streamline-index") for s in bundles for level in s.streamlines.levels if level.indices_file]
        required += [(s.license_file, "license") for s in self.sources]
        required += [(self.lessons_file, "lessons")]
        if any(paths.get(path) != role for path, role in required):
            raise ValueError("Missing asset or incorrect asset role")
        if self.representation == "surface-model":
            if (self.schema_version != "1.7" or not isinstance(self.space, ModelSpace) or self.volumes
                    or not models or len(models) != len(self.structures)):
                raise ValueError("Independent surface models require schema 1.7, native source XYZ and no image volume")
            if any(asset.role not in {"mesh", "source-geometry", "license", "lessons", "validation"} for asset in self.assets):
                raise ValueError("A source model cannot imply image-derived anatomy or a synthetic reference scan")
            return self
        if models or isinstance(self.space, ModelSpace) or not self.volumes:
            raise ValueError("Image representations require RAS volumes and cannot contain independent model coordinates")
        if self.representation != "ct-labels" and (self.schema_version == "1.10" or any(v.image_evidence and v.image_evidence.modality == "CT" for v in self.volumes)):
            raise ValueError("CT image evidence requires the explicit CT-labels representation and schema 1.10")
        if self.representation == "scalar-fields":
            if self.schema_version != "1.8" or self.structures or any(v.kind != "scalar" for v in self.volumes):
                raise ValueError("Scalar packages require schema 1.8 and explicit fields without invented MRI or structures")
            reference = self.volumes[0]
            if any(v.shape != reference.shape or v.affine_ras_mm != reference.affine_ras_mm for v in self.volumes):
                raise ValueError("Scalar fields in one native package must share the exact declared grid")
            if any(a.role not in {"scalar", "license", "lessons", "validation"} for a in self.assets):
                raise ValueError("Scalar fields cannot imply anatomical derivatives or reference MRI")
            return self
        if any(v.kind == "scalar" for v in self.volumes):
            raise ValueError("Scalar evidence requires a declared scalar-fields representation")
        if self.representation == "mri-volume":
            if self.schema_version not in ("1.6", "1.9") or self.structures or len(self.volumes) != 1 or self.volumes[0].kind != "image":
                raise ValueError("An image-only package requires one native image and no invented structures")
            if (self.schema_version == "1.9") != (self.volumes[0].native_frame is not None):
                raise ValueError("Schema 1.9 requires an explicit original source frame")
            if any(asset.role in {"labels", "mask", "probability", "mesh", "streamlines", "streamline-index"} for asset in self.assets):
                raise ValueError("An image-only package cannot contain undeclared anatomical derivatives")
            return self
        if any(v.native_frame for v in self.volumes):
            raise ValueError("Exact source frame evidence requires an image-only package")
        if not self.structures:
            raise ValueError("This anatomical representation requires source structures")
        if self.representation == "mri-regions":
            if self.schema_version not in ("1.4", "1.5") or regions or bundles or not independent:
                raise ValueError("Independent regions require schema 1.4 or 1.5 and cannot use exclusive categorical labels")
            images = [v for v in self.volumes if v.kind == "image"]
            masks = {v.id: v for v in self.volumes if v.kind == "mask"}
            probabilities = {v.id: v for v in self.volumes if v.kind == "probability"}
            if not images or any(v.kind == "labels" for v in self.volumes):
                raise ValueError("Independent regions require source MRI context and independent mask volumes")
            if any(s.probability.source_channel is not None for s in independent):
                raise ValueError("Independent regions preserve scalar 3D probability inputs")
            for structure in independent:
                if structure.mask.threshold > structure.probability.maximum:
                    raise ValueError("Mask threshold exceeds the declared probability units")
                if self.schema_version == "1.4" and (structure.probability.units != "fraction" or structure.mask.origin != "source"):
                    raise ValueError("Explicit percent units and derived display masks require schema 1.5")
                if structure.mask.origin == "derived-from-probability" and structure.mask.source_input != structure.probability.source_input:
                    raise ValueError("A derived mask must identify its original probability input")
            for role, volumes in (("mask", masks), ("probability", probabilities)):
                referenced = [getattr(s, role).volume_id for s in independent]
                unique(referenced, role + " references")
                if set(referenced) != set(volumes):
                    raise ValueError(f"Each {role} volume must identify exactly one independent region")
                for volume in volumes.values():
                    maximum = next(s.probability.maximum for s in independent if s.probability.volume_id == volume.id) if role == "probability" else 1
                    if (volume.shape != images[0].shape or volume.affine_ras_mm != images[0].affine_ras_mm
                            or (volume.cal_min, volume.cal_max) != (0, maximum)):
                        raise ValueError("Independent masks and probabilities must retain the reference grid and declared value scale")
            return self
        if independent or any(v.kind == "mask" for v in self.volumes):
            raise ValueError("Independent masks require a declared independent-region representation")
        if self.representation == "mri-streamlines":
            if (self.schema_version != "1.3" or regions or not bundles
                    or any(v.kind != "image" for v in self.volumes)):
                raise ValueError("Streamline packages require schema 1.3, image context and explicit overlapping bundles")
            return self
        if bundles:
            raise ValueError("Streamline bundles require a declared streamline representation")
        if len([v for v in self.volumes if v.kind == "labels"]) != 1:
            raise ValueError("One categorical label volume is required")
        images = [v for v in self.volumes if v.kind == "image"]
        if self.representation == "ct-labels":
            labels = next(v for v in self.volumes if v.kind == "labels")
            if (self.schema_version != "1.10" or not images
                    or any(v.kind not in ("image", "labels") for v in self.volumes)
                    or any(not v.image_evidence or v.image_evidence.modality != "CT" for v in images)
                    or any(v.shape != labels.shape or v.affine_ras_mm != labels.affine_ras_mm for v in images)):
                raise ValueError("CT-labels packages require schema 1.10, explicit CT evidence and one shared original image-label grid")
        if self.representation == "label-model":
            if self.schema_version == "1.0" or images:
                raise ValueError("A label-model requires schema 1.1 and contains no measured image volume")
        elif not images:
            raise ValueError("An image volume is required for an image-labels package")
        probabilities = {v.id: v for v in self.volumes if v.kind == "probability"}
        referenced = [s.probability.volume_id for s in self.structures if s.probability]
        if probabilities or referenced:
            if self.schema_version != "1.2" or self.representation != "mri-labels":
                raise ValueError("Probability evidence requires an MRI-labels package with schema 1.2")
            if any(s.probability and s.probability.source_channel is None for s in regions):
                raise ValueError("Schema 1.2 probability evidence requires an explicit source channel")
            if any(s.probability and s.probability.units != "fraction" for s in regions):
                raise ValueError("Schema 1.2 probability evidence requires fraction units")
            unique(referenced, "probability references")
            if set(referenced) != set(probabilities):
                raise ValueError("Each probability volume must identify exactly one structure")
            labels = next(v for v in self.volumes if v.kind == "labels")
            for volume in probabilities.values():
                if volume.shape != labels.shape or volume.affine_ras_mm != labels.affine_ras_mm or (volume.cal_min, volume.cal_max) != (0, 1):
                    raise ValueError("Probability evidence must preserve the categorical label grid and the 0 to 1 display scale")
        return self
