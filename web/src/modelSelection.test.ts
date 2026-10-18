import { describe, expect, it } from 'vitest'
import { pickModelSurface, triangleDistanceSquared } from './modelSelection'
import type { Vec3 } from './types'

describe('native model picking',()=>{
  it('selects the interior of a large triangle, far from its vertices',()=>{
    const pts=new Float32Array([0,0,0,100,0,0,0,100,0]),tris=new Uint32Array([0,1,2])
    expect(triangleDistanceSquared([30,30,.02],[0,0,0],[100,0,0],[0,100,0])).toBeCloseTo(.0004)
    expect(pickModelSurface([30,30,.02],new Map([['coarse',{pts,tris,visible:true,opacity:1}]]),new Map(),null)).toBe('coarse')
    expect(triangleDistanceSquared([80,80,0],[0,0,0],[100,0,0],[0,100,0])).toBeCloseTo(1800)
  })
  it('rejects hidden, transparent and clipped source geometry',()=>{
    const mesh={pts:new Float32Array([0,0,0,4,0,0,0,4,0]),tris:new Uint32Array([0,1,2]),visible:true,opacity:1}
    const bounds=new Map<string,[Vec3,Vec3]>([['a',[[0,0,0],[4,4,0]]]])
    expect(pickModelSurface([1,1,0],new Map([['a',{...mesh,visible:false}]]),bounds,null)).toBeNull()
    expect(pickModelSurface([1,1,0],new Map([['a',{...mesh,opacity:0}]]),bounds,null)).toBeNull()
    expect(pickModelSurface([1,1,0],new Map([['a',mesh]]),bounds,null,()=>false)).toBeNull()
    expect(pickModelSurface([10,10,0],new Map([['a',mesh]]),bounds,null)).toBeNull()
  })
})
