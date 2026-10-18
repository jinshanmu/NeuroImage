import { describe, expect, it } from 'vitest'
import { equalAnatomyPanels, fitBoundsZoom, focusStructure3D } from './display'
import type { Structure, Volume } from './types'

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

describe('equal anatomy panels and complete 3D framing', () => {
  it('keeps four equal nonoverlapping viewports in one row at every tested size', () => {
    for (const [width, height] of [[1566, 514], [1044, 538], [844, 478], [844, 1056], [1688, 956]]) {
      const panels = equalAnatomyPanels(width, height)
      expect(panels).toHaveLength(4)
      expect(panels.every(panel => panel[1] === 0 && panel[3] === height)).toBe(true)
      expect(panels.every(panel => panel[2] === panels[0][2] && panel[3] === panels[0][3])).toBe(true)
      expect(panels.reduce((area, panel) => area + panel[2] * panel[3], 0)).toBeCloseTo(width * height)
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        const a = panels[i], b = panels[j]
        expect(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1]).toBe(true)
      }
      expect(panels[3][0] + panels[3][2]).toBe(width)
    }
  })
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
