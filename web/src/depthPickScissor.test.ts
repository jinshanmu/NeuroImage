import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NVMesh } from '@niivue/niivue'
import { SourceDepthNiivue } from './depthRenderer'
import { StreamlineNiivue } from './streamlineRenderer'

beforeEach(() => { vi.stubGlobal('window', { devicePixelRatio: 1 }) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture(enabled = false, originalBox = [10, 20, 90, 80]) {
  let box = [...originalBox]
  let clearColor = [.1, .2, .3, .4]
  const pixels = new Uint8Array(100 * 100 * 4)
  for (let index = 0; index < pixels.length; index += 4) pixels.set([11, 22, 33, 254], index)
  const flags = new Set<number>(enabled ? [3, 4] : [4])
  const gl = {
    VIEWPORT: 1, SCISSOR_BOX: 2, SCISSOR_TEST: 3, DITHER: 4, COLOR_CLEAR_VALUE: 5, COLOR_BUFFER_BIT: 16,
    canvas: { width: 100, height: 100 },
    getParameter: vi.fn((name: number) => name === 1 ? [20, 40, 50, 50] : name === 5 ? [...clearColor] : [...box]),
    isEnabled: vi.fn((flag: number) => flags.has(flag)),
    enable: vi.fn((flag: number) => { flags.add(flag) }),
    disable: vi.fn((flag: number) => { flags.delete(flag) }),
    scissor: vi.fn((x: number, y: number, width: number, height: number) => { box = [x, y, width, height] }),
    clearColor: vi.fn((r: number, g: number, b: number, a: number) => { clearColor = [r, g, b, a] }),
    clear: vi.fn(() => {
      const clip = flags.has(3) ? box : [0, 0, 100, 100]
      for (let y = clip[1]; y < clip[1] + clip[3]; y++) {
        for (let x = clip[0]; x < clip[0] + clip[2]; x++) pixels.set(clearColor.map(value => Math.round(value * 255)), (y * 100 + x) * 4)
      }
    }),
  }
  const nv = new SourceDepthNiivue()
  nv.gl = gl as unknown as WebGL2RenderingContext
  nv.mousePos = [32.8, 25.2]
  nv.uiData.mouseDepthPicker = true
  return { nv, gl, box: () => box, enabled: () => flags.has(3), clearColor: () => clearColor,
    pixel: (x: number, y: number) => Array.from(pixels.slice((y * 100 + x) * 4, (y * 100 + x + 1) * 4)) }
}

describe('single-pixel 3D depth rasterization', () => {
  it('clears only the released pixel to the opaque no-hit sentinel instead of retaining a previous volume-like alpha', () => {
    const f = fixture()
    expect(f.pixel(32, 74)).toEqual([11, 22, 33, 254])
    f.nv.clearDepthPickPixel()
    expect(f.pixel(32, 74)).toEqual([0, 0, 0, 255])
    expect(f.pixel(31, 74)).toEqual([11, 22, 33, 254])
    expect(f.pixel(32, 75)).toEqual([11, 22, 33, 254])
    expect(f.gl.clear).toHaveBeenCalledExactlyOnceWith(f.gl.COLOR_BUFFER_BIT)
    expect(f.clearColor()).toEqual([.1, .2, .3, .4])
    expect(f.box()).toEqual([10, 20, 90, 80]); expect(f.enabled()).toBe(false)
  })

  it('validates against framebuffer dimensions rather than the previous tile viewport when clearing', () => {
    const f = fixture()
    f.nv.mousePos = [2.2, 2.2]
    f.nv.clearDepthPickPixel()
    expect(f.pixel(2, 97)).toEqual([0, 0, 0, 255])
    f.gl.clear.mockClear()
    for (const pointer of [[-1, 20], [100, 20], [20, -1], [20, 100], [NaN, 20]]) {
      f.nv.mousePos = pointer
      f.nv.clearDepthPickPixel()
    }
    f.nv.mousePos = [32, 25]; f.nv.uiData.mouseDepthPicker = false
    f.nv.clearDepthPickPixel()
    expect(f.gl.clear).not.toHaveBeenCalled()
  })

  it('respects and restores an existing scissor while initializing the no-hit pixel', () => {
    const included = fixture(true, [30, 70, 10, 10])
    included.nv.clearDepthPickPixel()
    expect(included.pixel(32, 74)).toEqual([0, 0, 0, 255])
    expect(included.box()).toEqual([30, 70, 10, 10]); expect(included.enabled()).toBe(true)
    const excluded = fixture(true, [40, 75, 10, 10])
    excluded.nv.clearDepthPickPixel()
    expect(excluded.pixel(32, 74)).toEqual([11, 22, 33, 254])
    expect(excluded.box()).toEqual([40, 75, 10, 10]); expect(excluded.enabled()).toBe(true)
  })

  it.each([false, true])('restores clear color and scissor after a failing clear with scissor initially %s', enabled => {
    const f = fixture(enabled)
    f.gl.clear.mockImplementation(() => { throw Error('clear failed') })
    expect(() => f.nv.clearDepthPickPixel()).toThrow('clear failed')
    expect(f.clearColor()).toEqual([.1, .2, .3, .4])
    expect(f.box()).toEqual([10, 20, 90, 80]); expect(f.enabled()).toBe(enabled)
  })

  it('limits picking to the same exact bottom-origin pixel used by the depth read and restores the full view', () => {
    const f = fixture(), draw = vi.fn(() => {
      expect(f.box()).toEqual([32, 74, 1, 1])
      expect(f.enabled()).toBe(true)
      return 'picked'
    })
    expect(f.nv.withDepthPickScissor(draw)).toBe('picked')
    expect(draw).toHaveBeenCalledOnce()
    expect(f.box()).toEqual([10, 20, 90, 80])
    expect(f.enabled()).toBe(false)
  })

  it('keeps an existing scissor enabled and intersects the target with that clip', () => {
    const f = fixture(true, [30, 70, 10, 10])
    f.nv.withDepthPickScissor(() => { expect(f.box()).toEqual([32, 74, 1, 1]) })
    expect(f.box()).toEqual([30, 70, 10, 10]); expect(f.enabled()).toBe(true)
    const excluded = fixture(true, [40, 75, 10, 10])
    excluded.nv.withDepthPickScissor(() => { expect(excluded.box()).toEqual([40, 75, 0, 0]) })
    expect(excluded.box()).toEqual([40, 75, 10, 10]); expect(excluded.enabled()).toBe(true)
  })

  it('restores all scissor state when the depth draw fails', () => {
    const f = fixture()
    expect(() => f.nv.withDepthPickScissor(() => { throw Error('depth failed') })).toThrow('depth failed')
    expect(f.box()).toEqual([10, 20, 90, 80]); expect(f.enabled()).toBe(false)
    const clipped = fixture(true)
    expect(() => clipped.nv.withDepthPickScissor(() => {
      clipped.gl.disable(clipped.gl.SCISSOR_TEST)
      throw Error('depth failed')
    })).toThrow('depth failed')
    expect(clipped.box()).toEqual([10, 20, 90, 80]); expect(clipped.enabled()).toBe(true)
  })

  it('does not touch scissor state during normal rendering or for an invalid viewport sample', () => {
    const f = fixture(), draw = vi.fn(() => 42)
    f.nv.uiData.mouseDepthPicker = false
    expect(f.nv.withDepthPickScissor(draw)).toBe(42)
    expect(f.gl.getParameter).not.toHaveBeenCalled(); expect(f.gl.scissor).not.toHaveBeenCalled()
    f.nv.uiData.mouseDepthPicker = true; f.nv.mousePos = [0, 0]
    expect(f.nv.withDepthPickScissor(draw)).toBe(42)
    expect(f.gl.scissor).not.toHaveBeenCalled()
  })

  it('scopes mesh depth rasterization and restores the normal shader, dither and full viewport', () => {
    const f = fixture(), original = { program: 'native-pick' }, packed = { program: 'packed-depth' }
    f.nv.pickingMeshShader = original as unknown as typeof f.nv.pickingMeshShader
    f.nv.meshes = [{ id: 'surface' } as NVMesh]
    vi.spyOn(f.nv, 'createCustomMeshShader').mockReturnValue({ shader: packed } as unknown as ReturnType<SourceDepthNiivue['createCustomMeshShader']>)
    const native = vi.spyOn(StreamlineNiivue.prototype, 'drawMesh3D').mockImplementation(function (this: StreamlineNiivue) {
      expect(f.box()).toEqual([32, 74, 1, 1]); expect(f.enabled()).toBe(true)
      expect(f.gl.isEnabled(f.gl.DITHER)).toBe(false)
      expect(this.pickingMeshShader).toBe(packed)
    })
    f.nv.drawMesh3D()
    expect(native).toHaveBeenCalledOnce()
    expect(f.nv.pickingMeshShader).toBe(original)
    expect(f.gl.isEnabled(f.gl.DITHER)).toBe(true)
    expect(f.box()).toEqual([10, 20, 90, 80]); expect(f.enabled()).toBe(false)
  })

  it('does not compile an unused mesh depth shader for categorical volume-only scenes', () => {
    const f = fixture(), shader = vi.spyOn(f.nv, 'createCustomMeshShader')
    const native = vi.spyOn(StreamlineNiivue.prototype, 'drawMesh3D').mockImplementation(() => {})
    f.nv.drawMesh3D()
    expect(native).toHaveBeenCalledOnce(); expect(shader).not.toHaveBeenCalled()
    expect(f.gl.scissor).not.toHaveBeenCalled()
  })
})
