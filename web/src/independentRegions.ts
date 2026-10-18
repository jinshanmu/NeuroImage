import type { Vec3, Volume, ViewState } from './types'

export interface SparseMask { indices: Uint32Array; volume: Volume }

/** Preserve independent memberships in source voxel order, without dense copies. */
export function sparseMask(values: ArrayLike<number>, volume: Volume, expectedCount: number): SparseMask {
  if (values.length !== volume.shape.reduce((a, b) => a * b, 1)) throw new Error('Source mask dimensions disagree with the package.')
  const indices = new Uint32Array(expectedCount)
  let count = 0
  for (let index = 0; index < values.length; index++) {
    if (values[index] !== 0 && values[index] !== 1) throw new Error('Independent source masks must be binary.')
    if (values[index] === 1) indices[count++] = index
  }
  if (count !== expectedCount) throw new Error('Source mask membership count disagrees with the package.')
  return { indices, volume }
}

/** Solve the full affine in double precision, including oblique/sheared grids. */
export function sourceVoxel(position: Vec3, volume: Pick<Volume, 'affine_ras_mm'>): Vec3 {
  const a = volume.affine_ras_mm, b = position.map((value, i) => value - a[i][3])
  const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const columns = [0, 1, 2].map(j => a.slice(0, 3).map(row => row[j]))
  const cofactors = [cross(columns[1], columns[2]), cross(columns[2], columns[0]), cross(columns[0], columns[1])]
  const determinant = columns[0].reduce((sum, value, i) => sum + value * cofactors[0][i], 0)
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new Error('Source affine is not invertible.')
  return cofactors.map(row => row.reduce((sum, value, i) => sum + value * b[i], 0) / determinant) as Vec3
}

export function containsSourceVoxel(field: SparseMask, position: Vec3): boolean {
  const voxel = sourceVoxel(position, field.volume).map(Math.round), shape = field.volume.shape
  if (voxel.some((value, i) => value < 0 || value >= shape[i])) return false
  const target = voxel[0] + shape[0] * (voxel[1] + shape[1] * voxel[2])
  let low = 0, high = field.indices.length
  while (low < high) { const middle = (low + high) >>> 1; if (field.indices[middle] < target) low = middle + 1; else high = middle }
  return low < field.indices.length && field.indices[low] === target
}

export function regionMemberships(fields: Iterable<[string, SparseMask]>, visible: string[], position: Vec3): string[] {
  const eligible = new Set(visible)
  return [...fields].filter(([id, field]) => eligible.has(id) && containsSourceVoxel(field, position)).map(([id]) => id).sort()
}

/** Physical pan for the pinned renderer's RAS-mm section projection. */
export function centeredSlicePan(volume: Volume, position: Vec3, zoom: number): ViewState['pan'] {
  const center = volume.affine_ras_mm.slice(0, 3).map(row => row[3] + volume.shape.reduce((sum, size, i) => sum + row[i] * (size - 1) / 2, 0))
  return [...center.map((value, i) => value - zoom * position[i]), zoom] as ViewState['pan']
}
