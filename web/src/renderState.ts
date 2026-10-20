import type { ViewState } from './types'
import type { ModelView } from './modelTypes'

/** Imported note text does not invalidate anatomical rendering. */
export function imageRenderKey(state:ViewState):string {
  const {note:_note,...display}=state
  return JSON.stringify(display)
}
export function modelRenderKey(state:ModelView):string {
  const {note:_note,...display}=state
  return JSON.stringify(display)
}
