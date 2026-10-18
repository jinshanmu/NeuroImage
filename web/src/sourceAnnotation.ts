import type { ModelAnnotation, NativeSourceAnnotation, SurfaceManifest } from './modelTypes'
import type { Vec3 } from './types'

const point = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n))
const matrix = (value: unknown): value is number[][] => Array.isArray(value) && value.length === 4 && value.every(row => Array.isArray(row) && row.length === 4 && row.every(n => typeof n === 'number' && Number.isFinite(n))) && JSON.stringify(value[3]) === '[0,0,0,1]'
const samePoint = (a: Vec3, b: Vec3, tolerance = 1e-9) => a.every((n, axis) => Math.abs(n - b[axis]) <= tolerance)

/** Keep imported source annotations tied to their native model and recorded affine. */
export function validSourceAnnotation(value: unknown, manifest: SurfaceManifest, marker: ModelAnnotation): value is NativeSourceAnnotation {
  try {
    if (!value || typeof value !== 'object') return false
    const record = value as NativeSourceAnnotation, spec = record.spec
    const context = manifest.structures.find(item => item.id === marker.structure_id)
    const inputs = manifest.build.inputs
    const recipe = manifest.build.recipe as {adapter?: unknown; mesh_geometry_stage?: unknown} | undefined
    if (!context || !spec || !Array.isArray(inputs) || !inputs.some(input => input.id === spec.source_input && input.sha256 === record.source_sha256)) return false
    if (recipe?.adapter !== 'blender-source-surfaces' || recipe.mesh_geometry_stage !== 'author-viewport'
      || context.geometry.source_type !== 'MESH' || context.geometry.source_stage !== 'author-viewport') return false
    if (spec.mapping !== 'blender-hooked-label-tip-v1' || spec.source_vertex_index !== 1 || spec.context_structure_id !== context.id
      || spec.source_input !== context.geometry.source_input || record.context_object !== context.geometry.source_object
      || typeof spec.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(spec.id)
      || typeof spec.source_object !== 'string' || !spec.source_object || spec.source_object.length > 200
      || typeof spec.reference !== 'string' || !spec.reference || spec.reference.length > 2000
      || !/^[a-f0-9]{64}$/.test(record.signature) || record.coordinate_system !== 'SOURCE_XYZ' || record.units !== 'mm'
      || record.source_stage !== 'author-viewport' || record.embedded_script_execution !== false || record.polygon_count !== 0
      || JSON.stringify(record.edge_indices) !== '[[0,1]]' || JSON.stringify(record.hook_vertex_indices) !== '[1]') return false
    if (!matrix(record.transform_to_native_mm) || !matrix(record.context_transform_to_native_mm)
      || !Array.isArray(record.source_vertices) || record.source_vertices.length !== 2 || !record.source_vertices.every(point)
      || !Array.isArray(record.points_native_mm) || record.points_native_mm.length !== 2 || !record.points_native_mm.every(point)
      || !point(record.position_native_mm) || !point(marker.position_native_mm)) return false
    if (!record.context_transform_to_native_mm.every((row, i) => row.every((n, j) => Math.abs(n - context.geometry.transform_to_native_mm[i][j]) <= 1e-6))) return false
    const m = record.transform_to_native_mm
    const determinant = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    if (Math.abs(determinant) < 1e-12) return false
    return record.source_vertices.every((p, index) => samePoint(record.points_native_mm[index], [0, 1, 2].map(axis => m[axis][3] + p.reduce((sum, n, j) => sum + n * m[axis][j], 0)) as Vec3))
      && samePoint(record.position_native_mm, record.points_native_mm[1]) && samePoint(marker.position_native_mm, record.position_native_mm)
  } catch { return false }
}
