import { describe, expect, it } from 'vitest'
import { cursorPlanePoint } from './cursorPlane'

const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])

describe('full-view cursor plane navigation', () => {
  it('locates all view corners at the current cursor depth, including outside image bounds', () => {
    for (const [x,y] of [[0,0],[0,1],[1,0],[1,1],[.2,.8]]) {
      const point = cursorPlanePoint(x,y,[4,-3,.25],identity)!
      expect(point[0]).toBeCloseTo(x*2-1)
      expect(point[1]).toBeCloseTo(y*2-1)
      expect(point[2]).toBeCloseTo(.25)
    }
  })

  it('follows the rotated camera plane rather than a fixed anatomical axis', () => {
    const rotateY = new Float32Array([0,0,-1,0, 0,1,0,0, 1,0,0,0, 0,0,0,1])
    const point = cursorPlanePoint(.75,.25,[12,4,-3],rotateY)!
    expect(point[0]).toBeCloseTo(12)
    expect(point[1]).toBeCloseTo(-.5)
    expect(point[2]).toBeCloseTo(.5)
  })

  it('retains cursor depth with perspective projection and camera translation', () => {
    const perspective = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,-1.2,-1, 0,0,-2.2,0])
    const point = cursorPlanePoint(.75,.25,[0,0,-10],perspective)!
    expect(point[0]).toBeCloseTo(5)
    expect(point[1]).toBeCloseTo(-5)
    expect(point[2]).toBeCloseTo(-10)
  })

  it('rejects nonfinite transforms and a plane at infinite projection depth', () => {
    expect(cursorPlanePoint(NaN,.5,[0,0,0],identity)).toBeNull()
    expect(cursorPlanePoint(.5,.5,[Infinity,0,0],identity)).toBeNull()
    expect(cursorPlanePoint(.5,.5,[0,0,0],new Float32Array(16))).toBeNull()
  })
})
