import type { Vec3 } from './types'

/** Camera bounds follow drawn triangles; every original source vertex is retained. */
export function triangleBounds(points: ArrayLike<number>, triangles: ArrayLike<number>): [Vec3, Vec3] | null {
  if (!triangles.length) return null
  const low: Vec3 = [Infinity, Infinity, Infinity], high: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let index = 0; index < triangles.length; index++) {
    const vertex = triangles[index]
    if (!Number.isInteger(vertex) || vertex < 0 || vertex * 3 + 2 >= points.length) return null
    for (let axis = 0; axis < 3; axis++) {
      const value = points[vertex * 3 + axis]
      if (!Number.isFinite(value)) return null
      low[axis] = Math.min(low[axis], value); high[axis] = Math.max(high[axis], value)
    }
  }
  return [low, high]
}
