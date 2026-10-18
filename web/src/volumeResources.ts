import { NVImage, type Niivue } from '@niivue/niivue'

/** Overlay visibility and opacity do not change the original background image. */
export function refreshOverlayTextures(viewer: Pick<Niivue, 'volumes' | 'refreshColormaps' | 'closePAQD' | 'refreshLayers' | 'drawScene'>) {
  viewer.refreshColormaps()
  viewer.closePAQD()
  let layer = 0
  for (const volume of viewer.volumes) {
    if (!volume.toRAS) continue
    if (layer > 0) viewer.refreshLayers(volume, layer)
    layer++
  }
  viewer.drawScene()
}

// NiiVue 0.69.0 keeps loaded image objects in a strong URL map even after
// loadVolumes replaces its volume list. Its removeVolume also leaves document
// options behind. Retain only active images while preserving mesh URL entries.
export function retainVolumeMetadata(viewer: Pick<Niivue, 'document' | 'mediaUrlMap'>, volumes: NVImage[]) {
  const active = new Set(volumes)
  for (const item of viewer.mediaUrlMap.keys()) {
    if (item instanceof NVImage && !active.has(item)) viewer.mediaUrlMap.delete(item)
  }
  const document = viewer.document
  const options = volumes.map(image => ({ image, options: document.getImageOptions(image) }))
  document.imageOptionsArray.length = 0
  document.imageOptionsMap.clear()
  for (const entry of options) {
    if (!entry.options) continue
    document.imageOptionsMap.set(entry.image.id, document.imageOptionsArray.length)
    document.imageOptionsArray.push(entry.options)
  }
}
