import { describe, expect, it, vi } from 'vitest'
import { pickCanvas3D, SliceClickGesture, toggleCanvasStructure, type CanvasPointer } from './canvasSelection'

const pointer = (patch: Partial<CanvasPointer> = {}): CanvasPointer => ({
  button: 0, clientX: 100, clientY: 200, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...patch,
})
const doubleClick = (patch: Partial<CanvasPointer> = {}, detail = 2) => ({ ...pointer(patch), detail })
const release = (gesture: SliceClickGesture, visible: string[], press = pointer(), up = pointer()) => {
  gesture.begin(press, visible, true)
  gesture.finish(up)
}

describe('released 3D framebuffer picking', () => {
  const canvas = { width: 400, height: 200,
    getBoundingClientRect: () => ({ left: 50, top: 100, width: 200, height: 100 }) } as HTMLCanvasElement
  const event = { clientX: 150, clientY: 150 } as MouseEvent

  it('submits one native depth scene instead of the brightness handler\'s duplicate full scenes', () => {
    const viewer = { mousePos: [1, 2], uiData: { isDragging: true, mouseDepthPicker: false }, drawScene: vi.fn(), resetBriCon: vi.fn() }
    viewer.drawScene.mockImplementation(() => {
      expect(viewer.mousePos).toEqual([200, 100])
      expect(viewer.uiData.isDragging).toBe(false)
      expect(viewer.uiData.mouseDepthPicker).toBe(true)
      // The native depth picker consumes its flag during this scene.
      viewer.uiData.mouseDepthPicker = false
    })
    pickCanvas3D(viewer, canvas, event)
    expect(viewer.drawScene).toHaveBeenCalledOnce()
    expect(viewer.resetBriCon).not.toHaveBeenCalled()
    expect(viewer.uiData).toEqual({ isDragging: true, mouseDepthPicker: false })
    expect(viewer.mousePos).toEqual([200, 100])
  })

  it('restores the previous depth and drag flags after a failed direct scene', () => {
    const viewer = { mousePos: [1, 2], uiData: { isDragging: true, mouseDepthPicker: false }, drawScene: vi.fn(() => { throw Error('draw failed') }) }
    expect(() => pickCanvas3D(viewer, canvas, event)).toThrow('draw failed')
    expect(viewer.uiData).toEqual({ isDragging: true, mouseDepthPicker: false })
    expect(viewer.mousePos).toEqual([200, 100])
  })

  it('does not submit a direct depth scene for points beyond the canvas', () => {
    const viewer = { mousePos: [1, 2], uiData: { isDragging: false, mouseDepthPicker: false }, drawScene: vi.fn() }
    pickCanvas3D(viewer, canvas, { ...event, clientY: 200 } as MouseEvent)
    expect(viewer.drawScene).not.toHaveBeenCalled()
    expect(viewer.uiData.mouseDepthPicker).toBe(false)
    expect(viewer.mousePos).toEqual([1, 2])
  })

  it('picks the release pixel after page offsets/scaling instead of a stale hover pixel', () => {
    const viewer = { mousePos: [1, 2], uiData: { isDragging: true }, resetBriCon: vi.fn() }
    viewer.resetBriCon.mockImplementation(() => {
      expect(viewer.mousePos).toEqual([200, 100])
      expect(viewer.uiData.isDragging).toBe(false)
    })
    pickCanvas3D(viewer, canvas, event)
    expect(viewer.resetBriCon).toHaveBeenCalledExactlyOnceWith(event)
    expect(viewer.uiData.isDragging).toBe(true)
  })

  it('restores native drag bookkeeping even if a pick fails', () => {
    const viewer = { mousePos: [1, 2], uiData: { isDragging: true }, resetBriCon: vi.fn(() => { throw Error('pick failed') }) }
    expect(() => pickCanvas3D(viewer, canvas, event)).toThrow('pick failed')
    expect(viewer.uiData.isDragging).toBe(true)
  })

  it('does not pick outside the current canvas or from nonfinite coordinates', () => {
    const viewer = { mousePos: [1, 2], uiData: { isDragging: false }, resetBriCon: vi.fn() }
    for (const clientX of [49, 250, Infinity]) pickCanvas3D(viewer, canvas, { ...event, clientX } as MouseEvent)
    expect(viewer.resetBriCon).not.toHaveBeenCalled()
    expect(viewer.mousePos).toEqual([1, 2])
  })
})

describe('double-click slice visibility', () => {
  it('returns release eligibility without consuming the later double-click action', () => {
    const gesture = new SliceClickGesture()
    gesture.begin(pointer(), ['target'], true)
    const released = gesture.finish(pointer())!
    expect(released).toEqual(['target'])
    released.push('local')
    expect(gesture.finishDoubleClick(doubleClick())).toEqual(['target'])
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
  })

  it('does not submit a double-click action for a single click count', () => {
    const gesture = new SliceClickGesture()
    release(gesture, ['target'])
    expect(gesture.finishDoubleClick(doubleClick({}, 1))).toBeNull()
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
  })

  it('shows, hides and shows the same hit only when a double-click is completed', () => {
    const gesture = new SliceClickGesture()
    let visible = ['other']
    for (const expected of [['other', 'target'], ['other'], ['other', 'target']]) {
      release(gesture, visible)
      release(gesture, visible)
      const before = gesture.finishDoubleClick(doubleClick())!
      visible = toggleCanvasStructure(visible, 'target', before.includes('target')).visible
      expect(visible).toEqual(expected)
      expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
    }
  })

  it.each([2, 4, 6])('accepts browser double-click count %s exactly once', detail => {
    const gesture = new SliceClickGesture()
    release(gesture, ['target'])
    expect(gesture.finishDoubleClick(doubleClick({}, detail))).toEqual(['target'])
    expect(gesture.finishDoubleClick(doubleClick({}, detail))).toBeNull()
  })

  it('uses pre-gesture visibility even if another callback already added the target', () => {
    const gesture = new SliceClickGesture(), original = ['other']
    gesture.begin(pointer(), original, true)
    const current = [...original, 'target']
    gesture.finish(pointer())
    const before = gesture.finishDoubleClick(doubleClick())!
    expect(toggleCanvasStructure(current, 'target', before.includes('target')))
      .toEqual({ selected: 'target', visible: ['other', 'target'] })
    expect(original).toEqual(['other'])
    expect(current).toEqual(['other', 'target'])
  })

  it('clears the picked selection while preserving other source visibility', () => {
    const visible = ['left', 'target', 'right']
    expect(toggleCanvasStructure(visible, 'target', true)).toEqual({ selected: null, visible: ['left', 'right'] })
    expect(visible).toEqual(['left', 'target', 'right'])
    expect(toggleCanvasStructure(visible, 'target', false)).toEqual({ selected: 'target', visible })
  })

  it('rejects a drag even when the pointer returns to its starting location', () => {
    const gesture = new SliceClickGesture()
    gesture.begin(pointer(), ['target'], true)
    gesture.move(pointer({ clientX: 105 }))
    gesture.move(pointer())
    gesture.finish(pointer())
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
  })

  it('rejects movement away and back after release', () => {
    const gesture = new SliceClickGesture()
    release(gesture, ['target'])
    gesture.move(pointer({ clientY: 205 }))
    gesture.move(pointer())
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
  })

  it('checks release and double-click positions using a four CSS pixel tolerance', () => {
    const gesture = new SliceClickGesture()
    release(gesture, [], pointer(), pointer({ clientX: 104 }))
    expect(gesture.finishDoubleClick(doubleClick({ clientX: 104 }))).toEqual([])
    release(gesture, [], pointer(), pointer({ clientX: 103, clientY: 203 }))
    expect(gesture.finishDoubleClick(doubleClick({ clientX: 103, clientY: 203 }))).toBeNull()
    release(gesture, [])
    expect(gesture.finishDoubleClick(doubleClick({ clientX: 105 }))).toBeNull()
  })

  it.each(['shiftKey', 'ctrlKey', 'altKey', 'metaKey'] as const)('rejects %s throughout a double-click', modifier => {
    const gesture = new SliceClickGesture()
    release(gesture, ['target'], pointer({ [modifier]: true }))
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
    release(gesture, ['target'], pointer(), pointer({ [modifier]: true }))
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
    release(gesture, ['target'])
    expect(gesture.finishDoubleClick(doubleClick({ [modifier]: true }))).toBeNull()
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
  })

  it.each([1, 2])('rejects mouse button %s throughout a double-click', button => {
    const gesture = new SliceClickGesture()
    release(gesture, ['target'], pointer({ button }))
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
    release(gesture, ['target'], pointer(), pointer({ button }))
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
    release(gesture, ['target'])
    expect(gesture.finishDoubleClick(doubleClick({ button }))).toBeNull()
  })

  it('requires a completed eligible gesture and respects cancellation', () => {
    const gesture = new SliceClickGesture()
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
    gesture.begin(pointer(), ['target'], false)
    gesture.finish(pointer())
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
    gesture.begin(pointer(), ['target'], true)
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
    release(gesture, ['target'])
    gesture.cancel()
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
    release(gesture, ['target'])
    gesture.begin(pointer(), [], false)
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
  })

  it('isolates snapshots and click eligibility between canvases', () => {
    const left = new SliceClickGesture(), right = new SliceClickGesture(), source = ['target']
    left.begin(pointer(), source, true)
    right.begin(pointer(), source, true)
    source.push('later')
    left.finish(pointer())
    right.finish(pointer())
    const snapshot = left.finishDoubleClick(doubleClick())!
    expect(snapshot).toEqual(['target'])
    snapshot.push('local')
    expect(right.finishDoubleClick(doubleClick())).toEqual(['target'])
    expect(source).toEqual(['target', 'later'])
    left.begin(pointer(), source, true)
    right.begin(pointer(), [], true)
    left.move(pointer({ clientY: 210 }))
    left.finish(pointer())
    right.finish(pointer())
    expect(left.finishDoubleClick(doubleClick())).toBeNull()
    expect(right.finishDoubleClick(doubleClick())).toEqual([])
  })

  it('rejects nonfinite input and discards superseded releases', () => {
    const gesture = new SliceClickGesture()
    release(gesture, ['target'], pointer({ clientX: NaN }))
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
    gesture.begin(pointer(), ['target'], true)
    gesture.move({ clientX: Infinity, clientY: 200 })
    gesture.finish(pointer())
    expect(gesture.finishDoubleClick(doubleClick())).toBeNull()
    release(gesture, ['target'])
    release(gesture, [])
    expect(gesture.finishDoubleClick(doubleClick())).toEqual([])
  })
})
