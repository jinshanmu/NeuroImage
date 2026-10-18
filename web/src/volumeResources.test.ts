import { describe, expect, it, vi } from 'vitest'
import { NVDocument, NVImage, type NVMesh } from '@niivue/niivue'
import { refreshOverlayTextures, retainVolumeMetadata } from './volumeResources'

const image = (id: string) => Object.assign(Object.create(NVImage.prototype) as NVImage, { id, img: new Uint16Array([1, 2, 3]) })
const fixture = () => {
  const images = ['background', 'retired-overlay', 'current-overlay'].map(image)
  const document = new NVDocument(), mediaUrlMap = new Map<NVImage | NVMesh, string>()
  document.volumes = [...images]
  images.forEach((item, index) => {
    document.addImageOptions(item, {url:`/source/${index}.nii.gz`, name:item.id})
    mediaUrlMap.set(item, `/source/${index}.nii.gz`)
  })
  return { images, document, mediaUrlMap }
}

describe('native volume resource ownership', () => {
  it('refreshes label and probability overlays without rebuilding unchanged background samples', () => {
    const volumes=['background','labels','probability'].map(id=>Object.assign(image(id),{toRAS:[1]}))
    const viewer={volumes,refreshColormaps:vi.fn(),closePAQD:vi.fn(),refreshLayers:vi.fn(),drawScene:vi.fn()}
    const samples=volumes[0].img
    refreshOverlayTextures(viewer)
    expect(viewer.refreshLayers.mock.calls).toEqual([[volumes[1],1],[volumes[2],2]])
    expect(viewer.closePAQD).toHaveBeenCalledOnce()
    expect(viewer.drawScene).toHaveBeenCalledOnce()
    expect(volumes[0].img).toBe(samples)
  })
  it('releases a replaced image and repairs option indices without changing retained samples', () => {
    const view = fixture(), [background, retired, overlay] = view.images
    const options = view.document.getImageOptions(overlay), samples = overlay.img
    retainVolumeMetadata(view, [background, overlay])
    expect(view.mediaUrlMap.has(retired)).toBe(false)
    expect(view.mediaUrlMap.get(overlay)).toBe('/source/2.nii.gz')
    expect(view.document.getImageOptions(overlay)).toBe(options)
    expect(view.document.imageOptionsMap.get(overlay.id)).toBe(1)
    expect(view.document.getImageOptions(retired)).toBeNull()
    expect(overlay.img).toBe(samples)
  })
  it('releases all old image references when replacing backgrounds while preserving mesh sources', () => {
    const view = fixture(), mesh = {id:'surface'} as NVMesh
    view.mediaUrlMap.set(mesh, '/source/surface.obj')
    retainVolumeMetadata(view, [])
    expect([...view.mediaUrlMap.entries()]).toEqual([[mesh, '/source/surface.obj']])
    expect(view.document.imageOptionsArray).toEqual([])
    expect(view.document.imageOptionsMap.size).toBe(0)
  })
  it('does not invent URL options for an in-memory image and remains safe on repeated release', () => {
    const view = fixture(), local = image('in-memory')
    retainVolumeMetadata(view, [local])
    retainVolumeMetadata(view, [local])
    expect(view.mediaUrlMap.size).toBe(0)
    expect(view.document.imageOptionsArray).toEqual([])
    expect(local.img).toEqual(new Uint16Array([1, 2, 3]))
  })
})
