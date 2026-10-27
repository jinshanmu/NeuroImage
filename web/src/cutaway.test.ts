import { describe, expect, it } from 'vitest'
import { cursorCutaway, cutawayAtCursor, cutawayPlane, removedByCutaway, validateCutaway } from './cutaway'
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
  it('starts a following plane at the physical cursor with an independent target list', () => {
    const position: [number, number, number] = [-3, 8, 15], structures = ['skull','skull']
    const cut = cutawayAtCursor(position, structures)
    position[2] = 99; structures.push('nerve')
    expect(cut).toEqual({axis:2,side:1,position_mm:15,structures:['skull'],followCursor:true})
    expect(validateCutaway(cut, new Set(['skull']))).toBe(true)
  })
  it.each([0, 1, 2] as const)('follows the precise physical cursor along axis %s without changing targets or direction', axis => {
    const cut = { ...cutawayAtCursor([0, 0, 0], ['skull'], axis), side: -1 as const }
    const position = [1.123456789, -8.234567891, 3.345678912]
    const resolved = cursorCutaway(cut, position)!
    expect(resolved).toEqual({ ...cut, position_mm: position[axis] })
    expect(cut.position_mm).toBe(0)
    expect(resolved.structures).toBe(cut.structures)
    expect(cursorCutaway(resolved, position)).toBe(resolved)
  })
  it.each([undefined, false])('keeps legacy and explicitly fixed planes stationary: %s', followCursor => {
    const cut: SurfaceCutaway = { axis: 2, side: 1, position_mm: 12, structures: ['skull'], ...(followCursor === false ? { followCursor } : {}) }
    expect(cursorCutaway(cut, [4, 8, 90])).toBe(cut)
    expect(validateCutaway(cut, new Set(['skull']))).toBe(true)
    expect(cursorCutaway(undefined, [4, 8, 90])).toBeUndefined()
  })
  it('rejects invalid directions, unknown structures and nonfinite planes', () => {
    const cut = cutawayAtCursor([0, 0, 0], ['skull']), ids = new Set(['skull'])
    for (const change of [{axis:3},{axis:'2'},{side:0},{position_mm:NaN},{position_mm:Infinity},{position_mm:1e30},{structures:[]},{structures:['skull','skull']},{structures:['nerve']},{followCursor:'yes'},{followCursor:null},{followCursor:1},{unexpected:true}])
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
