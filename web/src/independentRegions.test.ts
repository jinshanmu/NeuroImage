import { describe, expect, it } from 'vitest'
import { centeredSlicePan, containsSourceVoxel, regionMemberships, sourceVoxel, sparseMask } from './independentRegions'
import type { Volume } from './types'

const volume: Volume = { id: 'mask', name: 'Generated asymmetric mask', kind: 'mask', file: 'mask.nii.gz', shape: [4, 5, 6],
  affine_ras_mm: [[-2, .3, .1, 9], [.2, 3, .4, -12], [.1, .2, 4, -8], [0, 0, 0, 1]], voxel_size_mm: [2, 3, 4], orientation: 'LAS', cal_min: 0, cal_max: 1 }
const world = (x: number, y: number, z: number) => volume.affine_ras_mm.slice(0, 3).map(row => row[0] * x + row[1] * y + row[2] * z + row[3]) as [number, number, number]

describe('native independent region memberships', () => {
  const values = new Uint8Array(120)
  values[1 + 4 * (2 + 5 * 3)] = 1
  const field = sparseMask(values, volume, 1)
  it('uses source voxel order with a reflected, oblique and sheared affine', () => {
    expect(sourceVoxel(world(1, 2, 3), volume).map(value => Number(value.toFixed(6)))).toEqual([1, 2, 3])
    expect(containsSourceVoxel(field, world(1, 2, 3))).toBe(true)
    expect(containsSourceVoxel(field, world(2, 2, 3))).toBe(false)
    expect(containsSourceVoxel(field, world(-1, 2, 3))).toBe(false)
    expect(containsSourceVoxel(field, world(1.4, 2, 3))).toBe(true)
    expect(containsSourceVoxel(field, world(1.6, 2, 3))).toBe(false)
    expect(field.indices.byteLength).toBe(4)
  })
  it('retains every simultaneous membership and excludes hidden regions', () => {
    const fields = new Map([['left', field], ['other', field]])
    expect(regionMemberships(fields, ['other', 'left'], world(1, 2, 3))).toEqual(['left', 'other'])
    expect(regionMemberships(fields, ['left'], world(1, 2, 3))).toEqual(['left'])
    expect(regionMemberships(fields, [], world(1, 2, 3))).toEqual([])
  })
  it('rejects nonbinary or inconsistent source masks', () => {
    expect(() => sparseMask(values, volume, 2)).toThrow('count')
    expect(() => sparseMask(new Uint8Array(119), volume, 1)).toThrow('dimensions')
    const invalid = Float32Array.from(values); invalid[0] = .35
    expect(() => sparseMask(invalid, volume, 1)).toThrow('binary')
  })
  it('centers the physical section projection without changing source coordinates', () => {
    const position = world(1, 2, 3), zoom = 3, pan = centeredSlicePan(volume, position, zoom)
    const center = world(1.5, 2, 2.5)
    expect(pan[3]).toBe(3)
    center.forEach((value, i) => expect((value - pan[i]) / zoom).toBeCloseTo(position[i], 10))
  })
})
