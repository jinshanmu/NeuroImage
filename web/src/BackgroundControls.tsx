import { FrameRange } from './FrameRange'
import type { ReactNode } from 'react'

interface BackgroundLayer {
  enabled: boolean
  opacity: number
  adjust: (opacity: number) => void
}

export function BackgroundControls({ image, model, disabled, unavailable, children, className }: {
  image?: BackgroundLayer; model?: BackgroundLayer; disabled: boolean; unavailable?: string; children?: ReactNode; className?: string;
}) {
  return <div className={`background-controls${className ? ' ' + className : ''}`} role="group" aria-label={children ? 'Background and cursor' : 'Background'}>
    {([['2D', image], ['3D', model]] as const).map(([name, layer]) => layer && <div className="background-layer" key={name}>
      <label>{name} background<FrameRange aria-label={`${name} background`} min="0" max="1" step=".05"
        value={layer.enabled ? layer.opacity : 0} disabled={disabled} onValueChange={layer.adjust}/>
        <output aria-label={`${name} background opacity value`}>{Math.round((layer.enabled ? layer.opacity : 0) * 100)}%</output></label>
    </div>)}
    {children}
    {unavailable && <span className="small muted">{unavailable}</span>}
  </div>
}
