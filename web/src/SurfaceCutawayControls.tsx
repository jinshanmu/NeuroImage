import { SelectField } from './SelectField'
import { CUTAWAY_SIDES, cutawayAtCursor } from './cutaway'
import type { ViewState } from './types'

export function SurfaceCutawayControls({ state, ready, patch }: {
  state: ViewState; ready: boolean; patch: (value: Partial<ViewState>) => void;
}) {
  const cut = state.surfaceCutaway
  return <section className="view-toolbar surface-cutaway-controls" aria-label="3D surface cutaway">
    <button aria-pressed={!!cut} disabled={!ready || (!cut && !state.visible.length)} onClick={() => patch({ surfaceCutaway: cut ? undefined : cutawayAtCursor(state.position, state.visible) })}>Cutaway</button>
    {cut && <><label>Plane<SelectField aria-label="Surface cutaway plane" value={cut.axis} disabled={!ready} onChange={event => {
      const axis = Number(event.target.value) as 0 | 1 | 2
      patch({ surfaceCutaway: { ...cut, axis, position_mm: state.position[axis], followCursor: true } })
    }}><option value="2">Axial</option><option value="1">Coronal</option><option value="0">Sagittal</option></SelectField></label>
      <label>Remove side<SelectField aria-label="Surface cutaway removed side" value={cut.side} disabled={!ready} onChange={event => patch({ surfaceCutaway: { ...cut, side: Number(event.target.value) as -1 | 1, position_mm: state.position[cut.axis], followCursor: true } })}>
        <option value="1">{CUTAWAY_SIDES[cut.axis][1]}</option><option value="-1">{CUTAWAY_SIDES[cut.axis][0]}</option></SelectField></label>
    </>}
  </section>
}
