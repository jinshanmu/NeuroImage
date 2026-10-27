import { describe, expect, it } from 'vitest'
import { fitBoundsZoom, focusStructure3D, FULL_CONTEXT_3D_SCALE, viewZoom3D, zoomFactor, zoomFactor3D, zoomScale3D } from './display'
import type { Structure, ViewState, Volume } from './types'

describe('shared displayed magnification', () => {
  it('uses 1–10 in tenths and rejects nonfinite slider or wheel values', () => {
    expect([0, 1, 1.24, 1.25, 4.36, 10, 20].map(zoomFactor)).toEqual([1, 1, 1.2, 1.3, 4.4, 10, 10])
    for (const value of [NaN, Infinity, -Infinity]) expect(zoomFactor(value)).toBe(1)
  })

  it('multiplies the unzoomed camera base once and reverses actual camera scale to the factor', () => {
    expect(zoomScale3D(FULL_CONTEXT_3D_SCALE, 1)).toBe(.8)
    expect(zoomScale3D(FULL_CONTEXT_3D_SCALE, 2)).toBe(1.6)
    expect(zoomScale3D(3.4, 2)).toBe(6.8)
    expect(zoomFactor3D(6.8, 3.4)).toBe(2)
    expect(zoomScale3D(20, 10)).toBe(200)
    expect(zoomFactor3D(200, 20)).toBe(10)
  })

  it('keeps the displayed factor independent of changing fitted camera values', () => {
    const state: Pick<ViewState, 'camera' | 'zoom3D' | 'fitVisible3D'> = { camera: [110, 15, 2.7], zoom3D: 1, fitVisible3D: true }
    expect(viewZoom3D(state)).toBe(1)
    expect(viewZoom3D({ ...state, camera: [120, 20, 4.8] })).toBe(1)
    expect(viewZoom3D({ ...state, zoom3D: 4.3 })).toBe(4.3)
  })

  it('adapts the legacy control readout without mutating the historical camera or fitting flag', () => {
    const state: Pick<ViewState, 'camera' | 'zoom3D' | 'fitVisible3D'> = { camera: [110, 15, 2] }
    const before = JSON.stringify(state)
    expect(viewZoom3D(state)).toBe(2.5)
    expect(viewZoom3D({ ...state, fitVisible3D: true })).toBe(1)
    expect(JSON.stringify(state)).toBe(before)
    expect(state).not.toHaveProperty('zoom3D')
  })
})

describe('source structure framing', () => {
  it('fits physical bounds around their center while preserving viewing angles', () => {
    const structure = { bounds_ras_mm: [[-38.5, -45.5, -29.5], [-10.5, -5.5, 8.5]], target_ras_mm: [-28, -29, -15] } as Structure
    const image = { shape: [193, 229, 97], voxel_size_mm: [1, 1, 2] } as Volume
    const original = JSON.stringify(structure)
    const view = focusStructure3D(structure, image, [110, 15, .65])
    expect(view.focus3D).toEqual([-24.5, -25.5, -10.5])
    expect(view.camera).toEqual([110, 15, 4.58])
    expect(Object.keys(view).sort()).toEqual(['camera', 'focus3D'])
    expect(JSON.stringify(structure)).toBe(original)
  })
})

describe('complete 3D framing', () => {
  it('leaves a margin around a projected object and respects the depth planes', () => {
    const bounds: [[number, number, number], [number, number, number]] = [[-4, -1, -6], [4, 1, 6]]
    const matrix = [.1, -.1, 0, 0, .1, .1, 0, 0, 0, 0, .08, 0, 0, 0, -.55, 1]
    const zoom = fitBoundsZoom(bounds, matrix)
    for (const x of [-4, 4]) for (const y of [-1, 1]) for (const z of [-6, 6]) {
      expect(Math.abs((.1 * x + .1 * y) * zoom)).toBeLessThanOrEqual(.9)
      expect(Math.abs((-.1 * x + .1 * y) * zoom)).toBeLessThanOrEqual(.9)
      expect(Math.abs(-.55 + .08 * z * zoom)).toBeLessThanOrEqual(.960001)
    }
    expect(zoom).toBeGreaterThan(.8)
  })
})
