import type { Vec3, Volume } from './types'

export type SectionPlane = 'axial' | 'coronal' | 'sagittal'
export const SECTION_PLANES: SectionPlane[] = ['axial', 'coronal', 'sagittal']
export const PLANE_COLORS: Record<SectionPlane, Vec3> = { axial: [.92, .68, .3], coronal: [.35, .75, .95], sagittal: [.85, .46, .78] }
const NORMAL_AXIS: Record<SectionPlane, number> = { axial: 2, coronal: 1, sagittal: 0 }
const EPSILON_MM = 1e-7

/** Intersect a RAS section with the actual affine-transformed voxel field of view.
 *  These polygons are display guides; no tissue or image samples are generated.
 */
export function sectionPolygon(volume: Pick<Volume, 'shape' | 'affine_ras_mm'>, position: Vec3, plane: SectionPlane): Vec3[] {
  const axis = NORMAL_AXIS[plane], offset = position[axis], affine = volume.affine_ras_mm
  const corners: Vec3[] = Array.from({ length: 8 }, (_, index) => {
    const voxel = volume.shape.map((size, dimension) => ((index >> dimension) & 1) ? size - .5 : -.5)
    return [0, 1, 2].map(row => affine[row][3] + voxel.reduce((sum, value, column) => sum + affine[row][column] * value, 0)) as Vec3
  })
  const polygon: Vec3[] = []
  const add = (point: Vec3) => {
    if (!polygon.some(other => Math.hypot(...other.map((value, i) => value - point[i])) < EPSILON_MM)) polygon.push(point)
  }
  for (let index = 0; index < 8; index++) {
    for (let dimension = 0; dimension < 3; dimension++) {
      if ((index >> dimension) & 1) continue
      const a = corners[index], b = corners[index | (1 << dimension)]
      const da = a[axis] - offset, db = b[axis] - offset
      if (Math.abs(da) < EPSILON_MM) add([...a])
      if (Math.abs(db) < EPSILON_MM) add([...b])
      if ((da < -EPSILON_MM && db > EPSILON_MM) || (da > EPSILON_MM && db < -EPSILON_MM)) {
        const fraction = da / (da - db)
        add(a.map((value, i) => value + fraction * (b[i] - value)) as Vec3)
      }
    }
  }
  if (polygon.length < 3) return []
  const [u, v] = [0, 1, 2].filter(value => value !== axis)
  const center = [0, 1, 2].map(i => polygon.reduce((sum, point) => sum + point[i], 0) / polygon.length)
  polygon.sort((a, b) => Math.atan2(a[v] - center[v], a[u] - center[u]) - Math.atan2(b[v] - center[v], b[u] - center[u]))
  const area = Math.abs(polygon.reduce((sum, point, i) => {
    const next = polygon[(i + 1) % polygon.length]
    return sum + point[u] * next[v] - next[u] * point[v]
  }, 0)) / 2
  return area > EPSILON_MM ** 2 ? polygon : []
}
