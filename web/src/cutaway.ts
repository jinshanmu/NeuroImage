import type { SurfaceCutaway, Vec3 } from './types'

export const CUTAWAY_AXES = ['R', 'A', 'S'] as const
export const CUTAWAY_SIDES = [['Left', 'Right'], ['Posterior', 'Anterior'], ['Inferior', 'Superior']] as const

/** The positive half-space is hidden; points on the plane remain visible. */
export function cutawayPlane(cutaway: SurfaceCutaway): [number, number, number, number] {
  const plane: [number, number, number, number] = [0, 0, 0, -cutaway.side * cutaway.position_mm]
  plane[cutaway.axis] = cutaway.side
  return plane
}

export function removedByCutaway(cutaway: SurfaceCutaway | undefined, id: string, point: ArrayLike<number>): boolean {
  return !!cutaway?.structures.includes(id) && cutaway.side * (point[cutaway.axis] - cutaway.position_mm) > 0
}

export function validateCutaway(value: unknown, ids: Set<string>): value is SurfaceCutaway {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as SurfaceCutaway
  return Object.keys(item).sort().join(',') === 'axis,position_mm,side,structures' &&
    [0, 1, 2].includes(item.axis) && [-1, 1].includes(item.side) &&
    typeof item.position_mm === 'number' && Number.isFinite(item.position_mm) && Math.abs(item.position_mm) <= 1e6 &&
    Array.isArray(item.structures) && item.structures.length > 0 && new Set(item.structures).size === item.structures.length &&
    item.structures.every(id => ids.has(id))
}

export function cutawayAtCursor(position: Vec3, structures: string[], axis: 0 | 1 | 2 = 2): SurfaceCutaway {
  return { axis, side: 1, position_mm: position[axis], structures: [...new Set(structures)] }
}

export function cutawayDescription(cutaway: SurfaceCutaway): string {
  const side = CUTAWAY_SIDES[cutaway.axis][cutaway.side === 1 ? 1 : 0]
  return `3D surface cutaway: remove ${side.toLowerCase()} of ${CUTAWAY_AXES[cutaway.axis]} ${cutaway.position_mm.toFixed(2)} mm for ${cutaway.structures.length} source surfaces. Display only; open boundaries, no generated cap or tissue.`
}
