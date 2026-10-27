import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Niivue } from '@niivue/niivue'
import { SourceDepthNiivue } from './depthRenderer'

class InteractionCanvas {
  focus = vi.fn()
  private listeners = new Map<string, { callback: EventListener; capture: boolean }[]>()
  addEventListener(type: string, callback: EventListener, capture = false) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { callback, capture }])
  }
  removeEventListener(type: string, callback: EventListener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item.callback !== callback))
  }
  fire(type: string) {
    for (const item of [...(this.listeners.get(type) ?? [])].sort((a, b) => Number(b.capture) - Number(a.capture))) {
      item.callback({ type } as Event)
    }
  }
}

const move = (clientX: number, extra: Partial<MouseEvent> = {}) => ({ type: 'mousemove', clientX, clientY: 20,
  buttons: 1, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra }) as MouseEvent

let frames: Map<number, FrameRequestCallback>, nextFrame: number
const runFrame = () => {
  const queued = [...frames.values()]
  frames.clear()
  queued.forEach(callback => callback(16))
}

beforeEach(() => {
  frames = new Map(); nextFrame = 0
  vi.stubGlobal('window', { devicePixelRatio: 1 })
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id) }))
  vi.spyOn(Niivue.prototype, 'cleanup').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture() {
  const nv = new SourceDepthNiivue()
  nv.isBusy = false
  nv.uiData.mousedown = true
  nv.uiData.dpr = 1; nv.uiData.clickedTile = 0
  const canvas = { focus: vi.fn(), width: 100, height: 100 }
  nv.canvas = canvas as unknown as HTMLCanvasElement
  nv.gl = { canvas, flush: vi.fn() } as unknown as WebGL2RenderingContext
  vi.spyOn(nv, 'getNoPaddingNoBorderCanvasRelativeMousePosition').mockImplementation(event => ({ x: event.clientX, y: event.clientY }))
  vi.spyOn(nv, 'eventInBounds').mockReturnValue(true)
  vi.spyOn(nv, 'tileIndex').mockReturnValue(0)
  const draws = vi.spyOn(nv, 'drawSceneCore').mockReturnValue('drawn')
  // NiiVue 0.69's drag path draws before, during and after changing the cursor.
  const nativeMoves = vi.spyOn(Niivue.prototype, 'mouseMoveListener').mockImplementation(function (this: Niivue) {
    this.drawScene(); this.drawScene(); this.drawScene()
  })
  return { nv, draws, nativeMoves }
}

describe('native canvas drag rendering', () => {
  it('forces no-scroll focus in the actual native click handler', () => {
    const { nv } = fixture()
    const canvas = nv.canvas!, focus = vi.mocked(canvas.focus)
    Object.assign(canvas, { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.spyOn(Niivue.prototype, 'registerInteractions').mockImplementation(() => {})
    nv.registerInteractions()
    vi.spyOn(nv, 'inGraphTile').mockReturnValue(false)
    vi.spyOn(nv, 'inRenderTile').mockReturnValue(0)
    expect(nv.mouseClick(10, 20)).toBe(false)
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true })
    nv.cleanup()
    expect(canvas.focus).toBe(focus)
  })

  it('scopes all native focus calls to the active canvas and restores its original method', () => {
    const { nv } = fixture(), canvas = nv.canvas!, focus = vi.mocked(nv.canvas!.focus)
    Object.assign(canvas, { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const original = Object.getOwnPropertyDescriptor(canvas, 'focus')
    vi.spyOn(Niivue.prototype, 'registerInteractions').mockImplementation(() => {})
    nv.registerInteractions()
    canvas.focus(); canvas.focus({ preventScroll: false })
    expect(focus.mock.calls).toEqual([[{ preventScroll: true }], [{ preventScroll: true }]])
    nv.registerInteractions(); canvas.focus()
    expect(focus).toHaveBeenCalledTimes(3)
    nv.cleanup()
    expect(Object.getOwnPropertyDescriptor(canvas, 'focus')).toEqual(original)
  })

  function pressFixture(is2D = true) {
    const f = fixture()
    f.nv.screenSlices = [{ axCorSag: is2D ? 0 : f.nv.sliceTypeRender, leftTopWidthHeight: [0, 0, 100, 100] }] as typeof f.nv.screenSlices
    vi.spyOn(f.nv, 'getLabelAtPoint').mockReturnValue(null)
    const clicks = vi.spyOn(f.nv, 'mouseClick').mockImplementation(() => { f.nv.drawScene(); return true })
    const event = { ...move(10), type: 'mousedown', button: 0, preventDefault: vi.fn() } as unknown as MouseEvent
    return { ...f, clicks, event }
  }

  it('draws only once at the first 2D press using the actual native mouse-down handler', () => {
    const f = pressFixture()
    const down = vi.spyOn(Niivue.prototype, 'mouseDownListener')
    f.nv.mouseDownListener(f.event)
    expect(down).toHaveBeenCalledExactlyOnceWith(f.event)
    expect(f.clicks).toHaveBeenCalledExactlyOnceWith(10, 20)
    expect(f.nv.uiData.mouseButtonLeftDown).toBe(true)
    expect(f.nv.uiData.clickedTile).toBe(0)
    expect(f.draws).toHaveBeenCalledOnce()
  })

  it.each(['depth pick', 'drawing', 'segmentation'] as const)('preserves immediate native press draws for %s', mode => {
    const f = pressFixture()
    if (mode === 'depth pick') f.nv.uiData.mouseDepthPicker = true
    if (mode === 'drawing') f.nv.opts.drawingEnabled = true
    if (mode === 'segmentation') f.nv.opts.clickToSegment = true
    f.nv.mouseDownListener(f.event)
    expect(f.clicks).toHaveBeenCalledOnce()
    expect(f.draws).toHaveBeenCalledTimes(2)
  })

  it('initializes native orbit bookkeeping without repainting an unchanged plain 3D press', () => {
    const f = pressFixture(false)
    f.nv.uiData.mousedown = false
    const down = vi.spyOn(Niivue.prototype, 'mouseDownListener')
    f.nv.mouseDownListener(f.event)
    expect(down).toHaveBeenCalledExactlyOnceWith(f.event)
    expect(f.nv.uiData.mousedown).toBe(true)
    expect(f.nv.uiData.mouseButtonLeftDown).toBe(true)
    expect(f.nv.uiData.clickedTile).toBe(0)
    expect(f.nv.uiData.dragStart).toEqual([10, 20])
    expect(f.nv.uiData.dragEnd).toEqual([10, 20])
    expect(f.draws).not.toHaveBeenCalled()
    f.nv.mouseMoveListener(move(30)); runFrame()
    expect(f.nativeMoves).toHaveBeenCalledOnce()
    expect(f.draws).toHaveBeenCalledOnce()
  })

  it.each(['camera', 'cursor', 'pan'] as const)('paints a plain 3D press when the native action changes %s', setting => {
    const f = pressFixture(false)
    f.clicks.mockImplementation(() => {
      if (setting === 'camera') f.nv.scene.renderAzimuth += 10
      if (setting === 'cursor') f.nv.scene.crosshairPos = [.2, .3, .4]
      if (setting === 'pan') f.nv.scene.pan2Dxyzmm[0] += 5
      f.nv.drawScene(); return true
    })
    f.nv.mouseDownListener(f.event)
    expect(f.clicks).toHaveBeenCalledOnce()
    expect(f.draws).toHaveBeenCalledOnce()
  })

  it.each(['shiftKey', 'ctrlKey', 'altKey', 'metaKey'] as const)('keeps modified 3D press feedback immediate for %s', modifier => {
    const f = pressFixture(false)
    f.nv.mouseDownListener({ ...f.event, [modifier]: true })
    expect(f.draws).toHaveBeenCalled()
  })

  it('keeps native label actions and bounds feedback immediate', () => {
    const f = pressFixture(false), onClick = vi.fn(() => f.nv.drawScene())
    vi.mocked(f.nv.getLabelAtPoint).mockReturnValue({ onClick } as never)
    f.nv.mouseDownListener(f.event)
    expect(onClick).toHaveBeenCalledOnce()
    expect(f.clicks).not.toHaveBeenCalled()
    expect(f.draws).toHaveBeenCalledOnce()
    vi.mocked(f.nv.getLabelAtPoint).mockReturnValue(null)
    f.nv.opts.bounds = [[0, 0], [100, 100]]
    f.draws.mockClear()
    f.nv.mouseDownListener(f.event)
    expect(f.nv.opts.showBoundsBorder).toBe(true)
    expect(f.draws).toHaveBeenCalledTimes(2)
  })

  it('restores deferred drawing bookkeeping when a 3D press action throws', () => {
    const f = pressFixture(false)
    f.clicks.mockImplementation(() => { f.nv.drawScene(); throw Error('press failed') })
    expect(() => f.nv.mouseDownListener(f.event)).toThrow('press failed')
    expect(f.draws).not.toHaveBeenCalled()
    f.nv.drawScene()
    expect(f.draws).toHaveBeenCalledOnce()
  })

  it('defers the recursive post-pick 3D color pass to one complete scene refresh', () => {
    const f = fixture()
    f.nv.uiData.mouseDepthPicker = true
    const clear = vi.spyOn(f.nv, 'clearDepthPickPixel').mockImplementation(() => {})
    const native = vi.spyOn(Niivue.prototype, 'draw3D').mockImplementation(function (this: Niivue) {
      this.uiData.mouseDepthPicker = false
      this.draw3D([0, 0, 100, 100])
      return 'picked'
    })
    expect(f.nv.draw3D([0, 0, 100, 100])).toBe('picked')
    expect(native).toHaveBeenCalledOnce()
    expect(clear).toHaveBeenCalledOnce()
    expect(f.nv.needsRefresh).toBe(true)
    // Native drawScene consumes needsRefresh and then repaints the entire view.
    f.nv.needsRefresh = false
    native.mockImplementation(() => 'normal')
    expect(f.nv.draw3D([0, 0, 100, 100])).toBe('normal')
    expect(native).toHaveBeenCalledTimes(2)
    expect(clear).toHaveBeenCalledOnce()
    expect(f.nv.needsRefresh).toBe(false)
  })

  it('restores the picking recursion guard after a failed native 3D draw', () => {
    const f = fixture()
    f.nv.uiData.mouseDepthPicker = true
    vi.spyOn(f.nv, 'clearDepthPickPixel').mockImplementation(() => {})
    const native = vi.spyOn(Niivue.prototype, 'draw3D').mockImplementation(() => { throw Error('3D pick failed') })
    expect(() => f.nv.draw3D()).toThrow('3D pick failed')
    f.nv.uiData.mouseDepthPicker = false
    native.mockImplementation(() => 'normal')
    expect(f.nv.draw3D()).toBe('normal')
    expect(f.nv.needsRefresh).toBe(false)
  })

  it('collapses the pinned native mousemove redraws without replacing its drag logic', () => {
    const { nv, draws, nativeMoves } = fixture()
    nativeMoves.mockRestore()
    const actualMoves = vi.spyOn(Niivue.prototype, 'mouseMoveListener')
    const canvas = { focus: vi.fn(), width: 100, height: 100 }
    nv.canvas = canvas as unknown as HTMLCanvasElement
    nv.gl = { canvas, flush: vi.fn() } as unknown as WebGL2RenderingContext
    nv.uiData.dpr = 1; nv.uiData.clickedTile = 0
    nv.uiData.prevX = 0; nv.uiData.currX = 1
    vi.spyOn(nv, 'getNoPaddingNoBorderCanvasRelativeMousePosition').mockImplementation(event => ({ x: event.clientX, y: event.clientY }))
    vi.spyOn(nv, 'eventInBounds').mockReturnValue(true)
    vi.spyOn(nv, 'tileIndex').mockReturnValue(0)
    vi.spyOn(nv, 'inRenderTile').mockReturnValue(-1)
    vi.spyOn(nv, 'getCurrentDragMode').mockReturnValue(nv.opts.dragModePrimary)
    let previous = -1
    const clicks = vi.spyOn(nv, 'mouseClick').mockImplementation(x => {
      if (x === previous) return false
      previous = x; nv.drawScene()
      return true
    })
    nv.mouseMoveListener(move(10)); nv.mouseMoveListener(move(20)); nv.mouseMoveListener(move(30))
    runFrame()
    expect(actualMoves).toHaveBeenCalledOnce()
    expect(clicks).toHaveBeenCalledTimes(2)
    expect(previous).toBe(30)
    expect(draws).toHaveBeenCalledOnce()
  })

  it('consumes only the newest drag position and draws once per animation frame', () => {
    const { nv, draws, nativeMoves } = fixture()
    const last = move(30, { shiftKey: true })
    nv.mouseMoveListener(move(10)); nv.mouseMoveListener(move(20)); nv.mouseMoveListener(last)
    expect(frames.size).toBe(1)
    expect(nativeMoves).not.toHaveBeenCalled()
    expect(draws).not.toHaveBeenCalled()
    runFrame()
    expect(nativeMoves.mock.calls).toEqual([[last]])
    expect(draws).toHaveBeenCalledOnce()
    nv.mouseMoveListener(move(40)); nv.mouseMoveListener(move(50))
    runFrame()
    expect(nativeMoves.mock.calls.map(([event]) => event.clientX)).toEqual([30, 50])
    expect(draws).toHaveBeenCalledTimes(2)
  })

  it('retains the final valid sample when the pointer crosses a tile or bounds before the frame', () => {
    const { nv, nativeMoves } = fixture()
    vi.spyOn(nv, 'tileIndex').mockImplementation(x => x < 50 ? 0 : 1)
    vi.spyOn(nv, 'eventInBounds').mockImplementation(event => (event as MouseEvent).clientX < 100)
    nv.mouseMoveListener(move(30)); nv.mouseMoveListener(move(75)); nv.mouseMoveListener(move(110))
    runFrame()
    expect(nativeMoves.mock.calls.map(([event]) => event.clientX)).toEqual([30])
    nv.mouseMoveListener(move(75)); nv.mouseMoveListener(move(110))
    expect(frames.size).toBe(0)
  })

  it('applies queued 3D rotation before updating the later out-of-bounds mouse position', () => {
    const { nv, nativeMoves } = fixture(), previousPositions: number[] = []
    nv.mousePos = [0, 20]
    vi.spyOn(nv, 'eventInBounds').mockImplementation(event => (event as MouseEvent).clientX < 100)
    nativeMoves.mockImplementation(function (this: Niivue, event: MouseEvent) {
      previousPositions.push(this.mousePos[0])
      this.mousePos = [event.clientX, event.clientY]
      this.drawScene()
    })
    nv.mouseMoveListener(move(30)); nv.mouseMoveListener(move(110))
    expect(nativeMoves.mock.calls.map(([event]) => event.clientX)).toEqual([30])
    expect(previousPositions).toEqual([0])
    expect(nv.mousePos).toEqual([110, 20])
    expect(frames.size).toBe(0)
    runFrame()
    expect(nativeMoves).toHaveBeenCalledOnce()
  })

  it('flushes the release position before workspace click handlers and native mouseup', () => {
    const { nv, draws, nativeMoves } = fixture(), canvas = new InteractionCanvas(), order: string[] = []
    canvas.addEventListener('mouseup', () => { order.push('workspace'); expect(nativeMoves).toHaveBeenCalledWith(last) })
    nv.canvas = canvas as unknown as HTMLCanvasElement
    vi.spyOn(Niivue.prototype, 'registerInteractions').mockImplementation(function (this: Niivue) {
      this.canvas!.addEventListener('mouseup', () => this.mouseUpListener())
    })
    vi.spyOn(Niivue.prototype, 'mouseUpListener').mockImplementation(function (this: Niivue) {
      order.push('mouseup'); this.uiData.mousedown = false
    })
    nv.registerInteractions()
    const last = move(30)
    nv.mouseMoveListener(move(10)); nv.mouseMoveListener(last)
    canvas.fire('mouseup')
    expect(order).toEqual(['workspace', 'mouseup'])
    expect(nativeMoves).toHaveBeenCalledOnce()
    expect(draws).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
    runFrame()
    expect(nativeMoves).toHaveBeenCalledOnce()
  })

  it('also flushes programmatic mouseup and mouseleave before native state resets', () => {
    const { nv, nativeMoves } = fixture(), order: string[] = []
    nativeMoves.mockImplementation(function (this: Niivue, event: MouseEvent) {
      order.push(`move:${event.clientX}`); this.drawScene()
    })
    vi.spyOn(Niivue.prototype, 'mouseUpListener').mockImplementation(() => { order.push('up') })
    vi.spyOn(Niivue.prototype, 'mouseLeaveListener').mockImplementation(() => { order.push('leave') })
    nv.mouseMoveListener(move(10)); nv.mouseUpListener()
    nv.mouseMoveListener(move(20)); nv.mouseLeaveListener()
    expect(order).toEqual(['move:10', 'up', 'move:20', 'leave'])
    expect(frames.size).toBe(0)
  })

  it('discards a stale queued gesture before a new press', () => {
    const { nv, nativeMoves } = fixture(), down = move(40)
    const nativeDown = vi.spyOn(Niivue.prototype, 'mouseDownListener').mockImplementation(() => {})
    nv.mouseMoveListener(move(10)); nv.mouseDownListener(down)
    runFrame()
    expect(nativeDown).toHaveBeenCalledWith(down)
    expect(nativeMoves).not.toHaveBeenCalled()
  })

  it('cancels pending callbacks and removes its release listener during cleanup', () => {
    const { nv, nativeMoves } = fixture(), canvas = new InteractionCanvas()
    nv.canvas = canvas as unknown as HTMLCanvasElement
    vi.spyOn(Niivue.prototype, 'registerInteractions').mockImplementation(() => {})
    const remove = vi.spyOn(canvas, 'removeEventListener')
    nv.registerInteractions(); nv.mouseMoveListener(move(10)); nv.cleanup()
    expect(frames.size).toBe(0)
    expect(remove).toHaveBeenCalledWith('mouseup', expect.any(Function), true)
    canvas.fire('mouseup'); runFrame()
    expect(nativeMoves).not.toHaveBeenCalled()
  })

  it('keeps hover and drawing input immediate without dropping its path', () => {
    const { nv, nativeMoves } = fixture()
    nv.uiData.mousedown = false
    nv.mouseMoveListener(move(10))
    nv.uiData.mousedown = true; nv.opts.drawingEnabled = true
    nv.mouseMoveListener(move(20)); nv.mouseMoveListener(move(30))
    nv.opts.drawingEnabled = false; nv.opts.clickToSegment = true
    nv.mouseMoveListener(move(40))
    expect(nativeMoves.mock.calls.map(([event]) => event.clientX)).toEqual([10, 20, 30, 40])
    expect(frames.size).toBe(0)
  })

  it('keeps depth-pick passes and explicit captures synchronous while a drag is queued', () => {
    const { nv, draws, nativeMoves } = fixture()
    nv.mouseMoveListener(move(10))
    // resetBriCon requires two immediate passes to pick and then restore 3D.
    nv.opts.sliceType = nv.sliceTypeRender
    vi.spyOn(nv, 'eventInBounds').mockReturnValue(true)
    nv.resetBriCon()
    expect(draws).toHaveBeenCalledTimes(2)
    expect(nativeMoves).not.toHaveBeenCalled()
    // Capture must finish its explicit draw before reading the canvas pixels.
    expect(nv.drawScene()).toBe('drawn')
    expect(draws).toHaveBeenCalledTimes(3)
    runFrame()
    expect(draws).toHaveBeenCalledTimes(4)
  })

  it('restores ordinary synchronous rendering after a move handler fails', () => {
    const { nv, draws, nativeMoves } = fixture()
    nativeMoves.mockImplementation(function (this: Niivue) { this.drawScene(); throw Error('move failed') })
    nv.mouseMoveListener(move(10))
    expect(runFrame).toThrow('move failed')
    expect(draws).toHaveBeenCalledOnce()
    expect(nv.drawScene()).toBe('drawn')
  })
})

describe('nonblocking native scene submission', () => {
  it('retains the scene result and submits commands without a GPU completion fence', () => {
    const { nv, draws } = fixture()
    const finish = vi.fn()
    nv.gl.finish = finish
    expect(nv.drawScene()).toBe('drawn')
    expect(draws).toHaveBeenCalledOnce()
    expect(nv.gl.flush).toHaveBeenCalledOnce()
    expect(finish).not.toHaveBeenCalled()
  })

  it('preserves the native busy flag and complete refresh return path', () => {
    const { nv, draws } = fixture()
    nv.isBusy = true
    expect(nv.drawScene()).toBeUndefined()
    expect(nv.needsRefresh).toBe(true)
    expect(draws).not.toHaveBeenCalled(); expect(nv.gl.flush).not.toHaveBeenCalled()
    nv.isBusy = false
    draws.mockImplementationOnce(() => { nv.needsRefresh = true; return 'first' }).mockReturnValueOnce('refreshed')
    expect(nv.drawScene()).toBe('refreshed')
    expect(draws).toHaveBeenCalledTimes(2)
    expect(nv.gl.flush).toHaveBeenCalledTimes(2)
    expect(nv.needsRefresh).toBe(false)
  })

  it('keeps synchronous pick readback inside its scene before returning', () => {
    const { nv, draws } = fixture(), order: string[] = []
    nv.gl.flush = vi.fn(() => order.push('flush'))
    nv.gl.readPixels = vi.fn(() => { order.push('read'); nv.selectedObjectId = nv.VOLUME_ID })
    draws.mockImplementationOnce(() => { nv.gl.readPixels(0, 0, 1, 1, 0, 0, new Uint8Array(4)); return 'picked' })
    const result = nv.drawScene()
    order.push('returned')
    expect(result).toBe('picked'); expect(nv.selectedObjectId).toBe(nv.VOLUME_ID)
    expect(order).toEqual(['read', 'flush', 'returned'])
  })

  it('does not flush without a context or after a failed scene, and permits the next draw', () => {
    const { nv, draws } = fixture(), flush = nv.gl.flush
    draws.mockImplementationOnce(() => { throw Error('scene failed') })
    expect(() => nv.drawScene()).toThrow('scene failed')
    expect(flush).not.toHaveBeenCalled()
    expect(nv.drawScene()).toBe('drawn'); expect(flush).toHaveBeenCalledOnce()
    nv._gl = null
    expect(nv.drawScene()).toBe('drawn')
    expect(flush).toHaveBeenCalledOnce()
  })
})
