import { describe, expect, it } from 'vitest'
import { triangleBounds } from './modelBounds'

describe('original model camera bounds', () => {
  it('keeps a distant unreferenced source vertex without letting it displace the visible surface', () => {
    const points = new Float32Array([-10, -20, 1604, 10, -20, 1604, 0, -3, 1624, -10, -28, 1148])
    const triangles = new Uint32Array([0, 1, 2]), original = points.slice()
    expect(triangleBounds(points, triangles)).toEqual([[-10, -20, 1604], [10, -3, 1624]])
    expect(points).toEqual(original)
    expect(triangleBounds(points, new Uint32Array([0, 1, 3]))?.[0][2]).toBe(1148)
  })
  it('does not invent bounds for empty or invalid triangle references', () => {
    expect(triangleBounds([0, 0, 0], [])).toBeNull()
    expect(triangleBounds([0, 0, 0], [2])).toBeNull()
    expect(triangleBounds([0, NaN, 0], [0])).toBeNull()
  })
})
