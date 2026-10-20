import type { Niivue } from '@niivue/niivue'
import { MeshResourceNiivue } from './meshResources'
import type { Annotation, Vec3 } from './types'

type Slice = Niivue['screenSlices'][number]
type Projection = { matrix: Parameters<Niivue['draw3DLabels']>[0]; rect: number[] }

// Marker positions are user-authored RAS coordinates. A marker must never be
// projected onto an unrelated 2D slice, even when it is nearby in 3D space.
export function projectSliceMarker(position: Vec3, slice: Slice): [number, number] | null {
  const axes = [[0, 1, 2], [0, 2, 1], [1, 2, 0]][slice.axCorSag]
  if (!axes || slice.AxyzMxy.length < 5) return null
  const [x, y, z] = axes.map(axis => position[axis]), plane = slice.AxyzMxy
  const expected = plane[2] + plane[4] * (y - plane[1]) - plane[3] * (x - plane[0])
  if (Math.abs(z - expected) > .05) return null
  const fx = (x - slice.leftTopMM[0]) / slice.fovMM[0], fy = (y - slice.leftTopMM[1]) / slice.fovMM[1]
  if (![fx, fy].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return null
  const [left, top, width, height] = slice.leftTopWidthHeight
  return [left + fx * width, top + (1 - fy) * height]
}

/** Retained scene annotations using the pinned renderer's actual view matrices. */
export class TeachingNiivue extends MeshResourceNiivue {
  markers: Annotation[] = []
  showMarkers = true
  private markerProjection: Projection | null = null

  override draw3DLabels(...args: Parameters<Niivue['draw3DLabels']>) {
    if (args[1][2] > 0 && args[1][3] > 0) this.markerProjection = { matrix: args[0], rect: args[1] }
    super.draw3DLabels(...args)
  }

  override drawSceneCore() {
    // Resize and pending-load callbacks can arrive while a workspace unmounts.
    if (!this.canvas?.isConnected || this.canvas.clientWidth < 32 || this.canvas.clientHeight < 32) return
    this.markerProjection = null
    const result = super.drawSceneCore()
    if (!this.initialized || !this.showMarkers || !this.markers?.length) return result
    const gl = this.gl, viewport = gl.getParameter(gl.VIEWPORT), scissor = gl.getParameter(gl.SCISSOR_BOX)
    const depthEnabled = gl.isEnabled(gl.DEPTH_TEST), scissorEnabled = gl.isEnabled(gl.SCISSOR_TEST), blendEnabled = gl.isEnabled(gl.BLEND)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.SCISSOR_TEST)
    try {
      this.markers.forEach((marker, index) => {
        for (const slice of this.screenSlices) {
          const point = projectSliceMarker(marker.position_ras_mm, slice)
          if (point) this.drawTeachingMarker(point, slice.leftTopWidthHeight, index + 1)
        }
        const projection = this.markerProjection as Projection | null
        if (projection) {
          const point = this.calculateScreenPoint(marker.position_ras_mm, projection.matrix, projection.rect)
          const [left, top, width, height] = projection.rect
          if (point[3] > 0 && point[2] >= -1 && point[2] <= 1 && point[0] >= left && point[0] <= left + width && point[1] >= top && point[1] <= top + height)
            this.drawTeachingMarker([point[0], point[1]], projection.rect, index + 1)
        }
      })
    } finally {
      gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]); gl.scissor(scissor[0], scissor[1], scissor[2], scissor[3])
      if (depthEnabled) gl.enable(gl.DEPTH_TEST)
      if (!scissorEnabled) gl.disable(gl.SCISSOR_TEST)
      if (!blendEnabled) gl.disable(gl.BLEND)
    }
    return result
  }

  private drawTeachingMarker(point: number[], rect: number[], number: number) {
    let [left, top, width, height] = rect
    if (width < 0) { left += width; width = -width }
    if (width <= 0 || height <= 0) return
    this.gl.scissor(Math.round(left), Math.round(this.gl.canvas.height - top - height), Math.round(width), Math.round(height))
    const dpr = this.uiData.dpr || 1, radius = 6 * dpr, [x, y] = point
    this.drawCircle([x - radius - dpr, y - radius - dpr, 2 * (radius + dpr), 2 * (radius + dpr)], [0, 0, 0, 1], .5)
    this.drawCircle([x - radius, y - radius, 2 * radius, 2 * radius], [1, .78, .24, 1], .35)
    const labelX = x + radius + 10 * dpr
    this.drawTextBetween([labelX, y, labelX, y], String(number), .85, [1, .88, .57, 1])
  }
}
