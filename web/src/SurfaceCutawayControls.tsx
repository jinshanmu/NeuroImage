import { SelectField } from './SelectField'
import { CUTAWAY_AXES, CUTAWAY_SIDES, cutawayAtCursor, cutawayDescription } from './cutaway'
import type { ViewState } from './types'

export function SurfaceCutawayControls({ state, matches, ready, patch }: {
  state: ViewState; matches: string[]; ready: boolean; patch: (value: Partial<ViewState>) => void;
}) {
  const cut = state.surfaceCutaway
  return <details className="surface-cutaway-controls" open={cut ? true : undefined}><summary>3D surface cutaway{cut ? ` · ${cut.structures.length} surfaces` : ''}</summary>
    <p className="small muted">Open a view into surrounding anatomy. The cut affects selected 3D surfaces only; complete source sections remain available.</p>
    <div className="button-row"><button disabled={!ready || !state.visible.length} onClick={() => patch({ surfaceCutaway: cutawayAtCursor(state.position, state.visible) })}>Cut visible surfaces at cursor</button>
      <button disabled={!ready || !matches.length} onClick={() => patch({ surfaceCutaway: cutawayAtCursor(state.position, matches) })}>Cut matched surfaces at cursor</button>
      <button disabled={!ready || !cut} onClick={() => patch({ surfaceCutaway: undefined })}>Restore whole surfaces</button></div>
    {cut && <><div className="cutaway-inputs"><label>Plane<SelectField aria-label="Surface cutaway plane" value={cut.axis} disabled={!ready} onChange={event => {
      const axis = Number(event.target.value) as 0 | 1 | 2
      patch({ surfaceCutaway: { ...cut, axis, position_mm: state.position[axis] } })
    }}><option value="2">Axial · S coordinate</option><option value="1">Coronal · A coordinate</option><option value="0">Sagittal · R coordinate</option></SelectField></label>
      <label>Remove side<SelectField aria-label="Surface cutaway removed side" value={cut.side} disabled={!ready} onChange={event => patch({ surfaceCutaway: { ...cut, side: Number(event.target.value) as -1 | 1 } })}>
        <option value="1">{CUTAWAY_SIDES[cut.axis][1]}</option><option value="-1">{CUTAWAY_SIDES[cut.axis][0]}</option></SelectField></label>
      <label>{CUTAWAY_AXES[cut.axis]} · mm<input type="number" aria-label="Surface cutaway coordinate in millimeters" value={cut.position_mm} step=".5" min="-1000000" max="1000000" disabled={!ready} onChange={event => {
        if (event.target.value.trim() && Number.isFinite(event.target.valueAsNumber) && Math.abs(event.target.valueAsNumber) <= 1e6) patch({ surfaceCutaway: { ...cut, position_mm: event.target.valueAsNumber } })
      }}/></label><button disabled={!ready} onClick={() => patch({ surfaceCutaway: { ...cut, position_mm: state.position[cut.axis] } })}>Move cut to cursor</button></div>
      <p className="small muted" role="status">{cutawayDescription(cut)}</p></>}
  </details>
}
