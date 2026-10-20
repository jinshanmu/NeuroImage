import { NVMesh, type Niivue } from '@niivue/niivue'

const prepared = new WeakMap<Float32Array, Uint8Array>()

class PreparedMesh extends NVMesh {
  override updateMesh(gl: WebGL2RenderingContext) {
    const vertices = prepared.get(this.pts)
    if (!vertices || this.f32PerVertex !== 5 || this.layers.length) return super.updateMesh(gl)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.tris!, gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
    this.indexCount = this.tris!.length
    this.vertexCount = this.pts.length
  }
}

export function readPreparedMesh(buffer: ArrayBuffer, color: number[]) {
  if (buffer.byteLength < 16) throw Error('Invalid browser mesh.')
  const header = new DataView(buffer)
  const delta = header.getUint32(0,true) === 0x324d474e
  if ((!delta && header.getUint32(0,true) !== 0x314d474e) || header.getUint32(12,true) !== (delta ? 16 : 20))
    throw Error('Invalid browser mesh.')
  const faces = header.getUint32(4,true), count = header.getUint32(8,true), offset = 16 + faces * 12
  if (count < 3 || buffer.byteLength !== offset + count * (delta ? 16 : 20)) throw Error('Truncated browser mesh.')
  const triangles = new Uint32Array(buffer,16,faces * 3)
  const vertices = delta ? new Uint8Array(count * 20) : new Uint8Array(buffer,offset)
  if (delta) {
    let previous = 0
    for (let i = 0; i < triangles.length; i++) triangles[i] = previous = (previous + triangles[i]) >>> 0
    const encoded = new Uint32Array(buffer,offset), words = new Uint32Array(vertices.buffer)
    for (let axis = 0; axis < 4; axis++) {
      previous = 0
      for (let i = 0; i < count; i++) words[i*5+axis] = previous = (previous + encoded[axis*count+i]) >>> 0
    }
  }
  const interleaved = new Float32Array(vertices.buffer,vertices.byteOffset,count * 5), points = new Float32Array(count * 3)
  for (let i = 0; i < triangles.length; i++) if (triangles[i] >= count) throw Error('Invalid browser triangle.')
  for (let i = 0; i < count; i++) {
    points[i*3] = interleaved[i*5]; points[i*3+1] = interleaved[i*5+1]; points[i*3+2] = interleaved[i*5+2]
    for (let axis = 0; axis < 4; axis++) vertices[i*20+16+axis] = color[axis]
  }
  return { points, triangles, vertices }
}

export function addPreparedMesh(nv: Niivue, buffer: ArrayBuffer, name: string, color: number[], opacity: number) {
  const {points,triangles,vertices} = readPreparedMesh(buffer,color)
  prepared.set(points,vertices)
  try {
    const mesh = new PreparedMesh(points,triangles,name,new Uint8Array(color),opacity,false,nv.gl)
    nv.addMesh(mesh)
    return mesh
  } finally { prepared.delete(points) }
}
