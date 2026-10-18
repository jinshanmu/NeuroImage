import { SelectField } from './SelectField'
import type { Manifest, StreamlineLevelId, StreamlineStructure, ViewState } from './types'
import { displayLevel } from './streamlines'

export function StreamlineControls({ manifest, state, ready, patch }: { manifest: Manifest; state: ViewState; ready: boolean; patch: (change: Partial<ViewState>) => void }) {
  const visible = manifest.structures.filter((s): s is StreamlineStructure => s.kind === 'streamline-bundle' && state.visible.includes(s.id))
  const count = visible.reduce((sum, bundle) => sum + displayLevel(bundle, state.streamlineLevel).streamline_count, 0)
  const sourceCount = visible.reduce((sum, bundle) => sum + bundle.streamlines.source_streamline_count, 0)
  return <div className="streamline-evidence">
    <div className="streamline-controls"><label>Display sampling<SelectField aria-label="Streamline display sampling" value={state.streamlineLevel ?? 'standard'} disabled={!ready}
      onChange={event => patch({ streamlineLevel: event.target.value as StreamlineLevelId })}>
      <option value="preview">Preview · up to 256 per bundle</option><option value="standard">Standard · up to 1,024 per bundle</option><option value="detail">Detail · up to 4,096 per bundle</option>
    </SelectField></label><label>Section slab (mm)<input aria-label="Streamline section slab in millimeters" type="number" min=".2" max="10" step=".2" value={state.streamlineSlabMm ?? 1}
      disabled={!ready} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= .2 && value <= 10) patch({ streamlineSlabMm: value }) }}/></label></div>
    <output aria-label="Displayed streamline count">{count.toLocaleString()} displayed / {sourceCount.toLocaleString()} retained source trajectories in {visible.length} visible {visible.length === 1 ? 'bundle' : 'bundles'}</output>
    <p>2D shows only trajectory portions within ±{((state.streamlineSlabMm ?? 1) / 2).toFixed(1)} mm of each section. Lines are computational estimates. Display density describes the selected set of original source trajectories.</p>
  </div>
}
