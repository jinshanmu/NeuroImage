export interface CanvasPointer {
  button: number
  clientX: number
  clientY: number
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** Pick the released pixel, independently of native drag bookkeeping and hover. */
export function pickCanvas3D(viewer: {
  mousePos: number[]
  uiData: { isDragging: boolean; mouseDepthPicker?: boolean }
  drawScene?: () => unknown
  resetBriCon?: (event: MouseEvent) => void
}, canvas: HTMLCanvasElement, event: MouseEvent): void {
  const rect = canvas.getBoundingClientRect()
  if (!(rect.width > 0 && rect.height > 0)) return
  const x = (event.clientX - rect.left) * canvas.width / rect.width
  const y = (event.clientY - rect.top) * canvas.height / rect.height
  if (![x, y].every(Number.isFinite) || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
  viewer.mousePos = [x, y]
  const dragging = viewer.uiData.isDragging
  // The workspace release listener runs before the renderer's mouseup listener.
  // Our own gesture already rejected orbit drags; a native drag-mode flag must
  // not discard the remaining stationary click or its later double click.
  viewer.uiData.isDragging = false
  try {
    if (viewer.drawScene) {
      // resetBriCon's render branch draws the full scene twice. Our pointer
      // is already validated, and the first scene includes the depth pass and
      // its native normal redraw, so submit only that scene.
      const picking = viewer.uiData.mouseDepthPicker
      viewer.uiData.mouseDepthPicker = true
      try { viewer.drawScene() }
      catch (error) { viewer.uiData.mouseDepthPicker = picking; throw error }
    } else viewer.resetBriCon?.(event)
  }
  finally { viewer.uiData.isDragging = dragging }
}

const plainLeftClick = (event: CanvasPointer) => event.button === 0 &&
  !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey

/** Separate a discrete slice click from navigation gestures in CSS pixels. */
export class SliceClickGesture {
  private start: { x: number; y: number; visible: string[] } | null = null
  private released: { x: number; y: number; visible: string[] } | null = null

  begin(event: CanvasPointer, visible: string[], eligible: boolean): void {
    this.cancel()
    if (!eligible || !plainLeftClick(event) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
    this.start = { x: event.clientX, y: event.clientY, visible: [...visible] }
  }

  move(event: Pick<CanvasPointer, 'clientX' | 'clientY'>): void {
    const anchor = this.start ?? this.released
    if (!anchor) return
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) ||
      Math.hypot(event.clientX - anchor.x, event.clientY - anchor.y) > 4) this.cancel()
  }

  finish(event: CanvasPointer): string[] | null {
    this.move(event)
    const start = this.start
    this.start = null
    this.released = start && plainLeftClick(event)
      ? { x: event.clientX, y: event.clientY, visible: start.visible } : null
    return this.released ? [...this.released.visible] : null
  }

  finishDoubleClick(event: CanvasPointer & { detail: number }): string[] | null {
    this.move(event)
    const released = this.released
    this.cancel()
    return released && event.detail >= 2 && plainLeftClick(event) ? [...released.visible] : null
  }

  cancel(): void { this.start = null; this.released = null }
}

/** Use visibility before pointer-down, even if location callbacks already added the hit. */
export function toggleCanvasStructure(visible: string[], id: string, wasVisible: boolean): {
  selected: string | null; visible: string[]
} {
  return wasVisible
    ? { selected: null, visible: visible.filter(item => item !== id) }
    : { selected: id, visible: [...new Set([...visible, id])] }
}
