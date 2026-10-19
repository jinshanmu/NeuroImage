interface BackgroundLayer {
  enabled: boolean
  opacity: number
  toggle: (enabled: boolean) => void
  adjust: (opacity: number) => void
}

export function BackgroundControls({ title, image, model, disabled, unavailable }: {
  title: string; image?: BackgroundLayer; model?: BackgroundLayer; disabled: boolean; unavailable?: string;
}) {
  return <div className="background-controls" role="group" aria-label={title}>
    <span>{title}</span>
    {([['2D', image], ['3D', model]] as const).map(([name, layer]) => layer && <div className="background-layer" key={name}>
      <button aria-label={`${name} background`} aria-pressed={layer.enabled} disabled={disabled}
        onClick={() => layer.toggle(!layer.enabled)}>{name} {layer.enabled ? 'on' : 'off'}</button>
      <label><span className="sr-only">{name} background opacity</span><input aria-label={`${name} background opacity`} type="range" min="0" max="1" step=".05"
        value={layer.opacity} disabled={disabled || !layer.enabled} onChange={event => layer.adjust(Number(event.target.value))}/></label>
      <output aria-label={`${name} background opacity value`}>{Math.round(layer.opacity * 100)}%</output>
    </div>)}
    {unavailable && <span className="small muted">{unavailable}</span>}
  </div>
}
