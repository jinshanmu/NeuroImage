import { Niivue } from '@niivue/niivue'

/** Keep original image textures when only the source mesh collection changes. */
export class MeshResourceNiivue extends Niivue {
  private changingMesh = false

  override setMesh(...args: Parameters<Niivue['setMesh']>) {
    this.changingMesh = true
    try { super.setMesh(...args) } finally { this.changingMesh = false }
  }

  override updateGLVolume() {
    if (!this.changingMesh) { super.updateGLVolume(); return }
    // NiiVue 0.69.0 setMesh rebuilds all volume textures and gradients. Mesh
    // insertion, removal and ordering need only palettes, bounds and a redraw.
    // Keep its mesh bookkeeping, callbacks and GPU resource disposal unchanged.
    this.refreshColormaps()
    this.furthestVertexFromOrigin = this.volumes.length ? this.volumeObject3D?.furthestVertexFromOrigin ?? 0 : 0
    for (const mesh of this.meshes) this.furthestVertexFromOrigin = Math.max(this.furthestVertexFromOrigin, mesh.furthestVertexFromOrigin)
    this.drawScene()
  }
}
