import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Niivue, type NVImage } from '@niivue/niivue'
import { AtlasViewer } from './viewer'
import { volumeCutawayPlane } from './volumeCutaway'
import type { Manifest, SurfaceCutaway, Vec3 } from './types'

const centeredRAS = (fraction: Vec3) => [200 * fraction[0] - 100, 160 * fraction[1] - 80, 80 * fraction[2] - 40, 1]
const cut = (axis: 0 | 1 | 2 = 0, side: -1 | 1 = 1, position_mm = 25): SurfaceCutaway => ({ axis, side, position_mm, structures: ['region'] })

// Decode the pinned volume renderer's spherical clip format for a sample.
function samplePlane([depth, azimuth, elevation]: number[], fraction: Vec3): number {
  const phi = -elevation * Math.PI / 180, theta = (azimuth + 90) * Math.PI / 180
  return Math.cos(phi) * Math.cos(theta) * (fraction[0] - .5) + Math.cos(phi) * Math.sin(theta) * (fraction[1] - .5)
    + Math.sin(phi) * (fraction[2] - .5) + depth
}

describe('physical surface cutaways for intensity-volume backgrounds', () => {
  it.each([
    [0, 1, 25, [.125, 90, 0]], [0, -1, 25, [-.125, -90, 0]],
    [1, 1, 20, [.125, 180, 0]], [2, 1, 10, [.125, 0, 90]], [2, -1, 10, [-.125, 0, -90]],
  ] as const)('encodes a centered anisotropic RAS plane on axis %s, side %s', (axis, side, position, expected) => {
    const plane = volumeCutawayPlane(cut(axis, side, position), centeredRAS)
    plane.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 10))
  })

  it.each([0, 1, 2] as const)('retains the same physical halfspace for an off-center oblique, sheared source on axis %s', axis => {
    const shape = [11, 17, 9], affine = [[0, -1.2, .2, 120], [.7, 0, .3, -45], [.25, .18, 2.1, 33]]
    const ras = (fraction: Vec3) => affine.map(row => row[3] + fraction.reduce((sum, value, index) => sum + row[index] * (shape[index] * value - .5), 0))
    const position = ras([.33, .6, .45])[axis]
    for (const side of [-1, 1] as const) {
      const plane = volumeCutawayPlane(cut(axis, side, position), ras)
      const origin = ras([0, 0, 0])[axis], scale = Math.hypot(...([0, 1, 2] as const).map(index => {
        const fraction: Vec3 = [0, 0, 0]; fraction[index] = 1
        return ras(fraction)[axis] - origin
      }))
      for (const fraction of [[0, 0, 0], [1, 1, 1], [.1, .7, .2], [.8, .4, .6], [.33, .6, .45]] as Vec3[]) {
        const distance = -side * (ras(fraction)[axis] - position) / scale
        expect(samplePlane(plane, fraction)).toBeCloseTo(distance, 10)
        if (Math.abs(distance) > 1e-8) expect(samplePlane(plane, fraction) > 0).toBe(side * (ras(fraction)[axis] - position) < 0)
      }
    }
  })

  it('keeps planes outside the volume meaningful and rejects nonfinite or collapsed transforms', () => {
    expect(samplePlane(volumeCutawayPlane(cut(0, 1, 150), centeredRAS), [1, 1, 1])).toBeGreaterThan(0)
    expect(samplePlane(volumeCutawayPlane(cut(0, 1, -150), centeredRAS), [0, 0, 0])).toBeLessThan(0)
    expect(() => volumeCutawayPlane(cut(), () => [1, 1, 1])).toThrow('finite source coordinate transform')
    expect(() => volumeCutawayPlane(cut(), () => [NaN, 1, 1])).toThrow('finite source coordinate transform')
  })
})

beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1 })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function renderer() {
  const canvas = { addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement
  const viewer = new AtlasViewer(canvas, { representation: 'mri-labels', structures: [], volumes: [] } as unknown as Manifest, '', () => {}, () => {})
  const nv = viewer.nv, uniform = vi.fn()
  vi.spyOn(nv, 'withDepthPickScissor').mockImplementation(draw => draw())
  Object.defineProperty(nv, 'gl', { value: { uniform1f: uniform } })
  nv.renderShader = { use: vi.fn(), uniforms: { backOpacity: 'background', overlays: 'overlays' } } as unknown as typeof nv.renderShader
  nv.pickingImageShader = { use: vi.fn(), uniforms: { overlays: 'picking-overlays' } } as unknown as typeof nv.pickingImageShader
  nv.volumes = [{ opacity: .42 }] as NVImage[]
  nv.overlays = [{}] as typeof nv.overlays
  nv.imageContext = true; nv.volumeBackgroundOpacity = .25
  nv.surfaceCutaway = cut()
  nv.scene.clipPlaneDepthAziElevs = [[.22, 60, 15]]
  nv.opts.isClipPlanesCutaway = true; nv.opts.isClipAllVolumes = false
  vi.spyOn(nv, 'frac2mm').mockImplementation(fraction => Float32Array.from(centeredRAS(Array.from(fraction) as Vec3)))
  return { viewer, nv, uniform }
}

describe('draw-scoped volume cutaway integration', () => {
  it.each([false, true])('uses the matching physical plane for ordinary/picking=%s and restores native settings', picking => {
    const f = renderer(), original = f.nv.scene.clipPlaneDepthAziElevs
    f.nv.uiData.mouseDepthPicker = picking
    const draw = vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(function (this: Niivue) {
      expect(this.scene.clipPlaneDepthAziElevs).not.toBe(original)
      expect(this.scene.clipPlaneDepthAziElevs[0][0]).toBeCloseTo(.125)
      expect(this.scene.clipPlaneDepthAziElevs[0][1]).toBeCloseTo(90)
      expect(this.opts.isClipPlanesCutaway).toBe(false)
      expect(this.opts.isClipAllVolumes).toBe(true)
    })
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    expect(draw).toHaveBeenCalledOnce()
    expect(f.nv.scene.clipPlaneDepthAziElevs).toBe(original)
    expect(f.nv.opts.isClipPlanesCutaway).toBe(true)
    expect(f.nv.opts.isClipAllVolumes).toBe(false)
    const overlay = picking ? 'picking-overlays' : 'overlays'
    expect(f.uniform).toHaveBeenCalledWith(overlay, 0)
    expect(f.uniform).toHaveBeenLastCalledWith(overlay, 1)
    if (picking) expect(f.nv.renderShader!.use).not.toHaveBeenCalled()
    else expect(f.uniform).toHaveBeenCalledWith('background', .42)
    f.viewer.dispose()
  })

  it('restores clip options and shader state when the native background draw throws', () => {
    const f = renderer(), original = f.nv.scene.clipPlaneDepthAziElevs
    vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(() => { throw new Error('draw failed') })
    expect(() => f.nv.drawImage3D(new Float32Array(16), 110, 15)).toThrow('draw failed')
    expect(f.nv.scene.clipPlaneDepthAziElevs).toBe(original)
    expect(f.nv.opts.isClipPlanesCutaway).toBe(true)
    expect(f.nv.opts.isClipAllVolumes).toBe(false)
    expect(f.uniform).toHaveBeenLastCalledWith('overlays', 1)
    f.viewer.dispose()
  })

  it('leaves the native clip plane unchanged after Cut is off and does not alter 2D slicing', () => {
    const f = renderer(), original = f.nv.scene.clipPlaneDepthAziElevs
    f.nv.surfaceCutaway = undefined
    const draw = vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(function (this: Niivue) {
      expect(this.scene.clipPlaneDepthAziElevs).toBe(original)
      expect(this.opts.isClipPlanesCutaway).toBe(true)
      expect(this.opts.isClipAllVolumes).toBe(false)
    })
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    f.nv.surfaceCutaway = cut()
    vi.spyOn(Niivue.prototype, 'draw2DMain').mockImplementation(function (this: Niivue) {
      expect(this.scene.clipPlaneDepthAziElevs).toBe(original)
      expect(this.opts.isClipPlanesCutaway).toBe(true)
    })
    f.nv.draw2DMain([0, 0, 100, 100], 0)
    expect(draw).toHaveBeenCalledOnce()
    f.viewer.dispose()
  })
})
