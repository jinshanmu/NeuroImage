import type { Structure, Vec3, ViewState, Volume } from './types'

export const FULL_CONTEXT_3D_SCALE = .8

/** Shared 1–10 magnification contract for range, wheel and restored controls. */
export function zoomFactor(value: number): number {
  return Math.round(Math.max(1, Math.min(10, Number.isFinite(value) ? value : 1)) * 10) / 10
}

/** The native fitted scale is a base, not a previously magnified camera value. */
export function zoomScale3D(base: number, factor: number): number {
  return base * zoomFactor(factor)
}

export function zoomFactor3D(scale: number, base: number): number {
  return zoomFactor(scale / base)
}

/** Older scenes retain raw camera scales until the user changes magnification. */
export function viewZoom3D(state: Pick<ViewState, 'zoom3D' | 'fitVisible3D' | 'camera'>): number {
  return state.zoom3D !== undefined ? zoomFactor(state.zoom3D)
    : state.fitVisible3D ? 1 : zoomFactor3D(state.camera[2], FULL_CONTEXT_3D_SCALE)
}

/** Use the formal viewer's convention without rewriting a historical scene. */
export function radiologicalView(state: ViewState): ViewState {
  return state.radiological ? state : { ...state, radiological: true }
}

/** Adapt retired display modes at runtime while leaving stored scenes intact. */
export function atlasDisplayView(state: ViewState): ViewState {
  const current = radiologicalView(state)
  return current.layout === 'anatomy'
    ? { ...current, layout: 'quad', tileLayout: 'row', fitVisible3D: current.fitVisible3D ?? true }
    : current
}

/** Fit all source-bound corners inside the current orthographic camera frustum. */
export function fitBoundsZoom(bounds: [Vec3, Vec3], matrix: ArrayLike<number>): number {
  const project = (point: Vec3) => {
    const w = matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15]
    return [0, 1, 2].map(row => (matrix[row] * point[0] + matrix[row + 4] * point[1] + matrix[row + 8] * point[2] + matrix[row + 12]) / w)
  }
  const center = project(bounds[0].map((low, axis) => (low + bounds[1][axis]) / 2) as Vec3)
  let extentXY = 0, extentZ = 0
  for (let index = 0; index < 8; index++) {
    const point = project([bounds[index & 1][0], bounds[(index >> 1) & 1][1], bounds[(index >> 2) & 1][2]])
    extentXY = Math.max(extentXY, Math.abs(point[0]), Math.abs(point[1]))
    extentZ = Math.max(extentZ, Math.abs(point[2] - center[2]))
  }
  return Math.max(.1, Math.min(20, .9 / Math.max(extentXY, 1e-6), Math.max(.01, .96 - Math.abs(center[2])) / Math.max(extentZ, 1e-6)))
}

/** Fit source bounds by moving only the 3D camera; the shared image point stays fixed. */
export function focusStructure3D(structure: Structure, background: Volume, camera: ViewState['camera']): Pick<ViewState, 'focus3D' | 'camera'> {
  const span = Math.max(...structure.bounds_ras_mm[1].map((high, axis) => high - structure.bounds_ras_mm[0][axis]), 1)
  const field = Math.max(...background.shape.map((size, axis) => size * background.voxel_size_mm[axis]))
  const center = structure.bounds_ras_mm[0].map((low, axis) => (low + structure.bounds_ras_mm[1][axis]) / 2) as ViewState['position']
  return { focus3D: center, camera: [camera[0], camera[1], Math.max(.8, Math.min(12, .8 * field / span))] }
}

/** A display multiplier never alters label colors, voxel values or geometry. */
export function surfaceOpacity(state: ViewState, id: string): number {
  return state.meshOpacity * (state.surfaceOpacity?.[id] ?? 1)
}

export function setSurfaceOpacity(state: ViewState, ids: string[], opacity: number): Record<string, number> {
  const next = { ...state.surfaceOpacity }
  for (const id of ids) {
    if (opacity === 1) delete next[id]
    else next[id] = opacity
  }
  return next
}
