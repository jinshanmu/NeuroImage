import { unProject } from '@niivue/niivue/utils'
import type { Vec3 } from './types'

/** Intersect the clicked view ray with the camera-parallel plane at the cursor. */
export function cursorPlanePoint(fx: number, fy: number, anchor: ArrayLike<number>, matrix: Parameters<typeof unProject>[3]): Vec3 | null {
  if (![fx, fy, ...Array.from(anchor).slice(0, 3), ...Array.from(matrix)].every(Number.isFinite)) return null
  const z = matrix[2] * anchor[0] + matrix[6] * anchor[1] + matrix[10] * anchor[2] + matrix[14]
  const w = matrix[3] * anchor[0] + matrix[7] * anchor[1] + matrix[11] * anchor[2] + matrix[15]
  if (Math.abs(w) < 1e-12) return null
  const point = Array.from(unProject(fx, fy, (z / w + 1) / 2, matrix)).slice(0, 3) as Vec3
  return point.every(Number.isFinite) ? point : null
}
