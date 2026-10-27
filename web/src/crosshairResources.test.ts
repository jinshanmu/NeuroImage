import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Niivue } from '@niivue/niivue'
import { CrosshairResources } from './crosshairResources'
import { AtlasViewer } from './viewer'
import type { Manifest } from './types'

beforeEach(() => vi.stubGlobal('window', { devicePixelRatio: 1 }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture() {
  let serial = 0
  const gl = {
    ARRAY_BUFFER: 1, ELEMENT_ARRAY_BUFFER: 2, STATIC_DRAW: 3, FLOAT: 4, TRIANGLES: 5, UNSIGNED_INT: 6,
    CULL_FACE: 7, DEPTH_TEST: 8, BLEND: 9, LEQUAL: 10, ALWAYS: 11, SRC_ALPHA: 12, ONE_MINUS_SRC_ALPHA: 13,
    createBuffer: vi.fn(() => ({ id: ++serial })), createVertexArray: vi.fn(() => ({ id: ++serial })),
    bindBuffer: vi.fn(), bufferData: vi.fn(), bindVertexArray: vi.fn(), enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(), deleteBuffer: vi.fn(), deleteVertexArray: vi.fn(), uniformMatrix4fv: vi.fn(),
    disable: vi.fn(), enable: vi.fn(), depthFunc: vi.fn(), blendFunc: vi.fn(), uniform4fv: vi.fn(), drawElements: vi.fn(),
  }
  const viewer = new Niivue({ show3Dcrosshair: true, crosshairWidth: 1 })
  Object.defineProperty(viewer, 'gl', { value: gl })
  viewer.surfaceShader = { use: vi.fn(), uniforms: {} } as unknown as NonNullable<Niivue['surfaceShader']>
  let point = [12, 24, 36, 1]
  vi.spyOn(viewer, 'frac2mm').mockImplementation(() => Float32Array.from(point))
  vi.spyOn(viewer, 'sceneExtentsMinMax').mockReturnValue([[0, 0, 0], [100, 100, 100], [100, 100, 100]])
  const resources = new CrosshairResources()
  const matrix = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const draw = (is2D: boolean, width = is2D ? 1 : .4) => {
    viewer.opts.crosshairWidth = width
    resources.draw(viewer, is2D, width, () => viewer.drawCrosshairs3D(true, 1, matrix, is2D, true))
    return viewer.crosshairs3D!
  }
  return { viewer, gl, resources, draw, move: (next: number[]) => { point = [...next, 1] } }
}

describe('native crosshair resources for slice and 3D tiles', () => {
  it('integrates both caches into the atlas renderer, retains slice width and frees them on cleanup', () => {
    const f = fixture()
    const canvas = { addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement
    const manifest = { representation: 'mri-labels', structures: [], volumes: [] } as unknown as Manifest
    const nv = new AtlasViewer(canvas, manifest, '', () => {}, () => {}).nv
    Object.defineProperty(nv, 'gl', { value: f.gl })
    nv.surfaceShader = f.viewer.surfaceShader
    nv.opts.crosshairWidth = 1; nv.opts.show3Dcrosshair = true
    nv.fitting3D = true; nv.scene.volScaleMultiplier = 2.5; nv.fitting3D = false
    vi.spyOn(nv, 'frac2mm').mockImplementation(() => Float32Array.from([12, 24, 36, 1]))
    vi.spyOn(nv, 'sceneExtentsMinMax').mockReturnValue([[0, 0, 0], [100, 100, 100], [100, 100, 100]])
    const matrix = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    for (let i = 0; i < 30; i++) {
      nv.drawCrosshairs3D(true, 1, matrix, true)
      nv.drawCrosshairs3D(false, .15, matrix, true)
      nv.drawCrosshairs3D(true, 1, matrix)
      nv.drawCrosshairs3D(false, .15, matrix)
      expect(nv.opts.crosshairWidth).toBe(1)
    }
    expect(f.gl.createBuffer).toHaveBeenCalledTimes(4)
    expect(f.gl.createVertexArray).toHaveBeenCalledTimes(2)
    expect(f.gl.deleteBuffer).not.toHaveBeenCalled()
    const beforePick = f.gl.drawElements.mock.calls.length
    nv.uiData.mouseDepthPicker = true
    nv.drawCrosshairs3D(true, 1, matrix)
    nv.drawCrosshairs3D(false, .15, matrix)
    expect(f.gl.drawElements).toHaveBeenCalledTimes(beforePick)
    // The ordinary pass restores the visual cursor without rebuilding it.
    nv.uiData.mouseDepthPicker = false
    nv.drawCrosshairs3D(true, 1, matrix)
    expect(f.gl.drawElements).toHaveBeenCalledTimes(beforePick + 1)
    expect(f.gl.createBuffer).toHaveBeenCalledTimes(4)
    nv.opts.show3Dcrosshair = false; nv.opts.crosshairWidth = 0
    const draws = f.gl.drawElements.mock.calls.length
    nv.drawCrosshairs3D(true, 1, matrix)
    nv.drawCrosshairs3D(true, 1, matrix, true)
    expect(f.gl.drawElements).toHaveBeenCalledTimes(draws)
    nv.opts.show3Dcrosshair = true; nv.opts.crosshairWidth = 1
    nv.drawCrosshairs3D(true, 1, matrix)
    nv.drawCrosshairs3D(true, 1, matrix, true)
    expect(f.gl.createBuffer).toHaveBeenCalledTimes(4)
    expect(f.gl.deleteBuffer).not.toHaveBeenCalled()
    vi.spyOn(Niivue.prototype, 'cleanup').mockImplementation(() => {})
    nv.cleanup()
    expect(f.gl.deleteBuffer).toHaveBeenCalledTimes(4)
    expect(f.gl.deleteVertexArray).toHaveBeenCalledTimes(2)
    expect(nv.crosshairs3D).toBeNull()
  })

  it('reuses both real native cylinder geometries across unchanged-cursor overlay redraws', () => {
    const f = fixture()
    const slices = f.draw(true), surface = f.draw(false)
    expect(slices).not.toBe(surface)
    const sliceVertices = f.gl.bufferData.mock.calls[0][1] as Float32Array
    const surfaceVertices = f.gl.bufferData.mock.calls[2][1] as Float32Array
    expect(sliceVertices).not.toEqual(surfaceVertices)
    for (let i = 0; i < 30; i++) {
      expect(f.draw(true)).toBe(slices)
      expect(f.draw(false)).toBe(surface)
    }
    expect(Array.from(slices.mm!)).toEqual([12, 24, 36, 1])
    expect(Array.from(surface.mm!)).toEqual([12, 24, 36, 1])
    expect(f.gl.createBuffer).toHaveBeenCalledTimes(4)
    expect(f.gl.createVertexArray).toHaveBeenCalledTimes(2)
    expect(f.gl.deleteBuffer).not.toHaveBeenCalled()
    expect(f.gl.deleteVertexArray).not.toHaveBeenCalled()
    expect(f.gl.drawElements).toHaveBeenCalledTimes(62)
  })

  it('rebuilds only the zoom-dependent 3D geometry when its width changes', () => {
    const f = fixture(), slices = f.draw(true), surface = f.draw(false)
    expect(f.draw(false, .2)).not.toBe(surface)
    expect(f.draw(true)).toBe(slices)
    expect(f.gl.createBuffer).toHaveBeenCalledTimes(6)
    expect(f.gl.deleteBuffer.mock.calls.map(call => call[0])).toEqual([surface.indexBuffer, surface.vertexBuffer])
    expect(f.gl.deleteVertexArray).toHaveBeenCalledExactlyOnceWith(surface.vao)
  })

  it('moves both representations to the source cursor and releases every replaced VAO', () => {
    const f = fixture(), slices = f.draw(true), surface = f.draw(false)
    f.move([13, 25, 37])
    const nextSlices = f.draw(true), nextSurface = f.draw(false)
    expect(nextSlices).not.toBe(slices)
    expect(nextSurface).not.toBe(surface)
    expect(Array.from(nextSlices.mm!)).toEqual([13, 25, 37, 1])
    expect(Array.from(nextSurface.mm!)).toEqual([13, 25, 37, 1])
    expect(f.gl.deleteBuffer).toHaveBeenCalledTimes(4)
    expect(f.gl.deleteVertexArray.mock.calls.map(call => call[0])).toEqual([slices.vao, surface.vao])
  })

  it('propagates native volume/width invalidation to both cached representations', () => {
    const f = fixture(), slices = f.draw(true), surface = f.draw(false)
    f.viewer.crosshairs3D!.mm![0] = Number.NaN
    expect(f.draw(true)).not.toBe(slices)
    expect(f.draw(false)).not.toBe(surface)
    expect(f.gl.createBuffer).toHaveBeenCalledTimes(8)
    expect(f.gl.deleteBuffer).toHaveBeenCalledTimes(4)
    expect(f.gl.deleteVertexArray).toHaveBeenCalledTimes(2)
  })

  it('frees both owned mode caches once, including the object currently installed in Niivue', () => {
    const f = fixture(), slices = f.draw(true), surface = f.draw(false)
    f.resources.dispose(f.viewer)
    f.resources.dispose(f.viewer)
    expect(f.viewer.crosshairs3D).toBeNull()
    expect(f.gl.deleteBuffer.mock.calls.map(call => call[0])).toEqual([
      slices.indexBuffer, slices.vertexBuffer, surface.indexBuffer, surface.vertexBuffer,
    ])
    expect(f.gl.deleteVertexArray.mock.calls.map(call => call[0])).toEqual([slices.vao, surface.vao])
  })

  it('adopts an existing native object and does not duplicate native buffer deletion', () => {
    const f = fixture()
    f.viewer.drawCrosshairs3D(true, 1, Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), true, true)
    const previous = f.viewer.crosshairs3D!
    f.draw(true)
    expect(f.gl.deleteBuffer.mock.calls.map(call => call[0])).toEqual([previous.indexBuffer, previous.vertexBuffer])
    expect(f.gl.deleteVertexArray).toHaveBeenCalledExactlyOnceWith(previous.vao)
    f.resources.dispose(f.viewer)
    expect(new Set(f.gl.deleteBuffer.mock.calls.map(call => call[0])).size).toBe(4)
    expect(f.gl.deleteBuffer).toHaveBeenCalledTimes(4)
  })
})
