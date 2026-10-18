import type { Manifest, ViewState } from './types'

export function NativeImageControls({ manifest, state, value, ready, base, patch }: {
  manifest: Manifest; state: ViewState; value: number | null | undefined; ready: boolean; base: string;
  patch: (change: Partial<ViewState>) => void;
}) {
  const image = manifest.volumes.find(volume => volume.id === state.background)!
  return <section className="native-image-controls">
    <h2>{image.name}</h2><p className="evidence">{image.scalar ? image.scalar.interpretation : 'Original image in its own native space. This source supplies no anatomical segmentation or structure labels.'}</p>
    <dl><dt>Source dimensions</dt><dd>{image.shape.join(' × ')} voxels</dd><dt>Native spacing</dt><dd>{image.voxel_size_mm.map(size => size.toFixed(3)).join(' × ')} mm</dd></dl>
    {image.native_frame && <p className="evidence">Exact native frame {image.native_frame.frame+1} of {image.native_frame.source_shape[3]}. The display retains the original source samples, frame and spatial grid.</p>}
    {image.scalar && <dl><dt>Metric</dt><dd>{image.scalar.metric}</dd><dt>Statistic</dt><dd>{image.scalar.statistic}</dd><dt>Units</dt><dd>{image.scalar.units}</dd></dl>}
    <h3>{image.scalar ? 'Source field value' : 'Source image intensity'}</h3><output aria-label={image.scalar ? 'Source scalar value at cursor' : 'Source image intensity at cursor'}>{value == null ? 'Unavailable at cursor' : Number(value.toPrecision(7)).toString()}{image.scalar && value != null ? ` ${image.scalar.units}` : ''}</output>
    <p className="small muted">Value at the nearest original source voxel. Contrast controls adjust the display.</p>
    <h3>Image contrast</h3>{(['Minimum', 'Maximum'] as const).map((name, axis) => <label key={name}>{name}<input type="number" aria-label={`Image window ${name.toLowerCase()}`} value={state.window[axis]} disabled={!ready} onChange={event => {
      const next = [...state.window] as ViewState['window']; next[axis] = event.target.valueAsNumber
      if (next.every(Number.isFinite) && next[0] < next[1]) patch({ window: next })
    }}/></label>)}
    <button disabled={!ready} onClick={() => patch({ window: [image.cal_min, image.cal_max] })}>Reset image contrast</button>
    <p className="small muted">{image.scalar ? 'The 3D view displays the original statistical field. Read values in the recorded source units and use the metric definition for interpretation.' : 'The 3D view displays source intensities. Study bright structures in adjacent source sections and record image observations with teaching markers.'}</p>
    {image.scalar && <details><summary>Field definition</summary><p>{image.scalar.derivation}</p><p>{image.scalar.reference}</p></details>}
    <a href={base + image.file} download>Download {image.native_frame ? 'native frame' : 'original'} NIfTI {image.scalar ? 'field' : 'image'}</a>
    {image.native_frame && <p><a href={base+image.native_frame.source_file} download>Download original complete source series</a></p>}
  </section>
}
