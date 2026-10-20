import type { Source, SurfaceContext, SurfaceCutaway, Vec3 } from './types'

export interface ModelSurface {
  kind: 'model-surface'; id: string; name: string; source_name: string; category: string;
  laterality: 'left' | 'right' | 'midline' | 'unspecified'; color: Vec3; mesh_file: string;
  center_native_mm: Vec3; target_native_mm: Vec3; bounds_native_mm: [Vec3, Vec3];
  evidence: string; source_notes: string[]; review_status: string;
  geometry: { source_input: string; source_object: string; source_type: 'MESH' | 'CURVE' | 'OBJ';
    source_stage?: 'base' | 'author-viewport';
    source_geometry_file: string; provenance_file: string; vertex_count: number; triangle_count: number;
    target_vertex_index: number; transform_to_native_mm: number[][]; method: string };
}
export interface SurfaceManifest {
  schema_version: '1.7'; representation: 'surface-model'; package_id: string; dataset_id: string;
  title: string; package_version: string;
  space: { id: string; name: string; coordinate_system: 'SOURCE_XYZ'; units: 'mm'; reference: string;
    correspondence: string; axis_status: 'source_axes_not_anatomically_verified'; unit_basis: string };
  volumes: []; structures: ModelSurface[]; sources: Source[];
  assets: {path: string; role: string; bytes: number; sha256: string}[];
  lessons_file: string; build: { signature: string; software_version: string; [key: string]: unknown };
  validation: { engineering_status: string; anatomical_review: string; warnings: string[] };
}
export interface NativeSourceAnnotation {
  signature: string; source_sha256: string; coordinate_system: 'SOURCE_XYZ'; units: 'mm'; source_stage: 'author-viewport';
  spec: {id: string; mapping: 'blender-hooked-label-tip-v1'; source_input: string; source_object: string;
    source_vertex_index: 1; context_structure_id: string; reference: string};
  embedded_script_execution: false; context_object: string; context_transform_to_native_mm: number[][];
  source_vertices: Vec3[]; transform_to_native_mm: number[][]; points_native_mm: Vec3[];
  position_native_mm: Vec3; edge_indices: number[][]; polygon_count: 0; hook_vertex_indices: number[];
  method: string; [key: string]: unknown;
}
export interface ModelAnnotation { id: string; text: string; position_native_mm: Vec3; structure_id: string | null; source_annotation?: NativeSourceAnnotation }
export interface ModelView {
  kind: 'source-model-view'; coordinate_system: 'SOURCE_XYZ'; selected: string | null; visible: string[];
  position_native_mm: Vec3; camera: Vec3; focus_native_mm: Vec3 | null; opacity: number;
  surfaceOpacity: Record<string, number>; surfaceCutaway?: SurfaceCutaway;
  surfaceContext?: SurfaceContext;
  highlightSelected?: boolean;
  annotations: ModelAnnotation[]; showMarkers: boolean; note: string;
}
export interface ModelScene {
  schema_version: '1.0'; kind: 'neuroimage-scene'; title: string; saved_utc: string;
  package_id: string; package_version: string; build_signature: string; space_id: string;
  state: ModelView; provenance: { sources: Source[]; processing: SurfaceManifest['build'];
    anatomical_review: string; renderer: typeof __NEUROIMAGE_VIEWER__; representation: 'surface-model'; source_annotations?: NativeSourceAnnotation[] };
}
