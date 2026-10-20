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
  it('avoids unused gradient work and permits explicitly enabled gradient rendering', () => {
    const gradient=vi.spyOn(Niivue.prototype,'gradientGL').mockImplementation(()=>{})
    const {viewer}=fixture()
    viewer.gradientTextureAmount=0;viewer.opts.gradientOpacity=0
    viewer.gradientGL({} as Parameters<Niivue['gradientGL']>[0])
    expect(gradient).not.toHaveBeenCalled()
    viewer.opts.gradientOpacity=.5
    viewer.gradientGL({} as Parameters<Niivue['gradientGL']>[0])
    expect(gradient).toHaveBeenCalledOnce()
  })
  it('uploads an image stack once while retaining image order and load callbacks', async () => {
    const upload = vi.spyOn(Niivue.prototype, 'updateGLVolume').mockImplementation(() => {})
    const {viewer, volume} = fixture(), labels = {id:'source-labels',img:new Uint16Array([0,1,2])} as NVImage
    viewer.volumes = []
    viewer.onImageLoaded = vi.fn()
    vi.spyOn(Niivue.prototype, 'addVolumesFromUrl').mockImplementation(async function (this: Niivue) {
      this.addVolume(volume); this.addVolume(labels)
      expect(upload).not.toHaveBeenCalled()
      return [volume, labels]
    })
    expect(await viewer.addVolumesFromUrl([])).toEqual([volume, labels])
    expect(viewer.volumes).toEqual([volume, labels])
    expect(viewer.back).toBe(volume)
    expect(viewer.overlays).toEqual([labels])
    expect(viewer.onImageLoaded).toHaveBeenCalledTimes(2)
    expect(upload).toHaveBeenCalledOnce()
  })

  it('restores ordinary volume updates after an image load fails', async () => {
    const upload = vi.spyOn(Niivue.prototype, 'updateGLVolume').mockImplementation(() => {})
    vi.spyOn(Niivue.prototype, 'addVolumesFromUrl').mockRejectedValue(Error('Unavailable image'))
    const {viewer} = fixture()
    await expect(viewer.addVolumesFromUrl([])).rejects.toThrow('Unavailable image')
    expect(upload).not.toHaveBeenCalled()
    viewer.updateGLVolume()
    expect(upload).toHaveBeenCalledOnce()
  })

  it('waits for palette preparation before uploading a complete image stack', async () => {
    const upload=vi.spyOn(Niivue.prototype,'updateGLVolume').mockImplementation(()=>{})
    const {viewer,volume}=fixture()
    vi.spyOn(Niivue.prototype,'addVolumesFromUrl').mockResolvedValue([volume])
    viewer.deferVolumeUploads=true
    await viewer.addVolumesFromUrl([])
    expect(upload).not.toHaveBeenCalled()
    viewer.deferVolumeUploads=false
    viewer.updateGLVolume()
    expect(upload).toHaveBeenCalledOnce()
  })

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
