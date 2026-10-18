import { afterEach, describe, expect, it, vi } from 'vitest'
import { Niivue, NVDocument, type NVMesh, type NVImage } from '@niivue/niivue'
import { MeshResourceNiivue } from './meshResources'

afterEach(() => vi.restoreAllMocks())

function fixture() {
  const viewer = Object.create(MeshResourceNiivue.prototype) as MeshResourceNiivue
  viewer.document = new NVDocument()
  viewer.mediaUrlMap = new Map()
  viewer.refreshColormaps = vi.fn()
  viewer.drawScene = vi.fn()
  viewer.onMeshLoaded = vi.fn()
  viewer.onMeshRemoved = vi.fn()
  viewer.onMeshWithUrlRemoved = vi.fn()
  viewer['_emitEvent'] = vi.fn()
  Object.defineProperty(viewer, 'gl', {value:{}})
  const volume = {id:'source-image', img:new Uint16Array([1,2,3])} as NVImage
  viewer.volumes = [volume]
  viewer.volumeObject3D = {furthestVertexFromOrigin:100} as typeof viewer.volumeObject3D
  return {viewer,volume}
}

describe('mesh updates preserve image resources', () => {
  it('adds, reorders and removes original meshes without reuploading image textures', () => {
    const upload = vi.spyOn(Niivue.prototype, 'updateGLVolume').mockImplementation(() => {})
    const {viewer,volume} = fixture(), imageSamples = volume.img
    const mesh = (id:string, distance:number) => ({id,furthestVertexFromOrigin:distance,unloadMesh:vi.fn()}) as unknown as NVMesh
    const first=mesh('first',80), second=mesh('second',120)
    viewer.addMesh(first);viewer.addMesh(second)
    expect(viewer.meshes).toEqual([first,second])
    expect(viewer.furthestVertexFromOrigin).toBe(120)
    expect(viewer.onMeshLoaded).toHaveBeenCalledTimes(2)
    viewer.setMesh(second,0)
    expect(viewer.meshes).toEqual([second,first])
    viewer.mediaUrlMap.set(second,'/source/original.gii')
    viewer.removeMesh(second)
    expect(viewer.meshes).toEqual([first])
    expect(second.unloadMesh).toHaveBeenCalledOnce()
    expect(viewer.mediaUrlMap.has(second)).toBe(false)
    expect(viewer.furthestVertexFromOrigin).toBe(100)
    expect(viewer.volumes[0]).toBe(volume)
    expect(volume.img).toBe(imageSamples)
    expect(upload).not.toHaveBeenCalled()
    viewer.updateGLVolume()
    expect(upload).toHaveBeenCalledOnce()
  })

  it('returns to normal volume updates if a mesh refresh fails', () => {
    const upload=vi.spyOn(Niivue.prototype,'updateGLVolume').mockImplementation(()=>{})
    const {viewer}=fixture()
    viewer.refreshColormaps=vi.fn(()=>{throw Error('Unavailable GPU context')})
    expect(()=>viewer.setMesh({id:'absent'} as NVMesh)).toThrow('Unavailable GPU context')
    viewer.updateGLVolume()
    expect(upload).toHaveBeenCalledOnce()
  })
})
