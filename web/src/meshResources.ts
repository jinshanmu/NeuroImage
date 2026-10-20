import { Niivue } from '@niivue/niivue'

/** Keep original image textures when only the source mesh collection changes. */
export class MeshResourceNiivue extends Niivue {
  private changingMesh = false
  private loadingVolumes = false

  override async addVolumesFromUrl(...args: Parameters<Niivue['addVolumesFromUrl']>) {
    this.loadingVolumes = true
    let volumes
    try { volumes = await super.addVolumesFromUrl(...args) }
    finally { this.loadingVolumes = false }
    // Preserve NiiVue's image order, callbacks and URL bookkeeping, but upload
    // the complete image stack once instead of rebuilding it for each image.
    this.updateGLVolume()
    return volumes
  }

  override setMesh(...args: Parameters<Niivue['setMesh']>) {
    this.changingMesh = true
    try { super.setMesh(...args) } finally { this.changingMesh = false }
  }

  override updateGLVolume() {
    if (this.loadingVolumes) return
    if (!this.changingMesh) { super.updateGLVolume(); return }
    // NiiVue 0.69.0 setMesh rebuilds all volume textures and gradients. Mesh
    // insertion, removal and ordering need only palettes, bounds and a redraw.
    // Keep its mesh bookkeeping, callbacks and GPU resource disposal unchanged.
    this.refreshColormaps()
    this.furthestVertexFromOrigin = this.volumes.length ? this.volumeObject3D?.furthestVertexFromOrigin ?? 0 : 0
    for (const mesh of this.meshes) this.furthestVertexFromOrigin = Math.max(this.furthestVertexFromOrigin, mesh.furthestVertexFromOrigin)
    // The workspace applies visibility, opacity and view bounds before drawing.
    // Drawing here would render an intermediate hidden mesh on every insertion.
  }
}
