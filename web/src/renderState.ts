import type { ViewState } from './types'
import type { ModelView } from './modelTypes'

/** Text editing and panel navigation do not invalidate anatomical rendering. */
export function imageRenderKey(state:ViewState):string {
  const {note:_note,panel:_panel,teaching,...display}=state
  return JSON.stringify({...display,practice:!!teaching?.practice,revealed:!!teaching?.revealed})
}
export function modelRenderKey(state:ModelView):string {
  const {note:_note,lesson_answer:_answer,lesson_revealed:_revealed,lesson_id:_lesson,lesson_step:_step,...display}=state
  return JSON.stringify(display)
}
