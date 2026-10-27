import { describe, expect, it, vi } from 'vitest'
import type { Niivue, NVImage } from '@niivue/niivue'
import { BACKGROUND_COLOR } from './atlasBackground'
import { labelContextVolumePalette, labelVolumeIdPalette, labelVolumePalette, LabelVolumeResources, type LabelVolumePalette } from './labelVolumeResources'
import type { ViewState } from './types'

const structures = [
  { id: 'foreground', name: 'Foreground', color: [30, 60, 90] as [number, number, number] },
  { id: 'context', name: 'Context', color: [200, 100, 10] as [number, number, number] },
  { id: 'hidden', name: 'Hidden', color: [100, 110, 120] as [number, number, number] },
]
const state = { visible: ['foreground'], meshOpacity: .8, surfaceOpacity: { foreground: .5 },
  surfaceContext: { enabled: true, opacity: .25, structure_ids: ['foreground', 'context'] } } as unknown as ViewState

describe('independent categorical volume appearance', () => {
  it('preserves compact source indices and keeps foreground colors separate from context', () => {
    const palette = labelVolumePalette(structures, state)
    expect(palette.I).toEqual([0, 1, 2, 3])
    expect(palette.R).toEqual([0, 30, 0, 0])
    expect(palette.G).toEqual([0, 60, 0, 0])
    expect(palette.B).toEqual([0, 90, 0, 0])
    expect(palette.A).toEqual([0, 128, 0, 0])
    expect(labelVolumePalette(structures, { ...state, surfaceOpacity: undefined }).A).toEqual([0, 255, 0, 0])
  })

  it('leaves voxel membership unchanged across global opacity including zero', () => {
    const palette = labelVolumePalette(structures, state)
    for (const meshOpacity of [0, .05, .25, .5, .75, 1]) {
      expect(labelVolumePalette(structures, { ...state, meshOpacity })).toEqual(palette)
    }
    expect(labelVolumePalette(structures, { ...state, surfaceContext: { ...state.surfaceContext!, enabled: false } })).toEqual(palette)
    expect(labelVolumePalette(structures, { ...state, surfaceOpacity: { foreground: 0 } }).A).toEqual([0, 0, 0, 0])
  })

  it('uses opaque gray context membership and leaves its opacity to the independent draw', () => {
    const palette = labelContextVolumePalette(structures, state)
    expect(palette.I).toEqual([0, 1, 2, 3])
    expect(palette.R).toEqual([0, 0, BACKGROUND_COLOR[0], 0])
    expect(palette.G).toEqual([0, 0, BACKGROUND_COLOR[1], 0])
    expect(palette.B).toEqual([0, 0, BACKGROUND_COLOR[2], 0])
    expect(palette.A).toEqual([0, 0, 255, 0])
    for (const opacity of [0, .05, .5, 1]) {
      expect(labelContextVolumePalette(structures, { ...state, meshOpacity: opacity,
        surfaceContext: { ...state.surfaceContext!, opacity } })).toEqual(palette)
    }
    expect(labelContextVolumePalette(structures, { ...state, surfaceContext: { ...state.surfaceContext!, enabled: false } }).A).toEqual([0, 0, 0, 0])
    expect(labelContextVolumePalette(structures, { ...state, visible: ['foreground', 'context'] }).A).toEqual([0, 0, 0, 0])
  })
})

describe('exact categorical volume identifiers', () => {
  it('distinguishes adjacent source structures even when their display colors are identical', () => {
    const sameColor = structures.map(structure => ({ ...structure, color: [30, 60, 90] as [number, number, number] }))
    const palette = labelVolumeIdPalette(sameColor, { ...state, visible: ['foreground', 'context'] })
    expect(palette.I).toEqual([0, 1, 2, 3])
    expect(palette.R).toEqual([0, 1, 2, 0]); expect(palette.G).toEqual([0, 0, 0, 0])
    expect(palette.B).toEqual([0, 0, 0, 0]); expect(palette.A).toEqual([0, 255, 255, 0])
  })

  it('retains compact source indices above 255 without confusing them with lower identifiers or background', () => {
    const many = Array.from({ length: 260 }, (_, index) => ({ id: 'region-' + (index + 1), name: 'Region ' + (index + 1), color: [30, 60, 90] as [number, number, number] }))
    const visible = [1, 255, 256, 257, 260]
    const palette = labelVolumeIdPalette(many, { ...state, visible: visible.map(id => 'region-' + id) })
    for (const id of visible) {
      expect(palette.R[id] + 256 * palette.G[id]).toBe(id)
      expect(palette.B[id]).toBe(0); expect(palette.A[id]).toBe(255)
    }
    expect(palette.R[256]).toBe(0); expect(palette.G[256]).toBe(1)
    expect(palette.R[2]).toBe(0); expect(palette.G[2]).toBe(0); expect(palette.A[2]).toBe(0)
    expect([palette.R[0], palette.G[0], palette.B[0], palette.A[0]]).toEqual([0, 0, 0, 0])
  })

  it('excludes hidden, context-only and disabled legacy structures while leaving global opacity to ray compositing', () => {
    const palette = labelVolumeIdPalette(structures, state)
    for (const meshOpacity of [0, .05, .5, 1]) expect(labelVolumeIdPalette(structures, { ...state, meshOpacity })).toEqual(palette)
    expect(labelVolumeIdPalette(structures, { ...state, surfaceOpacity: { foreground: .001 } })).toEqual(palette)
    for (const opacity of [0, -1, NaN]) {
      expect(labelVolumeIdPalette(structures, { ...state, surfaceOpacity: { foreground: opacity } }).A).toEqual([0, 0, 0, 0])
    }
    expect(palette.A).toEqual([0, 255, 0, 0])
  })
})

function fixture() {
  let active = 1007, textureNumber = 0
  const originalBinding = { texture: 'ordinary-slice-binding' }, originalOverlay = { texture: 'ordinary-overlay' }, originalId = { texture: 'ordinary-id' }
  const bindings = new Map<number, unknown>([[1002, originalBinding]])
  const gl = {
    ACTIVE_TEXTURE: 1, TEXTURE_BINDING_3D: 2, TEXTURE2: 1002, TEXTURE_3D: 3, TEXTURE_MIN_FILTER: 4, TEXTURE_MAG_FILTER: 5, NEAREST: 6,
    getParameter: vi.fn((parameter: number) => parameter === 1 ? active : bindings.get(active)),
    activeTexture: vi.fn((value: number) => { active = value }),
    bindTexture: vi.fn((_target: number, texture: unknown) => { bindings.set(active, texture) }),
    texParameteri: vi.fn(), deleteTexture: vi.fn(),
  }
  const originalLut = { marker: 'ordinary 2D palette' }, image = new Uint8Array([1, 2, 0, 3])
  const label = { img: image, colormapLabel: originalLut, opacity: .45,
    setColormapLabel: vi.fn(function (this: { colormapLabel: unknown }, palette: LabelVolumePalette) { this.colormapLabel = palette }) } as unknown as NVImage
  const viewer = { gl, overlayTexture: originalOverlay, overlayTextureID: originalId, refreshLayers: vi.fn() } as unknown as Niivue
  const generated: unknown[] = []
  vi.mocked(viewer.refreshLayers).mockImplementation((volume, layer) => {
    expect(volume).toBe(label); expect(layer).toBe(1)
    expect(volume.opacity).toBe(1)
    const texture = { texture: '3D-anatomy-' + ++textureNumber }
    generated.push(texture)
    viewer.overlayTexture = texture as unknown as WebGLTexture; viewer.overlayTextureID = viewer.overlayTexture
    gl.activeTexture(1002); gl.bindTexture(3, texture)
  })
  return { viewer, label, gl, originalBinding, originalOverlay, originalId, originalLut, image, generated, active: () => active, binding: () => bindings.get(1002) }
}

describe('independent label-volume texture lifetime', () => {
  it('reuses labels across equal contrast grids and resamples after dimensions or physical affine changes',()=>{
    const f=fixture(),resources=new LabelVolumeResources(),palette=labelVolumePalette(structures,state)
    const grid=(size=2,offset=0)=>({dimsRAS:[3,size,2,2],frac2mm:[1,0,0,0,0,1,0,0,0,0,1,0,offset,0,0,1]}) as unknown as NVImage
    f.viewer.volumes=[grid()]
    const original=resources.get(f.viewer,f.label,palette)
    f.viewer.volumes=[grid()]
    expect(resources.get(f.viewer,f.label,palette)).toBe(original)
    expect(f.viewer.refreshLayers).toHaveBeenCalledOnce()
    f.viewer.volumes=[grid(4)]
    const resized=resources.get(f.viewer,f.label,palette)
    expect(resized).not.toBe(original)
    expect(f.gl.deleteTexture).toHaveBeenCalledWith(original)
    f.viewer.volumes=[grid(4,12)]
    const translated=resources.get(f.viewer,f.label,palette)
    expect(translated).not.toBe(resized)
    f.viewer.volumes[0].frac2mm![4]=.25
    expect(resources.get(f.viewer,f.label,palette)).not.toBe(translated)
    expect(f.viewer.refreshLayers).toHaveBeenCalledTimes(4)
    resources.dispose(f.viewer)
  })
  it('reuses the exact identifier texture while global opacity, background and cursor change', () => {
    const f = fixture(), resources = new LabelVolumeResources()
    const texture = resources.get(f.viewer, f.label, labelVolumeIdPalette(structures, state))
    for (const meshOpacity of [0, .05, .25, .5, .75, 1]) {
      expect(resources.get(f.viewer, f.label, labelVolumeIdPalette(structures, { ...state, meshOpacity,
        position: [meshOpacity, 2, 3], surfaceContext: { ...state.surfaceContext!, opacity: meshOpacity } }))).toBe(texture)
    }
    expect(f.viewer.refreshLayers).toHaveBeenCalledOnce()
    resources.dispose(f.viewer)
  })
  it('restores the exact 2D texture, palette and opacity and reuses the 3D texture for cursor/camera/cut-only changes', () => {
    const f = fixture(), resources = new LabelVolumeResources(), palette = labelVolumePalette(structures, state)
    const texture = resources.get(f.viewer, f.label, palette)
    expect(texture).toBe(f.generated[0])
    expect(f.label.colormapLabel).toBe(f.originalLut); expect(f.label.opacity).toBe(.45); expect(f.label.img).toBe(f.image)
    expect(f.viewer.overlayTexture).toBe(f.originalOverlay); expect(f.viewer.overlayTextureID).toBe(f.originalId)
    expect(f.binding()).toBe(f.originalBinding); expect(f.active()).toBe(1007)
    expect(f.gl.texParameteri).toHaveBeenCalledWith(3, 4, 6); expect(f.gl.texParameteri).toHaveBeenCalledWith(3, 5, 6)
    const moved = { ...state, position: [90, -10, 30] as [number, number, number], camera: [40, 60, 2] as [number, number, number], surfaceCutaway: undefined }
    expect(resources.get(f.viewer, f.label, labelVolumePalette(structures, moved))).toBe(texture)
    expect(f.viewer.refreshLayers).toHaveBeenCalledOnce(); expect(f.gl.deleteTexture).not.toHaveBeenCalled()
    resources.dispose(f.viewer); resources.dispose(f.viewer)
    expect(f.gl.deleteTexture).toHaveBeenCalledExactlyOnceWith(texture)
  })

  it('does not reupload for opacity, background opacity or navigation changes', () => {
    const f = fixture(), resources = new LabelVolumeResources()
    const texture = resources.get(f.viewer, f.label, labelVolumePalette(structures, state))
    for (const meshOpacity of [0, .05, .25, .5, .75, 1]) {
      expect(resources.get(f.viewer, f.label, labelVolumePalette(structures, { ...state, meshOpacity,
        position: [meshOpacity, 2, 3], surfaceContext: { ...state.surfaceContext!, opacity: meshOpacity } }))).toBe(texture)
    }
    expect(f.viewer.refreshLayers).toHaveBeenCalledOnce()
    resources.dispose(f.viewer)
  })

  it('replaces only owned textures when visibility, a legacy per-structure multiplier or the loaded source changes', () => {
    const f = fixture(), resources = new LabelVolumeResources(), palette = labelVolumePalette(structures, state)
    const original = resources.get(f.viewer, f.label, palette)
    const hidden = resources.get(f.viewer, f.label, labelVolumePalette(structures, { ...state, visible: [] }))
    expect(hidden).not.toBe(original); expect(f.gl.deleteTexture).toHaveBeenCalledExactlyOnceWith(original)
    const opaque = resources.get(f.viewer, f.label, labelVolumePalette(structures, { ...state, surfaceOpacity: { foreground: 1 } }))
    expect(opaque).not.toBe(hidden); expect(f.gl.deleteTexture).toHaveBeenCalledWith(hidden)
    f.label.img = new Uint8Array([1, 0, 0, 3])
    const nextSource = resources.get(f.viewer, f.label, palette)
    expect(nextSource).not.toBe(opaque); expect(f.gl.deleteTexture).toHaveBeenCalledWith(opaque)
    resources.dispose(f.viewer)
    expect(f.gl.deleteTexture).not.toHaveBeenCalledWith(f.originalOverlay)
    expect(f.gl.deleteTexture).not.toHaveBeenCalledWith(f.originalId)
  })

  it('restores 2D state after a failed native upload, releases its partial allocation and retains the prior cache', () => {
    const f = fixture(), resources = new LabelVolumeResources(), palette = labelVolumePalette(structures, state)
    const prior = resources.get(f.viewer, f.label, palette), nativeUpload = vi.mocked(f.viewer.refreshLayers).getMockImplementation()!
    vi.mocked(f.viewer.refreshLayers).mockImplementation((volume, layer) => { nativeUpload(volume, layer); throw new Error('upload failed') })
    expect(() => resources.get(f.viewer, f.label, labelVolumePalette(structures, { ...state, visible: [] }))).toThrow('upload failed')
    expect(f.gl.deleteTexture).toHaveBeenCalledExactlyOnceWith(f.generated[1])
    expect(f.label.colormapLabel).toBe(f.originalLut); expect(f.label.opacity).toBe(.45)
    expect(f.viewer.overlayTexture).toBe(f.originalOverlay); expect(f.viewer.overlayTextureID).toBe(f.originalId)
    expect(f.binding()).toBe(f.originalBinding); expect(f.active()).toBe(1007)
    expect(resources.get(f.viewer, f.label, palette)).toBe(prior)
    resources.dispose(f.viewer)
  })

  it.each([false, true])('keeps unchanged cursor geometry valid after a temporary label resample, including failed upload %s', failing => {
    const f = fixture(), resources = new LabelVolumeResources(), mm = Float32Array.from([12, 24, 36, 1])
    f.viewer.crosshairs3D = { mm } as unknown as NonNullable<Niivue['crosshairs3D']>
    const upload = vi.mocked(f.viewer.refreshLayers).getMockImplementation()!
    vi.mocked(f.viewer.refreshLayers).mockImplementation((volume, layer) => {
      f.viewer.crosshairs3D!.mm![0] = NaN
      upload(volume, layer)
      if (failing) throw Error('upload failed')
    })
    const get = () => resources.get(f.viewer, f.label, labelVolumePalette(structures, state))
    if (failing) expect(get).toThrow('upload failed')
    else get()
    expect(f.viewer.crosshairs3D.mm).toBe(mm)
    expect(Array.from(mm)).toEqual([12, 24, 36, 1])
    resources.dispose(f.viewer)
  })

  it('preserves an existing cursor invalidation and does not change a replacement cursor', () => {
    const f = fixture(), resources = new LabelVolumeResources()
    f.viewer.crosshairs3D = { mm: Float32Array.from([NaN, 24, 36, 1]) } as unknown as NonNullable<Niivue['crosshairs3D']>
    resources.get(f.viewer, f.label, labelVolumePalette(structures, state))
    expect(f.viewer.crosshairs3D.mm![0]).toBeNaN()
    const replacement = { mm: Float32Array.from([50, 60, 70, 1]) } as unknown as NonNullable<Niivue['crosshairs3D']>
    vi.mocked(f.viewer.refreshLayers).mockImplementation(() => { f.viewer.crosshairs3D = replacement; throw Error('replacement') })
    expect(() => resources.get(f.viewer, f.label, labelVolumePalette(structures, { ...state, visible: [] }))).toThrow('replacement')
    expect(f.viewer.crosshairs3D).toBe(replacement)
    expect(Array.from(replacement.mm!)).toEqual([50, 60, 70, 1])
    resources.dispose(f.viewer)
  })
})
