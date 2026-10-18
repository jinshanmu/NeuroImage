import { describe, expect, it } from 'vitest'
import { sectionPolygon, SECTION_PLANES } from './sectionPlanes'
import type { Vec3, Volume } from './types'

const volume: Pick<Volume, 'shape' | 'affine_ras_mm'> = {
  shape: [2, 3, 4], affine_ras_mm: [[-2, 0, 0, 10], [0, 3, 0, 20], [0, 0, 4, 30], [0, 0, 0, 1]],
}

describe('physical section guides', () => {
  it('uses voxel faces, source units and a left-right reversed affine', () => {
    const polygon = sectionPolygon(volume, [9, 20, 32], 'sagittal')
    expect(polygon).toHaveLength(4)
    expect(polygon.every(point => point[0] === 9)).toBe(true)
    expect(polygon.map(point => point[1]).sort()).toEqual([18.5, 18.5, 27.5, 27.5])
    expect(polygon.map(point => point[2]).sort()).toEqual([28, 28, 44, 44])
    expect(sectionPolygon(volume, [11.01, 20, 32], 'sagittal')).toEqual([])
    expect(sectionPolygon(volume, [11, 20, 32], 'sagittal')).toHaveLength(4)
  })
  it.each(SECTION_PLANES)('keeps the %s guide on the physical cursor plane', plane => {
    const axis = { sagittal: 0, coronal: 1, axial: 2 }[plane]
    const cursor: Vec3 = [8.75, 23.2, 39.4]
    const original = structuredClone({ volume, cursor })
    const polygon = sectionPolygon(volume, cursor, plane)
    expect(polygon).toHaveLength(4)
    polygon.forEach(point => expect(point[axis]).toBeCloseTo(cursor[axis], 10))
    expect({ volume, cursor }).toEqual(original)
  })
  it('clips an oblique source to six true edge intersections rather than an axis-aligned bounding box', () => {
    const a = 1 / Math.sqrt(2), b = 1 / Math.sqrt(6), c = 1 / Math.sqrt(3)
    const oblique = { shape: [2, 2, 2] as Vec3, affine_ras_mm: [[a, -a, 0, 10], [b, b, -2 * b, -20], [c, c, c, 5], [0, 0, 0, 1]] }
    const polygon = sectionPolygon(oblique, [10, -20, 5 + 1.5 * c], 'axial')
    expect(polygon).toHaveLength(6)
    for (const point of polygon) {
      expect(point[2]).toBeCloseTo(5 + 1.5 * c, 10)
      // The inverse of this rigid rotation is its transpose.
      const voxel = [0, 1, 2].map(i => point.reduce((sum, value, j) => sum + oblique.affine_ras_mm[j][i] * (value - oblique.affine_ras_mm[j][3]), 0))
      expect(voxel.every(value => value >= -.5000001 && value <= 1.5000001)).toBe(true)
      expect(voxel.filter(value => Math.min(Math.abs(value + .5), Math.abs(value - 1.5)) < 1e-7)).toHaveLength(2)
    }
    expect(sectionPolygon(oblique, [10, -20, 5 - 1.5 * c], 'axial')).toEqual([])
  })
})
