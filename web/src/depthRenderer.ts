import type { Niivue } from '@niivue/niivue'
import { StreamlineNiivue } from './streamlineRenderer'
import { depthSamplePixel } from './picking'

const depthFragment = `#version 300 es
precision highp int;
precision highp float;
uniform float opacity;
out vec4 color;
vec4 packFloatToVec4i(float depth) {
  uint value = uint(round(clamp(depth, 0.0, 1.0) * 16777215.0));
  return vec4(float((value >> 16u) & 255u), float((value >> 8u) & 255u), float(value & 255u), 0.0) / 255.0;
}
void main() { color = packFloatToVec4i(gl_FragCoord.z); }
`

/** Integer RGB depth survives the default framebuffer's 8-bit UNORM storage. */
export class SourceDepthNiivue extends StreamlineNiivue {
  private sourceDepthShader: ReturnType<Niivue['createCustomMeshShader']> | null = null
  private updatingMesh = false
  deferMeshUpdates = false
  private moveFrame: number | null = null
  private pendingMove: MouseEvent | null = null
  private batchingMove = false
  private moveDrawRequested = false
  private picking3D = false
  private interactionCanvas: HTMLCanvasElement | null = null
  private canvasFocus: { canvas: HTMLCanvasElement; original: PropertyDescriptor | undefined; wrapped: HTMLCanvasElement['focus'] } | null = null

  private restoreCanvasFocus() {
    const saved = this.canvasFocus
    this.canvasFocus = null
    if (!saved || saved.canvas.focus !== saved.wrapped) return
    if (saved.original) Object.defineProperty(saved.canvas, 'focus', saved.original)
    else Reflect.deleteProperty(saved.canvas, 'focus')
  }

  override registerInteractions() {
    this.interactionCanvas?.removeEventListener('mouseup', this.flushMouseMove, true)
    this.restoreCanvasFocus()
    this.interactionCanvas = this.canvas
    if (this.canvas) {
      const canvas = this.canvas, original = Object.getOwnPropertyDescriptor(canvas, 'focus'), focus = canvas.focus
      // Native click, drag and wheel handlers all focus the canvas. Scope the
      // no-scroll behavior to this element and restore its original method on
      // cleanup instead of changing HTMLElement or the page's scroll position.
      const wrapped: HTMLCanvasElement['focus'] = options => focus.call(canvas, { ...options, preventScroll: true })
      Object.defineProperty(canvas, 'focus', { configurable: true, writable: true, value: wrapped })
      this.canvasFocus = { canvas, original, wrapped }
    }
    // Workspace click handlers were registered before NiiVue's bubble listeners.
    // Apply the final drag position before those handlers inspect the cursor.
    this.interactionCanvas?.addEventListener('mouseup', this.flushMouseMove, true)
    super.registerInteractions()
  }

  override mouseMoveListener(event: MouseEvent) {
    // Drawing tools need the complete input path. Hover behavior stays immediate.
    if (!this.uiData.mousedown || this.opts.drawingEnabled || this.opts.clickToSegment) {
      this.flushMouseMove()
      super.mouseMoveListener(event)
      return
    }
    // Crossing a tile edge before the next frame must not replace the final
    // valid sample with a move that the native handler would reject.
    const position = this.getNoPaddingNoBorderCanvasRelativeMousePosition(event, this.gl.canvas)
    if (!position) return
    if (!this.eventInBounds(event)) {
      // 3D rotation deltas use mousePos. Consume an earlier valid point before
      // recording this later outside position, preserving native event order.
      this.flushMouseMove()
      this.updateMousePos(position.x, position.y)
      return
    }
    if (this.tileIndex(position.x * this.uiData.dpr!, position.y * this.uiData.dpr!) !== this.uiData.clickedTile) return
    this.pendingMove = event
    if (this.moveFrame === null) this.moveFrame = requestAnimationFrame(() => {
      this.moveFrame = null
      this.flushMouseMove()
    })
  }

  override mouseDownListener(event: MouseEvent) {
    // A fresh press must not replay an unfinished previous gesture.
    this.cancelMouseMove()
    const position = event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
      && !this.opts.drawingEnabled && !this.opts.clickToSegment && !this.uiData.mouseDepthPicker
      ? this.getNoPaddingNoBorderCanvasRelativeMousePosition(event, this.gl.canvas) : undefined
    const slice = position && this.screenSlices.find(tile => {
      const [left, top, width, height] = tile.leftTopWidthHeight
      const x = position.x * this.uiData.dpr!, y = position.y * this.uiData.dpr!
      return [0, 1, 2].includes(tile.axCorSag) && x >= left && x < left + width && y >= top && y < top + height
    })
    // A 2D press changes the cursor and then redraws again in the native outer
    // handler. Submit only the final scene; depth picking keeps its draw/read path.
    if (slice) this.batchSceneDraw(() => super.mouseDownListener(event))
    else if (position && !this.opts.bounds
      && this.inRenderTile(position.x * this.uiData.dpr!, position.y * this.uiData.dpr!) >= 0
      && !this.getLabelAtPoint([position.x * this.uiData.dpr!, position.y * this.uiData.dpr!])) {
      // An ordinary 3D press only initializes orbit bookkeeping. Keep the
      // native handler, but defer its unchanged image until movement/release.
      // A custom native action that changes the view still paints immediately.
      const before = this.pressVisualState()
      this.batchSceneDraw(() => super.mouseDownListener(event), () => {
        const after = this.pressVisualState()
        return after.length !== before.length || after.some((value, index) => !Object.is(value, before[index]))
      })
    } else super.mouseDownListener(event)
  }

  override mouseUpListener() {
    this.flushMouseMove()
    super.mouseUpListener()
  }

  override mouseLeaveListener() {
    this.flushMouseMove()
    super.mouseLeaveListener()
  }

  override drawScene(): string | void {
    if (this.batchingMove) { this.moveDrawRequested = true; return }
    // Match the pinned drawScene refresh/return path, submitting ordinary
    // frames without waiting for the GPU. Picking's readPixels is synchronous
    // where its result is needed; orbit and cursor draws need no finish fence.
    if (this.isBusy) { this.needsRefresh = true; return }
    this.isBusy = false
    this.needsRefresh = false
    let position = this.drawSceneCore()
    if (this._gl !== null) this.gl.flush()
    if (this.needsRefresh) position = this.drawScene()
    return position
  }

  override draw3D(...args: Parameters<Niivue['draw3D']>) {
    if (this.picking3D && !this.uiData.mouseDepthPicker) {
      // Native picking recursively repaints only 3D after moving the cursor.
      // Multiplanar 2D tiles were already painted with the old cursor. Request
      // one complete refresh instead: fresh 2D and one normal 3D color pass.
      this.needsRefresh = true
      return
    }
    if (!this.uiData.mouseDepthPicker) return super.draw3D(...args)
    const previous = this.picking3D
    this.picking3D = true
    try {
      if (!previous) this.clearDepthPickPixel()
      return super.draw3D(...args)
    }
    finally { this.picking3D = previous }
  }

  private flushMouseMove = () => {
    if (this.moveFrame !== null) cancelAnimationFrame(this.moveFrame)
    this.moveFrame = null
    const event = this.pendingMove
    this.pendingMove = null
    if (!event) return
    this.batchSceneDraw(() => super.mouseMoveListener(event))
  }

  private pressVisualState(): number[] {
    return [this.scene.renderAzimuth, this.scene.renderElevation, this.scene.volScaleMultiplier,
      ...this.pivot3D, ...this.scene.crosshairPos, ...this.scene.pan2Dxyzmm, ...this.scene.clipPlaneDepthAziElevs.flat()]
  }

  private batchSceneDraw(action: () => void, shouldDraw: () => boolean = () => true) {
    if (this.batchingMove) { action(); return }
    this.batchingMove = true
    this.moveDrawRequested = false
    try { action() }
    finally {
      this.batchingMove = false
      const draw = this.moveDrawRequested
      this.moveDrawRequested = false
      // The pinned move handler requests the complete scene several times.
      if (draw && shouldDraw()) this.drawScene()
    }
  }

  private cancelMouseMove() {
    if (this.moveFrame !== null) cancelAnimationFrame(this.moveFrame)
    this.moveFrame = null
    this.pendingMove = null
  }

  override setMesh(...args: Parameters<Niivue['setMesh']>) {
    this.updatingMesh = true
    try { super.setMesh(...args) } finally { this.updatingMesh = false }
  }

  override updateGLVolume() {
    if (!this.updatingMesh) { super.updateGLVolume(); return }
    // The pinned setMesh rebuilds every image texture. Mesh changes only need
    // updated geometric extents and a redraw; image data and LUTs are unchanged.
    this.furthestVertexFromOrigin = Math.max(this.volumeObject3D?.furthestVertexFromOrigin ?? 0,
      ...this.meshes.map(mesh => mesh.furthestVertexFromOrigin))
    if (!this.deferMeshUpdates) this.drawScene()
  }

  /** Only the released pixel contributes to a depth read; restore before the
   * native renderer recursively redraws the ordinary full view. */
  withDepthPickScissor<T>(draw: () => T): T {
    if (!this.uiData.mouseDepthPicker) return draw()
    const gl = this.gl
    const sample = depthSamplePixel(this.mousePos, gl.canvas.height, gl.getParameter(gl.VIEWPORT))
    if (!sample) return draw()
    return this.withPixelScissor(sample, draw)
  }

  /** Transparent no-hit fragments must not retain a normal frame's color,
   * whose alpha could accidentally look like a valid packed volume hit. */
  clearDepthPickPixel() {
    if (!this.uiData.mouseDepthPicker) return
    const gl = this.gl
    const sample = depthSamplePixel(this.mousePos, gl.canvas.height, [0, 0, gl.canvas.width, gl.canvas.height])
    if (!sample) return
    const clearColor = Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE) as ArrayLike<number>)
    this.withPixelScissor(sample, () => {
      try {
        gl.clearColor(0, 0, 0, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
      } finally { gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]) }
    })
  }

  private withPixelScissor<T>(sample: { x: number; y: number }, draw: () => T): T {
    const gl = this.gl
    const enabled = gl.isEnabled(gl.SCISSOR_TEST), box = Array.from(gl.getParameter(gl.SCISSOR_BOX) as ArrayLike<number>)
    let left = sample.x, bottom = sample.y, right = left + 1, top = bottom + 1
    if (enabled) {
      left = Math.max(left, box[0]); bottom = Math.max(bottom, box[1])
      right = Math.min(right, box[0] + box[2]); top = Math.min(top, box[1] + box[3])
    }
    try {
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(left, bottom, Math.max(0, right - left), Math.max(0, top - bottom))
      return draw()
    } finally {
      gl.scissor(box[0], box[1], box[2], box[3])
      if (enabled) gl.enable(gl.SCISSOR_TEST)
      else gl.disable(gl.SCISSOR_TEST)
    }
  }

  override drawMesh3D(...args: Parameters<Niivue['drawMesh3D']>) {
    if (!this.uiData.mouseDepthPicker || !this.meshes.length) { super.drawMesh3D(...args); return }
    const original = this.pickingMeshShader, dither = this.gl.isEnabled(this.gl.DITHER)
    try {
      this.sourceDepthShader ??= this.createCustomMeshShader(depthFragment, 'NeuroImage source depth')
      this.pickingMeshShader = this.sourceDepthShader.shader
      this.gl.disable(this.gl.DITHER)
      this.withDepthPickScissor(() => super.drawMesh3D(...args))
    } finally { this.pickingMeshShader = original; if (dither) this.gl.enable(this.gl.DITHER) }
  }

  override cleanup() {
    this.cancelMouseMove()
    this.interactionCanvas?.removeEventListener('mouseup', this.flushMouseMove, true)
    this.interactionCanvas = null
    this.restoreCanvasFocus()
    if (this.sourceDepthShader?.shader) {
      const program = this.sourceDepthShader.shader.program
      for (const shader of this.gl.getAttachedShaders(program) ?? []) this.gl.deleteShader(shader)
      this.gl.deleteProgram(program)
    }
    this.sourceDepthShader = null
    super.cleanup()
  }
}
