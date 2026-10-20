// Compare cached GPU inputs to the pinned original GIFTI decoder.
// Usage: node scripts/verify_browser_cache.mjs packages.json /ssd/state/browser-cache/v2
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { NVMesh, NVMeshLoaders } from '@niivue/niivue'
import { readPreparedMesh } from '../web/src/meshLoading.ts'

const packages = JSON.parse(readFileSync(process.argv[2], 'utf8')), cache = process.argv[3]
const arrayBuffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
let checked = 0
for (const record of packages) {
  const manifest = JSON.parse(readFileSync(record.manifest, 'utf8'))
  let meshes = 0, vertices = 0, triangles = 0
  for (const asset of manifest.assets.filter(asset => asset.role === 'mesh' && asset.path.endsWith('.gii'))) {
    const original = readFileSync(join(dirname(record.manifest), asset.path))
    if (createHash('sha256').update(original).digest('hex') !== asset.sha256) throw Error('Changed source: ' + asset.path)
    const source = await NVMeshLoaders.readGII(arrayBuffer(original))
    const decoded = readPreparedMesh(arrayBuffer(gunzipSync(readFileSync(join(cache, asset.sha256 + '.ngm')))), [255,255,255,255])
    const same = (a,b) => Buffer.from(a.buffer,a.byteOffset,a.byteLength).equals(Buffer.from(b.buffer,b.byteOffset,b.byteLength))
    if (!same(decoded.points,source.positions) || !same(decoded.triangles,source.indices))
      throw Error('Source geometry changed: ' + record.dataset_id + '/' + asset.path)
    const renderer = NVMesh.prototype.generatePosNormClr.call({f32PerVertex:5}, source.positions, source.indices, new Uint8Array([255,255,255,255]))
    if (!same(decoded.vertices,renderer)) throw Error('Renderer normals changed: ' + record.dataset_id + '/' + asset.path)
    meshes++; vertices += source.positions.length / 3; triangles += source.indices.length / 3
  }
  checked += meshes
  console.log(JSON.stringify({dataset:record.dataset_id,meshes,vertices,triangles,exact:true}))
}
console.log(JSON.stringify({status:'passed',meshes:checked}))
