import { describe, expect, it } from 'vitest'
import { depthSamplePixel, decodeSurfaceDepth } from './picking'

describe('native framebuffer depth coordinates', () => {
  const viewport = [100, 200, 400, 300]
  it('reads and unprojects the same pixel center at an offset viewport corner', () => {
    expect(depthSamplePixel([100.1, 500.1], 1000, viewport)).toEqual({x:100,y:499,fx:.5/400,fy:299.5/300})
    expect(depthSamplePixel([499.9, 799.9], 1000, viewport)).toEqual({x:499,y:200,fx:399.5/400,fy:.5/300})
  })
  it('keeps subpixel pointer positions within a pixel on one physical sample', () => {
    expect(depthSamplePixel([260.01, 620.01], 1000, viewport)).toEqual(depthSamplePixel([260.99, 620.99], 1000, viewport))
  })
  it('rejects a sample outside the selected viewport', () => {
    for (const point of [[99.9, 600],[500,600],[200,499.9],[200,800],[NaN,620]]) expect(depthSamplePixel(point,1000,viewport)).toBeNull()
  })
})

describe('integer source depth', () => {
  it('decodes byte boundaries without the UNORM 255/256 bias', () => {
    expect(decodeSurfaceDepth([0, 0, 0, 0])).toBe(0)
    expect(decodeSurfaceDepth([255, 255, 255, 0])).toBe(1)
    expect(decodeSurfaceDepth([128, 0, 0, 0])).toBeCloseTo(.5, 6)
    expect(decodeSurfaceDepth([0, 1, 0, 0])).toBe(256 / 16777215)
  })
  it('rejects background, overlay and volume identification pixels', () => {
    expect(decodeSurfaceDepth([12, 32, 55, 255])).toBeNull()
    expect(decodeSurfaceDepth([12, 32, 55, 254])).toBeNull()
  })
})
