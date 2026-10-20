import { isCompressed, readHeader } from 'nifti-reader-js'
import { sparseMask } from './independentRegions'
import type { Volume } from './types'

/** Decode membership data without creating an image, histogram or GPU texture. */
export async function readSourceMask(buffer: ArrayBuffer, volume: Volume, expectedCount: number) {
  if (buffer.byteLength >= 8 && new DataView(buffer).getUint32(0, true) === 0x314d494e) {
    const count = new DataView(buffer).getUint32(4, true)
    if (count !== expectedCount || buffer.byteLength !== 8 + count * 4)
      throw Error('Source mask membership count disagrees with the package.')
    const indices = new Uint32Array(buffer, 8, count), voxels = volume.shape.reduce((a, b) => a * b, 1)
    for (let i = 0; i < count; i++)
      if (indices[i] >= voxels || (i > 0 && indices[i] <= indices[i - 1]))
        throw Error('Invalid source mask membership index.')
    return { indices, volume }
  }
  const data = isCompressed(buffer)
    ? await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : buffer
  const header = readHeader(data)
  if (volume.shape.some((size, axis) => header.dims[axis + 1] !== size) || header.dims.slice(4).some(size => size > 1))
    throw Error('Source mask dimensions disagree with the package.')
  const types = {2: Uint8Array, 4: Int16Array, 8: Int32Array, 16: Float32Array, 64: Float64Array, 256: Int8Array, 512: Uint16Array, 768: Uint32Array}
  const ArrayType = types[header.datatypeCode as keyof typeof types]
  if (!ArrayType || header.numBitsPerVoxel !== ArrayType.BYTES_PER_ELEMENT * 8) throw Error('Unsupported source mask datatype.')
  const count = volume.shape.reduce((a, b) => a * b, 1), offset = header.vox_offset, bytes = ArrayType.BYTES_PER_ELEMENT
  if (!Number.isSafeInteger(offset) || offset < 348 || offset + count * bytes > data.byteLength)
    throw Error('The source mask is truncated or has an invalid data offset.')
  let samples = data, start = offset
  const nativeLittleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1
  if (offset % bytes || (bytes > 1 && header.littleEndian !== nativeLittleEndian)) {
    samples = data.slice(offset, offset + count * bytes); start = 0
    if (bytes > 1 && header.littleEndian !== nativeLittleEndian) {
      const swapped = new Uint8Array(samples)
      for (let i = 0; i < swapped.length; i += bytes) swapped.subarray(i, i + bytes).reverse()
    }
  }
  return sparseMask(new ArrayType(samples, start, count), volume, expectedCount)
}
