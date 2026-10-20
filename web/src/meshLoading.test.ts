import { expect, it } from 'vitest'
import { NVMesh } from '@niivue/niivue'
import { readPreparedMesh } from './meshLoading'

it('preserves all source coordinates, triangles and renderer normal bytes',()=>{
  const points=new Float32Array([0,0,0, 2,0,0, 0,3,0, 0,0,4])
  const triangles=new Uint32Array([0,1,2, 0,3,1, 0,2,3, 1,3,2]), color=[100,150,200,255]
  // This layout is the renderer's existing interleaved layout. The server
  // precomputes its normals; source points and triangle order stay unchanged.
  const vertices=NVMesh.prototype.generatePosNormClr.call({f32PerVertex:5} as NVMesh,points,triangles,new Uint8Array(color))
  const buffer=new ArrayBuffer(16+triangles.byteLength+vertices.byteLength)
  new Uint32Array(buffer,0,4).set([0x314d474e,4,4,20])
  new Uint32Array(buffer,16,triangles.length).set(triangles)
  new Uint8Array(buffer,16+triangles.byteLength).set(new Uint8Array(vertices.buffer))
  const decoded=readPreparedMesh(buffer,color)
  expect(decoded.points).toEqual(points)
  expect(decoded.triangles).toEqual(triangles)
  expect(decoded.vertices).toEqual(new Uint8Array(vertices.buffer))
  const encoded = new ArrayBuffer(16 + triangles.byteLength + points.length / 3 * 16)
  new Uint32Array(encoded,0,4).set([0x324d474e,4,4,16])
  const words = new Uint32Array(vertices.buffer)
  const streams = [triangles,...[0,1,2,3].map(axis=>Uint32Array.from({length:4},(_,i)=>words[i*5+axis]))]
  const output = new Uint32Array(encoded,16)
  let start = 0
  for (const stream of streams) {
    let previous = 0
    for (const value of stream) { output[start++] = (value - previous) >>> 0; previous = value }
  }
  const restored = readPreparedMesh(encoded,color)
  expect(restored.points).toEqual(points)
  expect(restored.triangles).toEqual(triangles)
  expect(restored.vertices).toEqual(new Uint8Array(vertices.buffer))
  expect(()=>readPreparedMesh(buffer.slice(0,-1),color)).toThrow('Truncated')
  new Uint32Array(buffer,16,1)[0]=4
  expect(()=>readPreparedMesh(buffer,color)).toThrow('triangle')
})
