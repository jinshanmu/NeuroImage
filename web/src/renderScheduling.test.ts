import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NVImage, NVMesh } from '@niivue/niivue'
import { AtlasViewer } from './viewer'
import { ModelViewer } from './modelViewer'
import type { Manifest, ViewState } from './types'
import type { ModelView, SurfaceManifest } from './modelTypes'

type DisplayState = ViewState | ModelView
const viewers: { dispose(): void }[] = []
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1 })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => {
  viewers.splice(0).forEach(viewer => viewer.dispose())
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

function fixture(kind: 'atlas' | 'model', visible = ['first', 'second', 'third']) {
  const ids = ['first', 'second', 'third'], canvas = { addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement
  const structures = ids.map(id => ({ id, name: id, source_name: id, mesh_file: id + '.gii', color: [80, 100, 120],
    bounds_native_mm: [[0, 0, 0], [1, 1, 1]], target_native_mm: [.2, .2, .2],
    bounds_ras_mm: [[0, 0, 0], [1, 1, 1]], target_ras_mm: [.2, .2, .2],
    kind: 'independent-region', voxel_count: 1, mask: { volume_id: id } }))
  const volumes = [{ id: 'image', kind: 'image', shape: [2, 2, 2], voxel_size_mm: [1, 1, 1] },
    ...ids.map(id => ({ id, kind: 'mask', shape: [2, 2, 2], voxel_size_mm: [1, 1, 1] }))]
  const state: DisplayState = kind === 'model'
    ? { kind: 'source-model-view', coordinate_system: 'SOURCE_XYZ', selected: 'first', visible, position_native_mm: [.2, .2, .2],
      camera: [110, 15, .65], focus_native_mm: null, opacity: 1, surfaceOpacity: {}, annotations: [], showMarkers: true, note: '' }
    : { selected: 'first', visible, position: [.2, .2, .2], background: 'image', overlay: 'none', labelOpacity: .5, meshOpacity: 1,
      radiological: true, layout: 'quad', camera: [110, 15, .65], pan: [0, 0, 0, 1], imageContext: false, window: [0, 100], annotations: [], note: '' }
  const viewer = kind === 'model'
    ? new ModelViewer(canvas, { structures } as unknown as SurfaceManifest, '/source/', () => {}, () => {})
    : new AtlasViewer(canvas, { representation: 'mri-regions', structures, volumes, assets: [] } as unknown as Manifest, '/source/', () => {}, () => {})
  viewers.push(viewer)
  const nv = viewer.nv
  nv.gl = {} as WebGL2RenderingContext
  const draw = vi.spyOn(nv, 'drawScene').mockImplementation(() => {})
  const meshes = (viewer as unknown as { meshes: Map<string, NVMesh> }).meshes
  const add = vi.spyOn(nv, 'addMeshFromUrl').mockImplementation(async options => ({ id: options!.name, visible: false, opacity: 1,
    pts: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), tris: new Uint32Array([0, 1, 2]),
    rgba255: new Uint8Array(options!.rgba255!), setProperty: vi.fn() } as unknown as NVMesh))
  if (viewer instanceof AtlasViewer) {
    const internal = viewer as unknown as { background: string; rendered: ViewState; masks: Map<string, unknown> }
    internal.background = 'image'; internal.rendered = structuredClone(state as ViewState)
    for (const id of ids) internal.masks.set(id, { indices: new Uint32Array([0]), volume: volumes.find(volume => volume.id === id) })
    nv.volumes = [{ opacity: 1, cal_min: 0, cal_max: 100 }] as NVImage[]
    vi.spyOn(nv, 'mm2frac').mockImplementation(point => new Float32Array([point[0], point[1], point[2]]))
    vi.spyOn(nv, 'refreshColormaps').mockImplementation(() => {})
    vi.spyOn(nv, 'closePAQD').mockImplementation(() => {})
    vi.spyOn(nv, 'refreshLayers').mockImplementation(() => {})
  }
  let finish!: () => void
  const blocked = new Promise<ArrayBuffer>(resolve => { finish = () => resolve(new ArrayBuffer(8)) })
  const requests = vi.fn(async (url: string) => ({ ok: true, arrayBuffer: () => url.endsWith('first.gii') ? blocked : Promise.resolve(new ArrayBuffer(8)) }))
  vi.stubGlobal('fetch', requests)
  const apply = (next: DisplayState) => viewer instanceof AtlasViewer ? viewer.apply(next as ViewState) : viewer.apply(next as ModelView)
  return { viewer, nv, state, apply, draw, add, meshes, requests, finish }
}

describe('source preparation while display input is queued', () => {
  it.each(['atlas', 'model'] as const)('finishes each %s source read once across repeated opacity/cursor/camera/Cutaway input and applies the latest display', async kind => {
    const f = fixture(kind), pending = f.apply(f.state)
    // Atlas setup first yields after its already cached mask stage.
    await Promise.resolve(); await Promise.resolve()
    expect(f.requests).toHaveBeenCalledTimes(3)
    for (let index = 0; index < 10; index++) {
      const point = [.2 + index / 100, .3, .4] as [number, number, number]
      const next = { ...f.state, camera: [40 + index, -10, 1 + index / 10],
        surfaceCutaway: { axis: 0, side: 1, position_mm: point[0], structures: f.state.visible, followCursor: true },
        ...(kind === 'model' ? { opacity: .2 + index / 100, position_native_mm: point } : { meshOpacity: .2 + index / 100, position: point }) } as DisplayState
      expect(f.apply(next)).toBe(pending)
      for (let echo = 0; echo < 3; echo++) expect(f.apply({ ...next, note: String(echo) })).toBe(pending)
    }
    f.finish(); await pending
    expect(f.requests).toHaveBeenCalledTimes(3)
    expect(new Set(f.requests.mock.calls.map(([url]) => url))).toHaveLength(3)
    expect(f.add).toHaveBeenCalledTimes(3)
    expect([...f.meshes.keys()]).toEqual(['first', 'second', 'third'])
    for (const mesh of f.meshes.values()) expect(mesh.opacity).toBeCloseTo(.29)
    expect(f.nv.scene.renderAzimuth).toBe(49)
    expect(f.nv.scene.volScaleMultiplier).toBeCloseTo(1.9)
    expect(f.nv.surfaceCutaway?.position_mm).toBeCloseTo(.29)
    expect(f.draw).toHaveBeenCalledTimes(kind === 'model' ? 1 : 2)
  })

  it.each(['atlas', 'model'] as const)('invalidates obsolete %s geometry and settles the final visible source without drawing stale meshes', async kind => {
    const f = fixture(kind, ['first', 'second']), pending = f.apply(f.state)
    await Promise.resolve(); await Promise.resolve()
    expect(f.requests).toHaveBeenCalledTimes(2)
    const latest = { ...f.state, visible: ['third'], selected: 'third' } as DisplayState
    f.apply(latest); f.finish(); await pending
    expect(f.requests).toHaveBeenCalledTimes(3)
    expect(f.add).toHaveBeenCalledOnce()
    expect([...f.meshes.keys()]).toEqual(['third'])
    expect(f.meshes.get('third')!.visible).toBe(true)
    expect(f.add.mock.calls[0][0]?.name).toBe('third.gii')
  })
})
