import { describe, expect, it } from 'vitest'
import { cutawayAtCursor, cutawayPlane, removedByCutaway, validateCutaway } from './cutaway'
import type { SurfaceCutaway } from './types'
import { resolveSurfaceSelection } from './selection'

describe('source RAS surface cutaway', () => {
  it.each([0, 1, 2] as const)('preserves the native plane and either half-space on axis %s', axis => {
    for (const side of [-1, 1] as const) {
      const cut: SurfaceCutaway = { axis, side, position_mm: -12.5, structures: ['skull'] }, plane = cutawayPlane(cut)
      for (const distance of [-3, 0, 2.5]) {
        const point = [8, 14, -9]; point[axis] = cut.position_mm + distance
        expect(removedByCutaway(cut, 'skull', point)).toBe(distance * side > 0)
        expect(point.reduce((sum, value, i) => sum + value * plane[i], plane[3]) > 0).toBe(distance * side > 0)
        expect(removedByCutaway(cut, 'nerve', point)).toBe(false)
      }
    }
  })
  it('records an independent fixed plane and target list at the physical cursor', () => {
    const position: [number, number, number] = [-3, 8, 15], structures = ['skull','skull']
    const cut = cutawayAtCursor(position, structures)
    position[2] = 99; structures.push('nerve')
    expect(cut).toEqual({axis:2,side:1,position_mm:15,structures:['skull']})
    expect(validateCutaway(cut, new Set(['skull']))).toBe(true)
  })
  it('rejects invalid directions, unknown structures and nonfinite planes', () => {
    const cut = cutawayAtCursor([0, 0, 0], ['skull']), ids = new Set(['skull'])
    for (const change of [{axis:3},{axis:'2'},{side:0},{position_mm:NaN},{position_mm:Infinity},{position_mm:1e30},{structures:[]},{structures:['skull','skull']},{structures:['nerve']},{unexpected:true}])
      expect(validateCutaway({...cut,...change}, ids)).toBe(false)
    expect(validateCutaway(null, ids)).toBe(false)
  })
  it('excludes removed vertices and voxel fallbacks from 3D selection', () => {
    const cut = cutawayAtCursor([0, 0, 0], ['skull'], 0)
    const meshes: [string, {visible:boolean;pts:number[]}][] = [['skull',{visible:true,pts:[.1,0,0,-3,0,0]}],['nerve',{visible:true,pts:[.5,0,0]}]]
    const included = (id: string, point: ArrayLike<number>) => !removedByCutaway(cut, id, point)
    expect(resolveSurfaceSelection([.1,0,0], meshes, 'skull', 1, 'skull', included).selected).toBe('nerve')
    expect(resolveSurfaceSelection([.1,0,0], meshes.slice(0,1), 'skull', 1, 'skull', included).selected).toBeNull()
  })
})
