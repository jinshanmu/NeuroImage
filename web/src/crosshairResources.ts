import type { Niivue } from '@niivue/niivue'

type Crosshair = NonNullable<Niivue['crosshairs3D']>
type Viewer = Pick<Niivue, 'crosshairs3D' | 'gl'>
type Entry = { object: Crosshair | null; width: number }

/** Native slice and 3D cursors have different widths but share source coordinates. */
export class CrosshairResources {
  private entries = new Map<boolean, Entry>()
  private dirty = new WeakSet<Crosshair>()

  draw<T>(viewer: Viewer, is2D: boolean, width: number, draw: () => T): T {
    const resident = viewer.crosshairs3D
    // Native volume/width setters invalidate the currently installed object.
    // Their geometry changes also apply to the other cached representation.
    if (resident?.mm && Number.isNaN(resident.mm[0]) && !this.dirty.has(resident)) {
      for (const { object } of this.entries.values()) this.invalidate(object)
    }
    let entry = this.entries.get(is2D)
    if (!entry) {
      // Adopt an object made before our first draw, so it is released normally.
      entry = { object: this.entries.size ? null : resident, width: Number.NaN }
      this.entries.set(is2D, entry)
    }
    viewer.crosshairs3D = entry.object
    if (entry.width !== width) this.invalidate(entry.object)
    const before = viewer.crosshairs3D
    try { return draw() }
    finally {
      const after = viewer.crosshairs3D
      if (before !== after && before) {
        // NiiVue 0.69 deletes both buffers when regenerating, but leaks its VAO.
        if (before.vao) viewer.gl.deleteVertexArray(before.vao)
        this.dirty.delete(before)
      }
      if (after?.mm && !Number.isNaN(after.mm[0])) this.dirty.delete(after)
      entry.object = after
      entry.width = width
    }
  }

  private invalidate(object: Crosshair | null) {
    if (!object?.mm) return
    object.mm[0] = Number.NaN
    this.dirty.add(object)
  }

  dispose(viewer: Viewer) {
    const objects = new Set([...this.entries.values()].map(entry => entry.object))
    objects.add(viewer.crosshairs3D)
    viewer.crosshairs3D = null
    this.entries.clear()
    this.dirty = new WeakSet()
    // Native cleanup only removes listeners; these two mode caches own their GL resources.
    for (const object of objects) if (object) {
      viewer.gl.deleteBuffer(object.indexBuffer)
      viewer.gl.deleteBuffer(object.vertexBuffer)
      if (object.vao) viewer.gl.deleteVertexArray(object.vao)
    }
  }
}
