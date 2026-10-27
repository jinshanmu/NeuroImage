import type { Niivue, NVImage } from '@niivue/niivue'
import { BACKGROUND_COLOR } from './atlasBackground'
import type { Structure, ViewState } from './types'

export interface LabelVolumePalette {
  I: number[]; R: number[]; G: number[]; B: number[]; A: number[]; labels: string[];
}

type PaletteStructure = Pick<Structure, 'id' | 'name' | 'color'>

function sourcePalette(structures: PaletteStructure[], appearance: (structure: PaletteStructure, index: number) => { color: readonly number[]; opacity: number }): LabelVolumePalette {
  const palette: LabelVolumePalette = { I: [0], R: [0], G: [0], B: [0], A: [0], labels: ['Background'] }
  const alpha = (value: number) => Number.isFinite(value) ? Math.round(255 * Math.max(0, Math.min(1, value))) : 0
  for (const [index, structure] of structures.entries()) {
    const { color, opacity } = appearance(structure, index)
    palette.I.push(index + 1)
    palette.R.push(color[0]); palette.G.push(color[1]); palette.B.push(color[2])
    palette.A.push(alpha(opacity))
    palette.labels.push(structure.name)
  }
  return palette
}

/** Foreground membership is independent of the final 3D compositing opacity. */
export function labelVolumePalette(structures: PaletteStructure[], state: ViewState): LabelVolumePalette {
  const visible = new Set(state.visible)
  return sourcePalette(structures, structure => visible.has(structure.id)
    ? { color: structure.color, opacity: state.surfaceOpacity?.[structure.id] ?? 1 }
    : { color: [0, 0, 0], opacity: 0 })
}

/** Exact source membership for compositing successive categorical ray segments. */
export function labelVolumeIdPalette(structures: PaletteStructure[], state: ViewState): LabelVolumePalette {
  if (structures.length > 65535) throw new Error('Compact label IDs exceed the 16-bit volume encoding.')
  const visible = new Set(state.visible)
  return sourcePalette(structures, (structure, index) => {
    const opacity = state.surfaceOpacity?.[structure.id] ?? 1
    if (!visible.has(structure.id) || !Number.isFinite(opacity) || opacity <= 0) return { color: [0, 0, 0], opacity: 0 }
    const id = index + 1
    return { color: [id & 255, id >>> 8, 0], opacity: 1 }
  })
}

/** Context is a separate draw so its opacity cannot follow the foreground. */
export function labelContextVolumePalette(structures: PaletteStructure[], state: ViewState): LabelVolumePalette {
  const visible = new Set(state.visible)
  const context = new Set(state.surfaceContext?.enabled ? state.surfaceContext.structure_ids : [])
  return sourcePalette(structures, structure => !visible.has(structure.id) && context.has(structure.id)
    ? { color: BACKGROUND_COLOR, opacity: 1 }
    : { color: [0, 0, 0], opacity: 0 })
}

/** Own a resampled 3D label texture without replacing the ordinary 2D overlay. */
export class LabelVolumeResources {
  private texture: WebGLTexture | null = null
  private source: NVImage | null = null
  private image: NVImage['img'] | null = null
  private paletteKey = ''
  private targetGridKey = ''

  get(viewer: Niivue, label: NVImage, palette: LabelVolumePalette): WebGLTexture {
    const key = JSON.stringify([palette.I, palette.R, palette.G, palette.B, palette.A])
    const background = viewer.volumes?.[0]
    const grid = JSON.stringify([Array.from(background?.dimsRAS ?? []), Array.from(background?.frac2mm ?? background?.matRAS ?? [])])
    if (this.texture && this.source === label && this.image === label.img && this.paletteKey === key && this.targetGridKey === grid) return this.texture
    const gl = viewer.gl, active = gl.getParameter(gl.ACTIVE_TEXTURE)
    gl.activeTexture(gl.TEXTURE2)
    const binding = gl.getParameter(gl.TEXTURE_BINDING_3D) as WebGLTexture | null
    gl.activeTexture(active)
    const mm = viewer.crosshairs3D?.mm
    const original = { overlay: viewer.overlayTexture, id: viewer.overlayTextureID, lut: label.colormapLabel, opacity: label.opacity, mm, cursorX: mm?.[0] }
    let generated: WebGLTexture | null = null, success = false
    try {
      label.setColormapLabel(palette)
      label.opacity = 1
      // Layer 1 uses the existing background grid and its source-to-RAS
      // transform, including when the original categorical image is layer 0.
      viewer.refreshLayers(label, 1)
      generated = viewer.overlayTexture
      if (!generated || generated === original.overlay || generated === original.id) throw new Error('Could not allocate an independent label-volume texture.')
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, generated)
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      success = true
    } finally {
      // refreshLayers can allocate the texture before a later shader failure.
      const allocated = viewer.overlayTexture
      if (!success && allocated && allocated !== original.overlay && allocated !== original.id && allocated !== this.texture) gl.deleteTexture(allocated)
      label.colormapLabel = original.lut; label.opacity = original.opacity
      viewer.overlayTexture = original.overlay; viewer.overlayTextureID = original.id
      // A temporary layer-1 resample cannot change the background grid or
      // cursor geometry. Native refreshLayers invalidates it unconditionally.
      if (original.mm && viewer.crosshairs3D?.mm === original.mm) original.mm[0] = original.cursorX!
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, binding); gl.activeTexture(active)
    }
    if (this.texture && this.texture !== generated) gl.deleteTexture(this.texture)
    this.texture = generated!
    this.source = label; this.image = label.img; this.paletteKey = key
    this.targetGridKey = grid
    return this.texture
  }

  dispose(viewer: Niivue): void {
    if (this.texture) viewer.gl.deleteTexture(this.texture)
    this.texture = null; this.source = null; this.image = null; this.paletteKey = ''; this.targetGridKey = ''
  }
}
