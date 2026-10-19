export type Vec3 = [number, number, number]
export interface Source { id: string; title: string; version: string; url: string; citation: string; license_name: string; license_url: string; license_file: string }
export interface ScalarEvidence { source_input: string; metric: string; units: string; statistic: string; interpretation: string; derivation: string; reference: string; valid_range?: [number, number] | null }
export interface ImageEvidence { modality: 'MRI' | 'CT'; source_input: string; source_dataset: string; intensity_units: string; calibration: string; acquisition: string; sampling: string }
export interface Volume { image_evidence?: ImageEvidence | null; scalar?: ScalarEvidence | null; native_frame?: { source_input: string; source_file: string; source_shape: [number,number,number,number]; frame: number; extraction: string } | null; id: string; name: string; kind: 'image' | 'scalar' | 'labels' | 'mask' | 'probability'; file: string; shape: Vec3; affine_ras_mm: number[][]; voxel_size_mm: Vec3; orientation: string; cal_min: number; cal_max: number }
export interface ProbabilityEvidence { volume_id: string; source_input: string; source_channel: number | null; interpretation: string; derivation: string; units?: 'fraction' | 'percent' }
interface RegionGeometry {
  streamlines?: never;
  id: string; name: string; source_name: string; category: string;
  laterality: string; color: Vec3; mesh_file: string; voxel_count: number; volume_mm3: number;
  center_ras_mm: Vec3; target_ras_mm: Vec3; bounds_ras_mm: [Vec3, Vec3];
  evidence: string; source_notes: string[]; review_status: string;
}
export interface RegionStructure extends RegionGeometry {
  kind?: 'region'; label_value: number; mask?: never; probability?: ProbabilityEvidence | null;
}
export interface IndependentRegion extends RegionGeometry {
  kind: 'independent-region'; label_value?: never;
  mask: { volume_id: string; source_input: string; threshold: number; threshold_operator: '>='; derivation: string; origin?: 'source' | 'derived-from-probability' };
  probability: ProbabilityEvidence;
}
export type StreamlineLevelId = 'preview' | 'standard' | 'detail'
export interface StreamlineLevel { id: StreamlineLevelId | 'full'; file: string; indices_file?: string | null; streamline_count: number; point_count: number }
export interface StreamlineStructure {
  kind: 'streamline-bundle'; id: string; name: string; source_name: string; category: string; laterality: string; color: Vec3;
  center_ras_mm: Vec3; target_ras_mm: Vec3; bounds_ras_mm: [Vec3, Vec3]; evidence: string; source_notes: string[]; review_status: string;
  probability?: never; mask?: never; label_value?: never; mesh_file?: never; voxel_count?: never; volume_mm3?: never;
  streamlines: { source_input: string; coordinate_system: 'RAS'; units: 'mm'; source_streamline_count: number; source_point_count: number;
    decoded_ras_sha256: string; target_streamline_index: number; target_point_index: number; sampling: 'uniform-source-index-whole-streamlines'; levels: StreamlineLevel[] }
}
export type Structure = RegionStructure | StreamlineStructure | IndependentRegion
export interface Manifest {
  schema_version: '1.0' | '1.1' | '1.2' | '1.3' | '1.4' | '1.5' | '1.6' | '1.8' | '1.9' | '1.10'; representation?: 'mri-labels' | 'ct-labels' | 'label-model' | 'mri-streamlines' | 'mri-regions' | 'mri-volume' | 'scalar-fields'; package_id: string; dataset_id: string; title: string; package_version: string;
  space: { id: string; name: string; coordinate_system: 'RAS'; units: 'mm'; reference: string; correspondence: string };
  sources: Source[]; volumes: Volume[]; structures: Structure[];
  assets: { path: string; role: string; bytes: number; sha256: string }[];
  lessons_file: string; build: { recipe?: { scope_notes?: string[]; [key: string]: unknown }; signature: string; software_version: string; parameters: object; inputs: object[]; [key: string]: unknown };
  validation: { engineering_status: string; anatomical_review: string; report: string; warnings: string[] };
}
export interface AnatomyEntry {
  source_id: string; source_version: string; volume_id: string; shape: Vec3; affine_ras_mm: number[][];
  index: Vec3; selected: string | null; visible: string[]; surface_opacity?: Record<string, number>; label: string; reference: string;
}
export interface AnatomyCoverage { id: string; title: string; evidence: string; parent_id?: string; kind?: string; structures?: number; structure_ids?: string[]; entry?: AnatomyEntry }
export interface AtlasEntry { representation?: string; created_utc?: string; coverage?: AnatomyCoverage[]; detail_coverage?: AnatomyCoverage[]; key: string; title: string; dataset_id: string; package_version: string; space: string; manifest_url: string; base_url: string; structures: number }
export interface Lesson { id: string; title: string; objective: string; instruction: string; structure_ids: string[]; review_status: string; steps: { structure_id: string; prompt: string; question: string; answer?: string }[]; sources: string[]; evidence_limit: string; references?: {title:string;url:string}[] }
export interface Annotation { id: string; text: string; position_ras_mm: Vec3; structure_id: string | null }
export interface SelectionEvidence { kind: 'source-target' | 'label-voxel' | 'independent-mask' | 'visible-surface' | 'visible-streamline' | 'probability-cursor' | 'teaching-marker' | 'image-cursor'; candidates: string[]; sectionAxis?: 0 | 1 | 2 }
export interface TeachingState { lesson_id: string; step: number; practice: boolean; answer: string; revealed: boolean }
export interface SurfaceCutaway {
  axis: 0 | 1 | 2;
  side: -1 | 1;
  position_mm: number;
  structures: string[];
}
export interface SurfaceContext { enabled: boolean; opacity: number; structure_ids: string[] }
export interface ViewState {
  selected: string | null; visible: string[]; position: Vec3; background: string;
  labelOpacity: number; meshOpacity: number; radiological: boolean; layout: 'quad' | 'anatomy' | 'axial' | 'coronal' | 'sagittal' | '3d';
  camera: [number, number, number]; pan: [number, number, number, number]; imageContext: boolean;
  background2D?: boolean;
  backgroundOpacity2D?: number;
  backgroundOpacity3D?: number;
  surfaceContext?: SurfaceContext;
  focus3D?: Vec3;
  fitVisible3D?: boolean;
  tileLayout?: 'auto' | 'grid' | 'row';
  window: [number, number]; annotations: Annotation[]; note: string;
  selectionEvidence?: SelectionEvidence;
  panel?: 'inspect' | 'learn' | 'sources';
  teaching?: TeachingState;
  overlay?: 'labels' | 'mask' | 'probability' | 'streamlines' | 'none';
  showMarkers?: boolean;
  show3DCursor?: boolean;
  surfaceOpacity?: Record<string, number>;
  surfaceCutaway?: SurfaceCutaway;
  sectionPlanes?: ('axial' | 'coronal' | 'sagittal')[];
  streamlineLevel?: StreamlineLevelId;
  streamlineSlabMm?: number;
}
export interface SceneFile {
  schema_version: '1.0'; kind: 'neuroimage-scene'; title: string; saved_utc: string;
  package_id: string; package_version: string; build_signature: string; space_id: string;
  state: ViewState; provenance: { sources: Source[]; processing: object; anatomical_review: string; renderer?: typeof __NEUROIMAGE_VIEWER__ };
}
