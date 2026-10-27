import type { SelectionEvidence, ViewState } from './types'

type VolumePickState = Pick<ViewState, 'visible' | 'meshOpacity' | 'surfaceOpacity' | 'surfaceCutaway'>

/** Resolve an actual source voxel at a ray hit, including solid cut interiors. */
export function categoricalVolumeSelection(id: string | null, state: VolumePickState, position: ArrayLike<number>): {
  selected: string; selectionEvidence: SelectionEvidence;
} | null {
  if (!id || !state.visible.includes(id) || ![0, 1, 2].every(axis => Number.isFinite(position[axis]))) return null
  const opacity = state.meshOpacity * (state.surfaceOpacity?.[id] ?? 1)
  if (!Number.isFinite(opacity) || opacity <= 0) return null
  // A categorical volume uses one physical ray interval for all its labels.
  // Check the sampled plane before the live cursor moves that plane again.
  const cut = state.surfaceCutaway
  if (cut && cut.side * (position[cut.axis] - cut.position_mm) > 0) return null
  return { selected: id, selectionEvidence: { kind: 'label-voxel', candidates: [id] } }
}
