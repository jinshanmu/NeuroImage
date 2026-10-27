import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Niivue, type NVImage, type NVMesh } from '@niivue/niivue'
import { AtlasViewer } from './viewer'
import { ModelViewer } from './modelViewer'
import type { Manifest, Vec3, ViewState } from './types'
import type { ModelView, SurfaceManifest } from './modelTypes'
import { imageRenderKey, modelRenderKey } from './renderState'

class TestCanvas {
  width = 100
  height = 100
  private listeners = new Map<string, { callback: (event: MouseEvent) => void; capture: boolean }[]>()
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 } }
  addEventListener(type: string, callback: (event: MouseEvent) => void, options: boolean | AddEventListenerOptions = false) {
    const capture = typeof options === 'boolean' ? options : !!options.capture
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { callback, capture }])
  }
  removeEventListener(type: string, callback: (event: MouseEvent) => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item.callback !== callback))
  }
  fire(type: string, values: Partial<MouseEvent> = {}) {
    let stopped = false
    const event = { type, button: 0, detail: 1, clientX: 10, clientY: 50,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(() => { stopped = true }), ...values } as unknown as MouseEvent
    const listeners = [...(this.listeners.get(type) ?? [])].sort((a, b) => Number(b.capture) - Number(a.capture))
    for (const { callback } of listeners) { if (stopped) break; callback(event) }
    return event
  }
}

function singleClick(canvas: TestCanvas, values: Partial<MouseEvent> = {}, locate?: () => void) {
  canvas.fire('mousedown', values)
  locate?.()
  canvas.fire('mouseup', values)
  canvas.fire('click', values)
}

function doubleClick(canvas: TestCanvas, values: Partial<MouseEvent> = {}, locate?: () => void) {
  singleClick(canvas, { ...values, detail: 1 }, locate)
  singleClick(canvas, { ...values, detail: 2 })
  return canvas.fire('dblclick', { ...values, detail: 2 })
}

const viewers: { dispose(): void }[] = []
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1 })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => {
  for (const viewer of viewers.splice(0)) viewer.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function atlasFixture(visible = ['cortex'], selected: string | null = 'cortex', extra: Partial<ViewState> = {}, deferViewerEcho = false) {
  const canvas = new TestCanvas()
  const manifest = { representation: 'mri-labels', structures: [
    { id: 'cortex', name: 'Cortex' }, { id: 'deep-structure', name: 'Deep structure' },
  ], volumes: [
    { id: 't1', kind: 'image', shape: [10, 10, 10], voxel_size_mm: [1, 1, 1], affine_ras_mm: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] },
    { id: 'labels', kind: 'labels', shape: [10, 10, 10], voxel_size_mm: [1, 1, 1] },
  ] } as unknown as Manifest
  let state: ViewState = { selected, visible: [...visible], position: [2, 5, 5], background: 't1',
    labelOpacity: .45, meshOpacity: 1, radiological: true, layout: 'quad', camera: [110, 15, .8],
    pan: [0, 0, 0, 1], imageContext: false, window: [0, 100], annotations: [], note: '', overlay: 'labels', ...extra }
  const patches: Partial<ViewState>[] = []
  const viewer = new AtlasViewer(canvas as unknown as HTMLCanvasElement, manifest, '/atlas/synthetic/', patch => {
    patches.push(patch)
    // Cursor navigation leaves visibility alone; only explicit display actions
    // provide a visible patch, just as the workspace callback does.
    const nextVisible = patch.visible ?? state.visible
    state = { ...state, ...patch, visible: nextVisible }
    if (!deferViewerEcho) (viewer as unknown as { current: ViewState }).current = state
  }, () => {})
  viewers.push(viewer)
  ;(viewer as unknown as { current: ViewState }).current = state
  viewer.nv.screenSlices = [
    { axCorSag: 0, leftTopWidthHeight: [0, 0, 50, 100] },
    { axCorSag: viewer.nv.sliceTypeRender, leftTopWidthHeight: [50, 0, 50, 100] },
  ] as typeof viewer.nv.screenSlices
  const sourceValue = (x: number) => x >= 0 && x < 5 ? 1 : x >= 5 && x < 9 ? 2 : 0
  viewer.nv.volumes = [
    {} as NVImage,
    { mm2vox: (position: Vec3) => position.slice(0, 3), getValue: sourceValue } as unknown as NVImage,
  ]
  vi.spyOn(viewer.nv, 'canvasPos2frac').mockImplementation(point => [point[0] / 50, point[1] / 100, .5])
  vi.spyOn(viewer.nv, 'frac2mm').mockImplementation(point => new Float32Array([point[0] * 10, point[1] * 10, point[2] * 10, 1]))
  const location = (position: Vec3 = [2, 5, 5]) => viewer.nv.onLocationChange({ mm: position, axCorSag: 0,
    values: [{ value: 0 }, { value: sourceValue(position[0]) }] })
  return { canvas, viewer, location, patches, state: () => state }
}

describe('atlas native navigation without duplicate rendering', () => {
  function ready(f: ReturnType<typeof atlasFixture>) {
    const internal = f.viewer as unknown as { rendered: ViewState; appliedKey: string; render(state: ViewState, generation: number): Promise<void> }
    internal.rendered = structuredClone(f.state())
    internal.appliedKey = imageRenderKey(f.state())
    return vi.spyOn(internal, 'render').mockResolvedValue()
  }

  it('shares one pending atlas render across identical apply echoes without restarting its generation',async()=>{
    const f=atlasFixture(),render=ready(f)
    let finish!:()=>void
    render.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve}))
    const next={...f.state(),labelOpacity:.2},pending=f.viewer.apply(next)
    for(let index=0;index<20;index++)expect(f.viewer.apply({...next,note:String(index)})).toBe(pending)
    finish();await pending
    expect(render).toHaveBeenCalledOnce()
    await f.viewer.apply({...next,note:'latest observation'})
    expect(render).toHaveBeenCalledOnce()
  })

  it('leaves canvas resize observation to the native attachment', () => {
    const observer = vi.fn(class { observe() {} disconnect() {} })
    vi.stubGlobal('ResizeObserver', observer)
    atlasFixture()
    expect(observer).not.toHaveBeenCalled()
  })

  it('acknowledges a drawn cursor update without replaying rendering or changing visibility', async () => {
    const f = atlasFixture(), render = ready(f), draw = vi.spyOn(f.viewer.nv, 'drawScene').mockImplementation(() => {})
    f.location([6, 5, 5])
    await f.viewer.apply(f.state())
    expect(render).not.toHaveBeenCalled()
    expect(draw).not.toHaveBeenCalled()
    expect(f.state().position).toEqual([6, 5, 5])
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('deep-structure')
    expect(f.state().visible).toEqual(['cortex'])
  })

  it('keeps the latest location and camera when several native callbacks precede React apply', async () => {
    const f = atlasFixture(), render = ready(f)
    f.location([6, 5, 5])
    f.viewer.nv.onAzimuthElevationChange(120, 25)
    f.location([3, 5, 5])
    await f.viewer.apply(f.state())
    expect(render).not.toHaveBeenCalled()
    expect(f.state().position).toEqual([3, 5, 5])
    expect(f.state().camera.slice(0, 2)).toEqual([120, 25])
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('cortex')
  })

  it.each([{ visible: [] }, { labelOpacity: .2 }, { layout: 'coronal' }, { pan: [0, 0, 0, 2] }, { position: [4, 5, 5] }])(
    'still renders an explicit control change alongside a pending cursor echo: %j', async change => {
      const f = atlasFixture(), render = ready(f)
      f.location([6, 5, 5])
      await f.viewer.apply({ ...f.state(), ...change } as ViewState)
      expect(render).toHaveBeenCalledOnce()
    })

  it('retains full rendering when a probability selection can change the displayed field', async () => {
    const f = atlasFixture(['cortex'], 'cortex', { overlay: 'probability' }), render = ready(f)
    f.location([6, 5, 5])
    await f.viewer.apply(f.state())
    expect(render).toHaveBeenCalledOnce()
  })

  it('does not acknowledge a failed display change as rendered after subsequent native navigation', async () => {
    const f = atlasFixture(), render = ready(f)
    ;(f.viewer as unknown as { changed(patch: Partial<ViewState>): void }).changed({ background: 'unavailable-image' })
    render.mockRejectedValueOnce(Error('Image load failed'))
    await expect(f.viewer.apply(f.state())).rejects.toThrow('Image load failed')
    f.location([6, 5, 5])
    await f.viewer.apply(f.state())
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('updates section guides in the native draw and acknowledges its cursor without another draw', async () => {
    const f = atlasFixture(['cortex'], 'cortex', { sectionPlanes: ['sagittal'] }), render = ready(f)
    f.viewer.nv.scene.crosshairPos = [0.6, 0.5, 0.5]
    f.viewer.nv.beforeSceneDraw()
    expect(f.viewer.nv.sectionGuides[0].polygon).toHaveLength(4)
    expect(f.viewer.nv.sectionGuides[0].polygon.every(point => Math.abs(point[0] - 6) < 1e-5)).toBe(true)
    f.location([6, 5, 5])
    await f.viewer.apply(f.state())
    expect(render).not.toHaveBeenCalled()
  })

  it('moves a following cut in the first native slice draw and acknowledges several moves without replay', async () => {
    const f = atlasFixture(['cortex'], 'cortex', {
      surfaceCutaway: { axis: 0, side: 1, position_mm: 2, structures: ['cortex'], followCursor: true },
    }, true), render = ready(f)
    const targets = f.viewer.nv.cutawayMeshIds
    targets.add('source-mesh')
    for (const coordinate of [6, 3]) {
      f.viewer.nv.scene.crosshairPos = [coordinate / 10, .5, .5]
      f.viewer.nv.beforeSceneDraw()
      expect(f.viewer.nv.surfaceCutaway?.position_mm).toBe(coordinate)
      expect(f.viewer.nv.cutawayMeshIds).toBe(targets)
      expect([...targets]).toEqual(['source-mesh'])
      f.location([coordinate, 5, 5])
      expect(f.state().surfaceCutaway?.position_mm).toBe(coordinate)
    }
    await f.viewer.apply(f.state())
    expect(render).not.toHaveBeenCalled()
    expect(f.state().position).toEqual([3, 5, 5])
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.state().camera).toEqual([110, 15, .8])
  })

  it.each([undefined, false])('retains a fixed cut while navigating a legacy scene: %s', async followCursor => {
    const cut = { axis: 0 as const, side: 1 as const, position_mm: 2, structures: ['cortex'], ...(followCursor === false ? { followCursor } : {}) }
    const f = atlasFixture(['cortex'], 'cortex', { surfaceCutaway: cut }), render = ready(f)
    f.viewer.nv.surfaceCutaway = cut
    f.viewer.nv.scene.crosshairPos = [.6, .5, .5]
    f.viewer.nv.beforeSceneDraw()
    f.location([6, 5, 5])
    await f.viewer.apply(f.state())
    expect(f.viewer.nv.surfaceCutaway).toBe(cut)
    expect(f.state().surfaceCutaway).toEqual(cut)
    expect(render).not.toHaveBeenCalled()
  })

  it('clips background meshes enabled or loaded after a cut without changing its recorded targets', () => {
    const cut = { axis: 0 as const, side: 1 as const, position_mm: 2, structures: ['cortex'], followCursor: true }
    const f = atlasFixture(['cortex'], 'cortex', { surfaceCutaway: cut })
    const internal = f.viewer as unknown as { meshes: Map<string, NVMesh>; current: ViewState; updateCutaway(state: ViewState): void }
    const cortex = { id: 'cortex-mesh' } as NVMesh, background = { id: 'background-mesh' } as NVMesh
    internal.meshes.set('cortex', cortex)
    internal.updateCutaway(f.state())
    const targets = f.viewer.nv.cutawayMeshIds
    expect([...targets]).toEqual(['cortex-mesh'])
    const state = { ...f.state(), surfaceContext: { enabled: true, opacity: .2, structure_ids: ['cortex', 'deep-structure'] } }
    internal.updateCutaway(state)
    internal.meshes.set('deep-structure', background)
    internal.meshes.set('hidden-cached-surface', { id: 'hidden-mesh' } as NVMesh)
    internal.current = state
    internal.updateCutaway(state)
    expect([...targets]).toEqual(['cortex-mesh', 'background-mesh'])
    f.viewer.nv.scene.crosshairPos = [.6, .5, .5]
    f.viewer.nv.beforeSceneDraw()
    expect(f.viewer.nv.surfaceCutaway?.position_mm).toBe(6)
    expect([...targets]).toEqual(['cortex-mesh', 'background-mesh'])
    expect(f.viewer.nv.cutawayMeshIds).toBe(targets)
    expect(internal.meshes.get('deep-structure')).toBe(background)
    expect(cut.structures).toEqual(['cortex'])
    internal.updateCutaway({ ...state, surfaceContext: { ...state.surfaceContext, opacity: 0 } })
    expect([...targets]).toEqual(['cortex-mesh'])
    internal.updateCutaway({ ...state, surfaceCutaway: undefined })
    expect([...targets]).toEqual([])
    expect(state.visible).toEqual(['cortex'])
  })

  it('keeps exact programmatic cut coordinates through apply, camera redraw and snapshot', async () => {
    const position: Vec3 = [2.123456789, 5, 5]
    const f = atlasFixture(['cortex'], 'cortex', { surfaceCutaway: { axis: 0, side: 1, position_mm: 2, structures: ['cortex'], followCursor: true } })
    const render = ready(f)
    await f.viewer.apply({ ...f.state(), position })
    expect(render.mock.calls[0][0].surfaceCutaway?.position_mm).toBe(position[0])
    // The real render stores exact RAS alongside the GPU-oriented fractions.
    f.viewer.nv.scene.crosshairPos = new Float32Array([position[0] / 10, .5, .5])
    ;(f.viewer as unknown as { rememberCursor(position: Vec3): void }).rememberCursor(position)
    f.viewer.nv.beforeSceneDraw()
    expect(f.viewer.nv.surfaceCutaway?.position_mm).toBe(position[0])
    f.viewer.nv.scene.crosshairPos = new Float32Array([(position[0] + .000001) / 10, .5, .5])
    f.viewer.nv.beforeSceneDraw()
    expect(f.viewer.nv.surfaceCutaway?.position_mm).toBe(position[0])
    const snapshot = f.viewer.snapshot({ ...f.state(), position })
    expect(snapshot.position).toEqual(position)
    expect(snapshot.surfaceCutaway?.position_mm).toBe(position[0])
    expect(f.patches).toEqual([])
  })

  it('resolves a depth hit against the sampled cut before following it in the recursive 3D draw', () => {
    const cut = { axis: 0 as const, side: 1 as const, position_mm: 2, structures: ['cortex'], followCursor: true }
    const f = atlasFixture(['cortex', 'deep-structure'], 'cortex', { surfaceCutaway: cut })
    const meshes = (f.viewer as unknown as { meshes: Map<string, NVMesh> }).meshes
    meshes.set('cortex', { pts: [2.6, 5, 5], visible: true, opacity: 1 } as unknown as NVMesh)
    meshes.set('deep-structure', { pts: [1.9, 5, 5], visible: true, opacity: 1 } as unknown as NVMesh)
    f.viewer.nv.surfaceCutaway = cut
    f.viewer.nv.sourceDepthPick = true
    f.location([2.8, 5, 5])
    expect(f.state().selected).toBe('deep-structure')
    expect(f.viewer.nv.surfaceCutaway?.position_mm).toBe(2.8)
    expect(f.state().surfaceCutaway?.position_mm).toBe(2.8)
    expect(f.state().visible).toEqual(['cortex', 'deep-structure'])
  })

  it('keeps the fitted camera scale produced by a native draw without a render feedback loop', async () => {
    const f = atlasFixture(), render = ready(f)
    f.viewer.nv.onAzimuthElevationChange(120, 25)
    f.viewer.nv.fitBounds = [[0, 0, 0], [10, 10, 10]]
    f.viewer.nv.focus3D = [5, 5, 5]
    f.viewer.nv.scene.renderAzimuth = 120
    f.viewer.nv.scene.renderElevation = 25
    f.viewer.nv.fitting3D = true
    f.viewer.nv.scene.volScaleMultiplier = 2.7
    f.viewer.nv.fitting3D = false
    f.viewer.nv.afterSceneDraw()
    await f.viewer.apply(f.state())
    expect(render).not.toHaveBeenCalled()
    expect(f.state().camera).toEqual([120, 25, 2.7])
    expect(f.state().focus3D).toEqual([5, 5, 5])
  })

  it('settles the initial fitted camera before the ready workspace echoes its latest state', async () => {
    // React stores callbacks immediately but applies them to the viewer only
    // after initialize resolves and the workspace becomes ready.
    const f = atlasFixture(['cortex'], 'cortex', { zoom3D: 1, fitVisible3D: true }, true)
    const initial = structuredClone(f.state())
    const internal = f.viewer as unknown as {
      rendered: ViewState; resources: { load(): Promise<void> }
      render(state: ViewState, generation: number): Promise<void>
    }
    vi.spyOn(f.viewer.nv, 'attachToCanvas').mockResolvedValue(f.viewer.nv)
    vi.spyOn(f.viewer.nv, 'installSliceOverlayOpacity').mockImplementation(() => {})
    vi.spyOn(f.viewer.nv, 'cleanup').mockImplementation(() => {})
    f.viewer.nv.gl = { MAX_TEXTURE_SIZE: 0x0d33, getParameter: () => 4096, getExtension: () => null } as unknown as WebGL2RenderingContext
    vi.spyOn(internal.resources, 'load').mockResolvedValue()
    const render = vi.spyOn(internal, 'render').mockImplementation(async state => {
      await Promise.resolve()
      internal.rendered = structuredClone(state)
      f.viewer.nv.fitBounds = [[0, 0, 0], [10, 10, 10]]
      f.viewer.nv.focus3D = [5, 5, 5]
      f.viewer.nv.scene.renderAzimuth = state.camera[0]
      f.viewer.nv.scene.renderElevation = state.camera[1]
      f.viewer.nv.fitting3D = true
      f.viewer.nv.scene.volScaleMultiplier = 2.7
      f.viewer.nv.fitting3D = false
      f.viewer.nv.afterSceneDraw()
    })
    await f.viewer.initialize(initial)
    expect(render).toHaveBeenCalledOnce()
    expect(f.state().camera).toEqual([110, 15, 2.7])
    expect(f.state().focus3D).toEqual([5, 5, 5])
    await f.viewer.apply(f.state())
    expect(render).toHaveBeenCalledOnce()
    expect(f.state().position).toEqual(initial.position)
    expect(f.state().visible).toEqual(initial.visible)
    expect(f.state().zoom3D).toBe(1)
  })

  it('still replays a camera echo emitted while an ordinary asset apply is pending', async () => {
    const f = atlasFixture(['cortex'], 'cortex', {}, true), render = ready(f)
    let finish!: () => void
    render.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    ;(f.viewer as unknown as { changed(patch: Partial<ViewState>): void }).changed({ labelOpacity: .2 })
    const applying = f.viewer.apply(f.state())
    f.viewer.nv.onAzimuthElevationChange(120, 25)
    finish()
    await applying
    await f.viewer.apply(f.state())
    expect(render).toHaveBeenCalledTimes(2)
    expect(f.state().labelOpacity).toBe(.2)
    expect(f.state().camera.slice(0, 2)).toEqual([120, 25])
  })

  it('uses a relative 3D factor without accumulating the fitted camera scale', () => {
    const f = atlasFixture(['cortex'], 'cortex', { zoom3D: 1, fitVisible3D: true })
    const identity = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    f.viewer.nv.fitBounds = [[-1, -1, -1], [1, 1, 1]]
    f.viewer.nv.relativeZoom = 1
    vi.spyOn(f.viewer.nv, 'setPivot3D').mockImplementation(() => {})
    vi.spyOn(f.viewer.nv, 'calculateMvpMatrix').mockReturnValue([identity, identity, identity] as ReturnType<typeof f.viewer.nv.calculateMvpMatrix>)
    vi.spyOn(Niivue.prototype, 'draw3D').mockImplementation(() => {})
    f.viewer.nv.draw3D()
    const base = f.viewer.nv.zoomBase
    expect(f.viewer.nv.scene.volScaleMultiplier).toBeCloseTo(base)
    f.viewer.nv.relativeZoom = 2
    f.viewer.nv.draw3D()
    expect(f.viewer.nv.scene.volScaleMultiplier).toBeCloseTo(base * 2)
    f.viewer.nv.draw3D()
    expect(f.viewer.nv.scene.volScaleMultiplier).toBeCloseTo(base * 2)
    expect(f.viewer.zoom3DChange(10)).toEqual({ zoom3D: 10, camera: [f.viewer.nv.scene.renderAzimuth, f.viewer.nv.scene.renderElevation, base * 10] })
    expect(f.state().position).toEqual([2, 5, 5])
    expect(f.state().pan).toEqual([0, 0, 0, 1])
  })

  it('advances normalized wheel zoom by 0.1 while retaining automatic fit and RAS', () => {
    const f = atlasFixture(['cortex'], 'cortex', { zoom3D: 1, fitVisible3D: true })
    f.viewer.nv.relativeZoom = 1; f.viewer.nv.zoomBase = 2.5
    f.viewer.nv.fitBounds = [[0, 0, 0], [10, 10, 10]]
    vi.spyOn(f.viewer.nv, 'setScale').mockImplementation(value => { f.viewer.nv.scene.volScaleMultiplier = value })
    f.viewer.nv.sliceScroll3D(1)
    expect(f.state().zoom3D).toBe(1.1)
    expect(f.state().camera[2]).toBeCloseTo(2.75)
    expect(f.state().fitVisible3D).toBe(true)
    expect(f.viewer.nv.fitBounds).not.toBeNull()
    expect(f.state().position).toEqual([2, 5, 5])
    f.viewer.nv.sliceScroll3D(-1)
    expect(f.state().zoom3D).toBe(1)
    expect(f.state().camera[2]).toBeCloseTo(2.5)
  })

  it('acknowledges normalized native zoom without replaying rendering', async () => {
    const f = atlasFixture(['cortex'], 'cortex', { zoom3D: 1 }), render = ready(f)
    f.viewer.nv.relativeZoom = 1; f.viewer.nv.zoomBase = 2
    f.viewer.nv.onZoom3DChange(3)
    await f.viewer.apply(f.state())
    expect(render).not.toHaveBeenCalled()
    expect(f.state().zoom3D).toBe(1.5)
    expect(f.state().camera[2]).toBe(3)
  })

  it('clamps and rounds 3D control factors without changing the source cursor', () => {
    const f = atlasFixture(['cortex'], 'cortex', { zoom3D: 1 })
    f.viewer.nv.zoomBase = 2
    expect(f.viewer.zoom3DChange(.4).zoom3D).toBe(1)
    expect(f.viewer.zoom3DChange(11).zoom3D).toBe(10)
    expect(f.viewer.zoom3DChange(2.34)).toMatchObject({ zoom3D: 2.3, camera: [f.viewer.nv.scene.renderAzimuth, f.viewer.nv.scene.renderElevation, 4.6] })
    expect(f.patches).toEqual([])
  })

  it('magnifies screen coordinates without shrinking depth or changing the recorded camera', () => {
    const f = atlasFixture(['cortex'], 'cortex', { zoom3D: 10 })
    const identity = () => Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    f.viewer.nv.relativeZoom = 10
    f.viewer.nv.fitting3D = true
    f.viewer.nv.scene.volScaleMultiplier = 8
    f.viewer.nv.fitting3D = false
    const reference = identity()
    const native = vi.spyOn(Niivue.prototype, 'calculateMvpMatrix').mockImplementation(function (this: Niivue) {
      expect(this.scene.volScaleMultiplier).toBeCloseTo(.8)
      return [reference, identity(), identity()] as ReturnType<Niivue['calculateMvpMatrix']>
    })
    const matrices = f.viewer.nv.calculateMvpMatrix(null, [0, 0, 100, 100], 110, 15)
    expect(native).toHaveBeenCalledOnce()
    expect(matrices[0][0]).toBe(10); expect(matrices[0][5]).toBe(10)
    expect(matrices[0][10]).toBe(1); expect(matrices[0][14]).toBe(0)
    expect(reference).toEqual(identity())
    expect(f.viewer.nv.scene.volScaleMultiplier).toBe(8)
    expect(f.viewer.nv.fitting3D).toBe(false)
    expect(f.patches).toEqual([])
  })

  it('does not scan surface vertices for a redraw of the unchanged cursor in the 3D tile', () => {
    const f = atlasFixture()
    ;(f.viewer as unknown as { pointerIn3D: boolean }).pointerIn3D = true
    ;(f.viewer as unknown as { meshes: Map<string, NVMesh> }).meshes.set('cortex', {
      visible: true, opacity: 1, get pts() { throw Error('Unchanged cursor must not scan geometry') },
    } as unknown as NVMesh)
    expect(() => f.location()).not.toThrow()
    expect(f.patches).toEqual([])
  })

  it('keeps a queued 2D source lookup in its slice when the pointer has already entered a 3D tile', () => {
    const f = atlasFixture()
    ;(f.viewer as unknown as { pointerIn3D: boolean }).pointerIn3D = true
    ;(f.viewer as unknown as { meshes: Map<string, NVMesh> }).meshes.set('cortex', {
      visible: true, opacity: 1, get pts() { throw Error('A slice callback must not scan 3D geometry') },
    } as unknown as NVMesh)
    expect(() => f.location([6, 5, 5])).not.toThrow()
    expect(f.state().selected).toBe('deep-structure')
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('deep-structure')
    expect(f.state().visible).toEqual(['cortex'])
  })
})

describe('atlas canvas click wiring without WebGL', () => {
  it('uses a single click only to place the cursor, without changing shown structures', () => {
    const f = atlasFixture()
    singleClick(f.canvas, { clientX: 15 }, () => f.location([3, 5, 5]))
    expect(f.state().position).toEqual([3, 5, 5])
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.patches.every(patch => patch.visible === undefined)).toBe(true)
  })

  it('deselects and restores a structure by double-clicking the same physical point', () => {
    const f = atlasFixture()
    doubleClick(f.canvas)
    expect(f.state().visible).toEqual([])
    expect(f.state().selected).toBeNull()
    expect(f.state().position).toEqual([2, 5, 5])
    expect(f.state().selectionEvidence?.candidates).toEqual([])
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('cortex')
    doubleClick(f.canvas)
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.state().selected).toBe('cortex')
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('cortex')
  })

  it('keeps a hidden deep structure hidden on single click and adds it only on double click', () => {
    const f = atlasFixture()
    singleClick(f.canvas, { clientX: 30 }, () => f.location([6, 5, 5]))
    expect(f.state().position).toEqual([6, 5, 5])
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('deep-structure')
    expect(f.patches.every(patch => patch.visible === undefined)).toBe(true)
    doubleClick(f.canvas, { clientX: 30 })
    expect(f.state().visible).toEqual(['cortex', 'deep-structure'])
    expect(f.state().selected).toBe('deep-structure')
    doubleClick(f.canvas, { clientX: 30 })
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.state().selected).toBeNull()
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('deep-structure')
  })

  it('keeps drag navigation from adding or hiding the released structure', () => {
    const f = atlasFixture()
    f.canvas.fire('mousedown')
    f.canvas.fire('mousemove', { clientX: 30 })
    f.location([6, 5, 5])
    f.canvas.fire('mouseup', { clientX: 30 })
    f.canvas.fire('dblclick', { clientX: 30, detail: 2 })
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.state().position).toEqual([6, 5, 5])
    expect(f.patches.every(patch => patch.visible === undefined)).toBe(true)
  })

  it('cancels a pending display action on wheel navigation and preserves ordinary cursor updates', () => {
    const f = atlasFixture()
    f.canvas.fire('mousedown')
    f.canvas.fire('wheel')
    f.location([6, 5, 5])
    f.canvas.fire('mouseup')
    f.canvas.fire('dblclick', { detail: 2 })
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.state().position).toEqual([6, 5, 5])
    expect(f.patches.every(patch => patch.visible === undefined)).toBe(true)
  })

  it('does not resurrect a deselected structure on an ordinary same-position redraw', () => {
    const f = atlasFixture()
    doubleClick(f.canvas)
    const count = f.patches.length
    f.location()
    expect(f.patches).toHaveLength(count)
    expect(f.state().visible).toEqual([])
    expect(f.state().selected).toBeNull()
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('cortex')
  })

  it('identifies a hidden source label after restoring a view with no active selection', () => {
    const f = atlasFixture([], null)
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('cortex')
    expect(f.state().selected).toBeNull()
    expect(f.state().visible).toEqual([])
    expect(f.patches).toEqual([])
  })

  it('clears the cursor readout only when navigation reaches true source background', () => {
    const f = atlasFixture()
    doubleClick(f.canvas)
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('cortex')
    singleClick(f.canvas, { clientX: 47.5 }, () => f.location([9.5, 5, 5]))
    expect(f.state().position).toEqual([9.5, 5, 5])
    expect(f.state().selected).toBeNull()
    expect(f.state().visible).toEqual([])
    expect(f.viewer.cursorStructureAt(f.state().position)).toBeNull()
    doubleClick(f.canvas, { clientX: 47.5 })
    expect(f.state().visible).toEqual([])
    expect(f.viewer.cursorStructureAt(f.state().position)).toBeNull()
  })

  it('refreshes an explicit source-anchor readout when coordinates are sampled again', () => {
    const f = atlasFixture([], null)
    const before = structuredClone(f.state())
    f.viewer.setCursorStructure([2, 5, 5], 'deep-structure')
    expect(f.viewer.cursorStructureAt([2, 5, 5])).toBe('deep-structure')
    const located = f.viewer.locateCursor([2, 5, 5])
    expect(located.selected).toBe('cortex')
    expect(located.visible).toBeUndefined()
    expect(f.viewer.cursorStructureAt([2, 5, 5])).toBe('cortex')
    expect(f.state()).toEqual(before)
    expect(f.patches).toEqual([])
  })

  it('ignores failed 3D depth picks rather than reusing the old crosshair label', () => {
    const f = atlasFixture([], null)
    f.viewer.nv.sourceDepthPick = false
    f.location()
    expect(f.patches).toEqual([])
    expect(f.state().visible).toEqual([])
    expect(f.viewer.nv.sourceDepthPick).toBeNull()
  })

  it('places the 3D cursor without hiding a surface on either single or double click', () => {
    const f = atlasFixture()
    ;(f.viewer as unknown as { meshes: Map<string, NVMesh> }).meshes.set('cortex',
      { pts: [2.4, 5, 5], visible: true, opacity: 1 } as unknown as NVMesh)
    const pick = vi.spyOn(f.viewer.nv, 'drawScene').mockImplementation(() => {
      if (!f.viewer.nv.uiData.mouseDepthPicker) return
      f.viewer.nv.uiData.mouseDepthPicker = false
      f.viewer.nv.sourceDepthPick = true
      f.location([2.4, 5, 5])
    })
    singleClick(f.canvas, { clientX: 75 })
    expect(f.state().position).toEqual([2.4, 5, 5])
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.patches.every(patch => patch.visible === undefined)).toBe(true)
    doubleClick(f.canvas, { clientX: 75 })
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.state().selected).toBe('cortex')
    expect(f.patches.every(patch => patch.visible === undefined)).toBe(true)
    expect(pick).toHaveBeenCalledTimes(3)
  })

  it('uses the stationary 3D release pixel despite native drag mode and stale hover bookkeeping', () => {
    const f = atlasFixture()
    ;(f.viewer as unknown as { meshes: Map<string, NVMesh> }).meshes.set('cortex',
      { pts: [2.4, 5, 5], visible: true, opacity: 1 } as unknown as NVMesh)
    f.viewer.nv.uiData.isDragging = true
    f.viewer.nv.mousePos = [1, 1]
    const pick = vi.spyOn(f.viewer.nv, 'drawScene').mockImplementation(() => {
      if (!f.viewer.nv.uiData.mouseDepthPicker) return
      f.viewer.nv.uiData.mouseDepthPicker = false
      if (f.viewer.nv.uiData.isDragging) return
      expect(f.viewer.nv.mousePos).toEqual([75, 50])
      f.viewer.nv.sourceDepthPick = true
      f.location([2.4, 5, 5])
    })
    doubleClick(f.canvas, { clientX: 75 })
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.state().selected).toBe('cortex')
    expect(f.state().position).toEqual([2.4, 5, 5])
    expect(f.viewer.nv.uiData.isDragging).toBe(true)
    expect(f.viewer.nv.uiData.mouseDepthPicker).toBe(false)
    expect(pick).toHaveBeenCalledTimes(2)
  })

  it('treats a successful 3D depth callback as cursor navigation', () => {
    const f = atlasFixture()
    ;(f.viewer as unknown as { meshes: Map<string, NVMesh> }).meshes.set('cortex',
      { pts: [2.4, 5, 5], visible: true, opacity: 1 } as unknown as NVMesh)
    f.viewer.nv.volumes[1].getValue = () => 2
    f.viewer.nv.sourceDepthPick = true
    f.viewer.nv.onLocationChange({ mm: [2.4, 5, 5], axCorSag: NaN, values: [{ value: 0 }, { value: 2 }] })
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.state().position).toEqual([2.4, 5, 5])
    expect(f.patches.every(patch => patch.visible === undefined)).toBe(true)
  })

  it.each([
    { position: [6, 5, 5] as Vec3, selected: 'deep-structure' },
    { position: [9.5, 5, 5] as Vec3, selected: null },
  ])('navigates the 3D cursor plane to $position without restoring hidden structures', ({ position, selected }) => {
    const f = atlasFixture([], null), camera = [...f.state().camera]
    vi.spyOn(f.viewer.nv, 'drawScene').mockImplementation(() => {
      if (!f.viewer.nv.uiData.mouseDepthPicker) return
      f.viewer.nv.uiData.mouseDepthPicker = false
      f.viewer.nv.sourceDepthPick = true
      f.viewer.nv.sourcePlanePick = true
      f.location(position)
    })
    doubleClick(f.canvas, { clientX: 75 })
    expect(f.state().position).toEqual(position)
    expect(f.state().selected).toBe(selected)
    expect(f.state().visible).toEqual([])
    expect(f.state().camera).toEqual(camera)
    expect(f.viewer.cursorStructureAt(position)).toBe(selected)
    expect(f.patches.every(patch => patch.visible === undefined)).toBe(true)
  })

  it('identifies the visible 3D surface instead of a rounded neighboring voxel without changing visibility', () => {
    const f = atlasFixture()
    ;(f.viewer as unknown as { meshes: Map<string, NVMesh> }).meshes.set('cortex',
      { pts: [2.4, 5, 5], visible: true, opacity: 1 } as unknown as NVMesh)
    f.viewer.nv.volumes[1].getValue = () => 2
    vi.spyOn(f.viewer.nv, 'drawScene').mockImplementation(() => {
      if (!f.viewer.nv.uiData.mouseDepthPicker) return
      f.viewer.nv.uiData.mouseDepthPicker = false
      f.viewer.nv.sourceDepthPick = true
      f.viewer.nv.onLocationChange({ mm: [2.4, 5, 5], axCorSag: NaN, values: [{ value: 0 }, { value: 2 }] })
    })
    doubleClick(f.canvas, { clientX: 75 })
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.state().selected).toBe('cortex')
    expect(f.state().position).toEqual([2.4, 5, 5])
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('cortex')
  })

  it('retains surface selection and visibility through repeated clicks, redraws, camera changes and failed depth picks', () => {
    const f = atlasFixture()
    ;(f.viewer as unknown as { meshes: Map<string, NVMesh> }).meshes.set('cortex',
      { pts: [2.4, 5, 5], visible: true, opacity: 1 } as unknown as NVMesh)
    f.viewer.nv.volumes[1].getValue = () => 2
    const pick = vi.spyOn(f.viewer.nv, 'drawScene').mockImplementation(() => {
      if (!f.viewer.nv.uiData.mouseDepthPicker) return
      f.viewer.nv.uiData.mouseDepthPicker = false
      f.viewer.nv.sourceDepthPick = true
      f.viewer.nv.onLocationChange({ mm: [2.4, 5, 5], axCorSag: NaN, values: [{ value: 0 }, { value: 2 }] })
    })
    doubleClick(f.canvas, { clientX: 75 })
    expect(f.state().selected).toBe('cortex')
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('cortex')
    f.viewer.nv.onAzimuthElevationChange(120, 20)
    f.viewer.nv.onZoom3DChange(2)
    f.viewer.nv.onLocationChange({ mm: [2.4, 5, 5], axCorSag: NaN, values: [{ value: 0 }, { value: 2 }] })
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('cortex')
    const camera = [...f.state().camera]
    pick.mockImplementation(() => {
      if (!f.viewer.nv.uiData.mouseDepthPicker) return
      f.viewer.nv.uiData.mouseDepthPicker = false
      f.viewer.nv.sourceDepthPick = false
      f.viewer.nv.onLocationChange({ mm: [2.4, 5, 5], axCorSag: NaN, values: [{ value: 0 }, { value: 2 }] })
    })
    singleClick(f.canvas, { clientX: 75 })
    expect(f.state().selected).toBe('cortex')
    expect(f.state().visible).toEqual(['cortex'])
    expect(f.state().camera).toEqual(camera)
    expect(f.patches.every(patch => patch.visible === undefined)).toBe(true)
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('cortex')
  })

  it('refreshes a same-position 2D source name without selecting or showing its hidden neighbor', () => {
    const f = atlasFixture()
    ;(f.viewer as unknown as { meshes: Map<string, NVMesh> }).meshes.set('cortex',
      { pts: [2.4, 5, 5], visible: true, opacity: 1 } as unknown as NVMesh)
    f.viewer.nv.volumes[1].getValue = () => 2
    vi.spyOn(f.viewer.nv, 'drawScene').mockImplementation(() => {
      if (!f.viewer.nv.uiData.mouseDepthPicker) return
      f.viewer.nv.uiData.mouseDepthPicker = false
      f.viewer.nv.sourceDepthPick = true
      f.viewer.nv.onLocationChange({ mm: [2.4, 5, 5], axCorSag: NaN, values: [{ value: 0 }, { value: 2 }] })
    })
    doubleClick(f.canvas, { clientX: 75 })
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('cortex')
    // NiiVue may skip its location callback because the physical cursor has not moved.
    singleClick(f.canvas, { clientX: 12 })
    expect(f.state().position).toHaveLength(3)
    expect(f.state().position[0]).toBeCloseTo(2.4, 6)
    expect(f.viewer.cursorStructureAt(f.state().position)).toBe('deep-structure')
    expect(f.state().selected).toBe('cortex')
    expect(f.state().visible).toEqual(['cortex'])
  })

  it('does not depth-pick after dragging the 3D view', () => {
    const f = atlasFixture()
    const pick = vi.spyOn(f.viewer.nv, 'drawScene').mockImplementation(() => {})
    f.canvas.fire('mousedown', { clientX: 65 })
    f.canvas.fire('mousemove', { clientX: 85 })
    f.canvas.fire('mouseup', { clientX: 85 })
    f.canvas.fire('dblclick', { clientX: 85, detail: 2 })
    expect(pick).not.toHaveBeenCalled()
    expect(f.state().visible).toEqual(['cortex'])
  })

  it('does not toggle on coordinate queries, modified gestures or blank canvas areas', () => {
    const f = atlasFixture()
    expect(f.viewer.locate([2, 5, 5]).selected).toBe('cortex')
    doubleClick(f.canvas, { shiftKey: true })
    doubleClick(f.canvas, { clientX: 110 })
    expect(f.patches).toEqual([])
    expect(f.state().visible).toEqual(['cortex'])
  })

  it('keeps two canvas instances independent', () => {
    const left = atlasFixture(), right = atlasFixture()
    singleClick(left.canvas)
    right.canvas.fire('dblclick', { detail: 2 })
    expect(left.state().visible).toEqual(['cortex'])
    expect(right.patches).toEqual([])
    doubleClick(left.canvas)
    expect(left.state().visible).toEqual([])
    expect(right.state().visible).toEqual(['cortex'])
    right.viewer.setCursorStructure([2, 5, 5], 'deep-structure')
    expect(left.viewer.cursorStructureAt(left.state().position)).toBe('cortex')
    expect(right.viewer.cursorStructureAt(right.state().position)).toBe('deep-structure')
  })

  it('removes pending canvas actions when the viewer is disposed', () => {
    const f = atlasFixture()
    singleClick(f.canvas)
    const before = [...f.patches]
    f.viewer.dispose()
    f.canvas.fire('dblclick', { detail: 2 })
    f.location()
    expect(f.patches).toEqual(before)
  })

  it('intercepts the 2D double click before NiiVue can reset image contrast', () => {
    const f = atlasFixture()
    const nativeReset = vi.fn()
    f.canvas.addEventListener('dblclick', nativeReset)
    const event = doubleClick(f.canvas)
    expect(nativeReset).not.toHaveBeenCalled()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce()
    expect(f.state().visible).toEqual([])
  })
})

function modelFixture(extra:Partial<ModelView>={},deferViewerEcho=false) {
  const canvas = new TestCanvas()
  const manifest = { structures: [{ id: 'native-surface', bounds_native_mm: [[0, 0, 0], [1, 1, 0]] }] } as unknown as SurfaceManifest
  let state:ModelView = { kind:'source-model-view',coordinate_system:'SOURCE_XYZ',selected:'native-surface',visible:['native-surface'],
    position_native_mm:[.2,.2,0],camera:[110,15,.65],focus_native_mm:null,opacity:1,surfaceOpacity:{},annotations:[],showMarkers:true,note:'',...extra }
  const changed = vi.fn((patch: Partial<ModelView>) => {
    state = { ...state, ...patch }
    if(!deferViewerEcho)(viewer as unknown as { current: ModelView }).current = state
  })
  const viewer = new ModelViewer(canvas as unknown as HTMLCanvasElement, manifest, '/atlas/native/', changed, () => {})
  viewers.push(viewer)
  ;(viewer as unknown as { current: ModelView }).current = state
  ;(viewer as unknown as { meshes: Map<string, NVMesh> }).meshes.set('native-surface', {
    pts: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), tris: new Uint32Array([0, 1, 2]), visible: true, opacity: 1,
  } as NVMesh)
  const pick = vi.spyOn(viewer.nv, 'drawScene').mockImplementation(() => {
    if (!viewer.nv.uiData.mouseDepthPicker) return
    viewer.nv.uiData.mouseDepthPicker = false
    viewer.nv.onNativePick([.3, .2, 0])
  })
  return { canvas, viewer, changed, pick, state: () => state }
}

describe('independent model canvas gestures without WebGL', () => {
  function ready(f:ReturnType<typeof modelFixture>){
    const internal=f.viewer as unknown as {appliedKey:string;render(state:ModelView,generation:number):Promise<void>}
    internal.appliedKey=modelRenderKey(f.state())
    return vi.spyOn(internal,'render').mockResolvedValue()
  }

  it('shares one pending model render across identical apply echoes',async()=>{
    const f=modelFixture(),render=ready(f)
    let finish!:()=>void
    render.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve}))
    const next={...f.state(),opacity:.6},pending=f.viewer.apply(next)
    for(let index=0;index<20;index++)expect(f.viewer.apply({...next,note:String(index)})).toBe(pending)
    finish();await pending
    expect(render).toHaveBeenCalledOnce()
    await f.viewer.apply({...next,note:'latest observation'})
    expect(render).toHaveBeenCalledOnce()
  })

  it.each([false,true])('acknowledges already drawn native orbit and zoom without replaying model rendering: highlight=%s',async highlightSelected=>{
    const f=modelFixture({highlightSelected}),render=ready(f)
    for(let index=0;index<20;index++){
      f.viewer.nv.scene.renderAzimuth=40+index;f.viewer.nv.scene.renderElevation=-10+index
      f.viewer.nv.onAzimuthElevationChange(40+index,-10+index)
      f.viewer.nv.scene.volScaleMultiplier=1+index*.05
      f.viewer.nv.onZoom3DChange(1+index*.05)
      await f.viewer.apply(f.state())
    }
    expect(render).not.toHaveBeenCalled()
    expect(f.state().camera.slice(0,2)).toEqual([59,9])
    expect(f.state().camera[2]).toBeCloseTo(1.95)
    expect(f.state().visible).toEqual(['native-surface'])
  })

  it('resolves the sampled native cut before following the picked SOURCE_XYZ cursor',async()=>{
    const cut={axis:0 as const,side:1 as const,position_mm:.25,structures:['native-surface'],followCursor:true}
    const f=modelFixture({surfaceCutaway:cut,position_native_mm:[.25,.2,0]},true),render=ready(f)
    const mesh=(f.viewer as unknown as {meshes:Map<string,NVMesh>}).meshes.get('native-surface')!
    const pts=mesh.pts,tris=mesh.tris,targets=f.viewer.nv.cutawayMeshIds
    targets.add('native-mesh');f.viewer.nv.surfaceCutaway=cut
    f.viewer.nv.onNativePick([.3,.2,0])
    expect(f.state().selected).toBeNull()
    expect(f.state().position_native_mm).toEqual([.3,.2,0])
    expect(f.state().surfaceCutaway?.position_mm).toBe(.3)
    expect(f.viewer.nv.surfaceCutaway?.position_mm).toBe(.3)
    expect(f.viewer.nv.cutawayMeshIds).toBe(targets)
    expect(mesh.pts).toBe(pts);expect(mesh.tris).toBe(tris)
    await f.viewer.apply(f.state())
    expect(render).not.toHaveBeenCalled()
    expect(f.state().coordinate_system).toBe('SOURCE_XYZ')
    expect(f.state().visible).toEqual(['native-surface'])
    expect(f.state().camera).toEqual([110,15,.65])
  })

  it.each([undefined,false])('retains a fixed native cut during cursor picking: %s',followCursor=>{
    const cut={axis:0 as const,side:1 as const,position_mm:.25,structures:['native-surface'],...(followCursor===false?{followCursor}:{})}
    const f=modelFixture({surfaceCutaway:cut})
    f.viewer.nv.surfaceCutaway=cut
    f.viewer.nv.onNativePick([.3,.2,0])
    expect(f.viewer.nv.surfaceCutaway).toBe(cut)
    expect(f.state().surfaceCutaway).toBe(cut)
    expect(f.state().position_native_mm).toEqual([.3,.2,0])
  })

  it('preserves precise native XYZ coordinates in programmatic apply and snapshot',async()=>{
    const f=modelFixture({surfaceCutaway:{axis:2,side:-1,position_mm:0,structures:['native-surface'],followCursor:true}}),render=ready(f)
    const position_native_mm:Vec3=[-18.123456789,21.234567891,1601.345678912]
    const next={...f.state(),position_native_mm}
    await f.viewer.apply(next)
    expect(render.mock.calls[0][0].surfaceCutaway?.position_mm).toBe(position_native_mm[2])
    const snapshot=f.viewer.snapshot(next)
    expect(snapshot.position_native_mm).toEqual(position_native_mm)
    expect(snapshot.surfaceCutaway?.position_mm).toBe(position_native_mm[2])
    expect(snapshot.coordinate_system).toBe('SOURCE_XYZ')
    expect(snapshot).not.toHaveProperty('position_ras_mm')
  })

  it('still renders selection highlight changes after a native following pick',async()=>{
    const cut={axis:0 as const,side:1 as const,position_mm:.25,structures:['native-surface'],followCursor:true}
    const f=modelFixture({surfaceCutaway:cut,position_native_mm:[.25,.2,0],highlightSelected:true}),render=ready(f)
    f.viewer.nv.surfaceCutaway=cut
    f.viewer.nv.onNativePick([.3,.2,0])
    await f.viewer.apply(f.state())
    expect(render).toHaveBeenCalledOnce()
    expect(f.state().selected).toBeNull()
  })

  it('places the native cursor on single and double clicks while preserving surface visibility', () => {
    const f = modelFixture()
    singleClick(f.canvas)
    expect(f.state().visible).toEqual(['native-surface'])
    expect(f.state().position_native_mm).toEqual([.3, .2, 0])
    doubleClick(f.canvas)
    expect(f.state().visible).toEqual(['native-surface'])
    expect(f.state().selected).toBe('native-surface')
    expect(f.viewer.cursorStructureAt(f.state().position_native_mm)).toBe('native-surface')
    expect(f.changed.mock.calls.every(([patch]) => patch.visible === undefined)).toBe(true)
    expect(f.pick).toHaveBeenCalledTimes(3)
  })

  it('keeps a visible model surface selected while only the camera changes', () => {
    const f = modelFixture()
    doubleClick(f.canvas)
    expect(f.viewer.cursorStructureAt(f.state().position_native_mm)).toBe('native-surface')
    f.viewer.nv.onAzimuthElevationChange(120, 20)
    f.viewer.nv.onZoom3DChange(2)
    expect(f.viewer.cursorStructureAt(f.state().position_native_mm)).toBe('native-surface')
    expect(f.state().visible).toEqual(['native-surface'])
    expect(f.state().selected).toBe('native-surface')
    expect(f.state().position_native_mm).toEqual([.3, .2, 0])
    expect(f.state().camera).toEqual([f.viewer.nv.scene.renderAzimuth, f.viewer.nv.scene.renderElevation, 2])
  })

  it('moves the native cursor through empty space without showing a hidden model surface', () => {
    const f = modelFixture({ selected: null, visible: [] }), camera = [...f.state().camera]
    const position: Vec3 = [2.3, 4.5, 6.7]
    f.pick.mockImplementation(() => {
      if (!f.viewer.nv.uiData.mouseDepthPicker) return
      f.viewer.nv.uiData.mouseDepthPicker = false
      f.viewer.nv.onNativePick(position, false)
    })
    doubleClick(f.canvas)
    expect(f.state().position_native_mm).toEqual(position)
    expect(f.state().selected).toBeNull()
    expect(f.state().visible).toEqual([])
    expect(f.state().camera).toEqual(camera)
    expect(f.viewer.cursorStructureAt(position)).toBeNull()
    expect(f.changed.mock.calls.every(([patch]) => patch.visible === undefined)).toBe(true)
    expect(f.pick).toHaveBeenCalledTimes(2)
  })

  it('does not pick or toggle after orbit dragging', () => {
    const f = modelFixture()
    f.canvas.fire('mousedown')
    f.canvas.fire('mousemove', { clientX: 30 })
    f.canvas.fire('mouseup', { clientX: 30 })
    f.canvas.fire('dblclick', { clientX: 30, detail: 2 })
    expect(f.pick).not.toHaveBeenCalled()
    expect(f.changed).not.toHaveBeenCalled()
    expect(f.state().visible).toEqual(['native-surface'])
  })
})
