import { describe, expect, it } from 'vitest'
import { NIFTI1 } from 'nifti-reader-js'
import { gzipSync } from 'fflate'
import { readSourceMask } from './maskLoading'
import { containsSourceVoxel } from './independentRegions'
import type { Volume } from './types'

const volume: Volume = {id:'mask',name:'Independent source mask',file:'mask.nii.gz',kind:'mask',shape:[2,3,2],
  affine_ras_mm:[[-2,0,0,10],[0,3,0,20],[0,0,4,30],[0,0,0,1]],voxel_size_mm:[2,3,4],orientation:'LAS',cal_min:0,cal_max:1}
function fixture(type=2, littleEndian=true) {
  const header=new NIFTI1()
  Object.assign(header,{dims:[3,2,3,2,1,1,1,1],pixDims:[1,2,3,4,1,1,1,1],datatypeCode:type,
    numBitsPerVoxel:type===2?8:32,vox_offset:352,magic:'n+1\0',littleEndian,sform_code:1,affine:volume.affine_ras_mm})
  const data=new Uint8Array(352+12*(type===2?1:4))
  data.set(new Uint8Array(header.toArrayBuffer()))
  const values=new DataView(data.buffer)
  for (const index of [0,5,11]) {
    if(type===2) values.setUint8(352+index,1)
    else values.setFloat32(352+index*4,1,littleEndian)
  }
  return data.buffer
}
describe('direct source mask decoding',()=>{
  it('retains every sparse source membership and rejects invalid cached indices',async()=>{
    const data = new Uint32Array([0x314d494e,3,0,5,11])
    const mask = await readSourceMask(data.buffer,volume,3)
    expect([...mask.indices]).toEqual([0,5,11])
    expect(containsSourceVoxel(mask,[8,26,34])).toBe(true)
    await expect(readSourceMask(data.buffer,volume,4)).rejects.toThrow('count')
    await expect(readSourceMask(data.buffer.slice(0,-1),volume,3)).rejects.toThrow('count')
    for (const invalid of [[0,5,12],[0,5,5],[5,0,11]]) {
      data.set(invalid,2)
      await expect(readSourceMask(data.buffer,volume,3)).rejects.toThrow('index')
    }
  })
  it('keeps original memberships and affine after gzip decoding',async()=>{
    const bytes=gzipSync(new Uint8Array(fixture()))
    const mask=await readSourceMask(bytes.slice().buffer,volume,3)
    expect([...mask.indices]).toEqual([0,5,11])
    expect(containsSourceVoxel(mask,[8,26,34])).toBe(true)
    expect(containsSourceVoxel(mask,[10,23,34])).toBe(false)
  })
  it('reads little and big endian floating point binary masks without intensity calibration',async()=>{
    for(const little of [true,false]) expect([...(await readSourceMask(fixture(16,little),volume,3)).indices]).toEqual([0,5,11])
  })
  it('rejects nonbinary, truncated, incorrectly shaped and miscounted masks',async()=>{
    const invalid=fixture();new Uint8Array(invalid)[353]=2
    await expect(readSourceMask(invalid,volume,3)).rejects.toThrow('binary')
    await expect(readSourceMask(fixture().slice(0,-1),volume,3)).rejects.toThrow('truncated')
    await expect(readSourceMask(fixture(),{...volume,shape:[3,2,2]},3)).rejects.toThrow('dimensions')
    await expect(readSourceMask(fixture(),volume,4)).rejects.toThrow('count')
  })
})
