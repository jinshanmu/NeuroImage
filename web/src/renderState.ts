import type { ViewState } from './types'
import type { ModelView } from './modelTypes'

function assetStructureIds(state: Pick<ViewState, 'visible' | 'surfaceContext'>): string[] {
  const context = state.surfaceContext
  return [...new Set([...state.visible, ...(context?.enabled && context.opacity > 0 ? context.structure_ids : [])])].sort()
}

/** Only source dependencies cancel in-flight asset preparation. */
export function imageAssetKey(state: ViewState): string {
  const selected = state.selected && state.visible.includes(state.selected) ? state.selected : null
  const field = state.overlay === 'probability' || state.overlay === 'mask' ? [state.overlay, selected] : null
  return JSON.stringify([state.background, assetStructureIds(state), field, state.streamlineLevel ?? 'standard'])
}

export function modelAssetKey(state: ModelView): string {
  return JSON.stringify(assetStructureIds(state))
}

/** Imported note text does not invalidate anatomical rendering. */
export function imageRenderKey(state:ViewState):string {
  const {note:_note,...display}=state
  return JSON.stringify(display)
}
export function modelRenderKey(state:ModelView):string {
  const {note:_note,...display}=state
  return JSON.stringify(display)
}
