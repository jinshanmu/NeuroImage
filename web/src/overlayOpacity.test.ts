import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Niivue, type NVImage, type NVMesh } from '@niivue/niivue'
import { AtlasViewer } from './viewer'
import { imageRenderKey } from './renderState'
import { sliceOverlayOpacityShader } from './sliceOverlayOpacity'
import type { LabelVolumeResources } from './labelVolumeResources'
import type { Manifest, ViewState } from './types'

const slice = `#version 300 es
precision highp float;
uniform float opacity;
out vec4 color;
void main(void) {
  vec4 background = vec4(.5, .5, .5, 1.0);
  color = vec4(background.rgb, opacity);
  vec4 ocolor = vec4(1.0, 0.0, 0.0, 1.0);
  float a = color.a + ocolor.a * (1.0 - color.a);
  if (a == 0.0) return;
  color.rgb = mix(color.rgb, ocolor.rgb, ocolor.a / a);
  color.a = a;
}`

const viewers: AtlasViewer[] = []
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1 })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => {
  viewers.splice(0).forEach(viewer => viewer.dispose())
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

function fixture(representation: Manifest['representation'] = 'mri-labels', overlay: ViewState['overlay'] = 'labels') {
  const canvas = { addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement
  const model = representation === 'label-model', independent = representation === 'mri-regions', streamlines = representation === 'mri-streamlines'
  const source = { id: 'one', name: 'One', source_name: 'One', color: [200, 100, 50], mesh_file: 'one.gii',
    bounds_ras_mm: [[0, 0, 0], [10, 10, 10]], target_ras_mm: [5, 5, 5],
    ...(independent ? { kind: 'independent-region', mask: { volume_id: 'mask' } } : {}),
    ...(streamlines ? { kind: 'streamline-bundle', streamlines: { levels: [{ id: 'standard', file: 'one.tck' }, { id: 'preview', file: 'one.tck' }] } } : {}),
    ...(overlay === 'probability' ? { probability: { volume_id: 'probability' } } : {}) }
  const volumes = [
    { id: 't1', kind: 'image', file: 't1.nii', shape: [10, 10, 10], voxel_size_mm: [1, 1, 1] },
    { id: 'labels', kind: 'labels', file: 'labels.nii', shape: [10, 10, 10], voxel_size_mm: [1, 1, 1] },
    { id: 'probability', kind: 'probability', file: 'probability.nii', shape: [10, 10, 10] },
    { id: 'mask', kind: 'mask', file: 'mask.nii', shape: [10, 10, 10] },
  ]
  const manifest = { representation, structures: [source], volumes, assets: [] } as unknown as Manifest
  const state: ViewState = { selected: 'one', visible: ['one'], position: [5, 5, 5], background: model ? 'labels' : 't1',
    overlay, labelOpacity: .45, meshOpacity: 1, radiological: true, layout: 'quad', camera: [110, 15, 1],
    pan: [0, 0, 0, 1], imageContext: false, window: [0, 100], annotations: [], note: '',
    ...(streamlines ? { streamlineLevel: 'standard', streamlineSlabMm: 1, selectionEvidence: { kind: 'visible-streamline', candidates: ['one'] } } : {}) }
  const viewer = new AtlasViewer(canvas, manifest, '/atlas/source/', () => {}, () => {})
  viewers.push(viewer)
  // This fixture measures slice uploads and frame scheduling without a GL
  // context; independent 3D palette/cache/upload behavior has its own tests.
  vi.spyOn((viewer as unknown as { labelVolumes: LabelVolumeResources }).labelVolumes, 'get')
    .mockReturnValue({ texture: 'solid-label-volume' } as unknown as WebGLTexture)
  vi.spyOn((viewer as unknown as { labelIds: LabelVolumeResources }).labelIds, 'get')
    .mockReturnValue({ texture: 'categorical-label-ids' } as unknown as WebGLTexture)
  const label = { opacity: model ? .45 : 1, setColormapLabel: vi.fn(), toRAS: [1], img: new Uint8Array([0, 1]) } as unknown as NVImage
  const background = { opacity: 1, cal_min: 0, cal_max: 100, toRAS: [1], img: new Uint8Array([5, 6]) } as unknown as NVImage
  const field = { opacity: 1, toRAS: [1], img: new Float32Array([.2, .8]) } as unknown as NVImage
  viewer.nv.volumes = model ? [label] : independent ? [background, field] : overlay === 'probability' ? [background, label, field] : [background, label]
  const internal = viewer as unknown as { background: string; current: ViewState; rendered: ViewState; appliedKey: string;
    overlayId: string; meshes: Map<string, NVMesh>; meshFiles: Map<string, string>; masks: Map<string, unknown> }
  internal.background = state.background; internal.current = state; internal.rendered = structuredClone(state); internal.appliedKey = imageRenderKey(state)
  internal.overlayId = overlay === 'probability' ? 'probability' : overlay === 'mask' ? 'mask' : ''
  internal.meshes.set('one', { visible: true, opacity: 1, rgba255: [200, 100, 50, 255],
    ...(streamlines ? { offsetPt0: new Uint32Array([0, 2]), pts: new Float32Array([4, 5, 5, 6, 5, 5]) } : {}) } as unknown as NVMesh)
  internal.meshFiles.set('one', streamlines ? 'one.tck' : 'one.gii')
  if (independent) internal.masks.set('one', {})
  vi.spyOn(viewer.nv, 'mm2frac').mockImplementation(point => new Float32Array([point[0] / 10, point[1] / 10, point[2] / 10]))
  const draw = vi.spyOn(viewer.nv, 'drawScene').mockImplementation(() => {})
  const upload = vi.spyOn(viewer.nv, 'updateGLVolume').mockImplementation(() => {})
  const layers = vi.spyOn(viewer.nv, 'refreshLayers').mockImplementation(() => {})
  vi.spyOn(viewer.nv, 'refreshColormaps').mockImplementation(() => {})
  vi.spyOn(viewer.nv, 'closePAQD').mockImplementation(() => {})
  return { viewer, state, draw, upload, layers, label, background, field }
}

describe('source slice opacity modulation', () => {
  it.each([
    { settings: { showCursor: false }, shown: false },
    { settings: { showCursor: true, show3DCursor: false }, shown: true },
    { settings: { show3DCursor: false }, shown: false },
    { settings: {}, shown: true },
  ])('synchronizes both cursor displays with explicit and legacy visibility %j', async ({ settings, shown }) => {
    const f = fixture(), original = structuredClone(f.state)
    await f.viewer.apply({ ...f.state, showCursor: false })
    await f.viewer.apply({ ...f.state, ...settings })
    expect(f.viewer.nv.opts.show3Dcrosshair).toBe(shown)
    expect(f.viewer.nv.opts.crosshairWidth).toBe(shown ? 1 : 0)
    expect(Array.from(f.viewer.nv.scene.crosshairPos)).toEqual([.5, .5, .5])
    expect(f.viewer.snapshot({ ...f.state, ...settings }).position).toEqual(original.position)
    expect(f.state.visible).toEqual(original.visible)
    expect(f.state.selected).toBe(original.selected)
    expect(f.upload).not.toHaveBeenCalled()
    expect(f.layers).not.toHaveBeenCalled()
  })

  it('keeps automatic 3D framing fixed across global and selected opacity endpoints', async () => {
    const f = fixture()
    const state = { ...f.state, fitVisible3D: true, zoom3D: 1 }
    await f.viewer.apply(state)
    const bounds = structuredClone(f.viewer.nv.fitBounds), focus = [...f.viewer.nv.focus3D!]
    expect(bounds).toEqual([[0, 0, 0], [10, 10, 10]])
    for (const meshOpacity of [.95, .5, .05, 0, 1]) {
      await f.viewer.apply({ ...state, meshOpacity })
      expect(f.viewer.nv.fitBounds).toEqual(bounds)
      expect(f.viewer.nv.focus3D).toEqual(focus)
    }
    await f.viewer.apply({ ...state, surfaceOpacity: { one: 0 } })
    expect(f.viewer.nv.fitBounds).toEqual(bounds)
    expect(f.viewer.nv.focus3D).toEqual(focus)
    await f.viewer.apply({ ...state, visible: [] })
    expect(f.viewer.nv.fitBounds).toBeNull()
  })
  it('scales only the final overlay alpha after native color selection and before composition', () => {
    const changed = sliceOverlayOpacityShader(slice)
    expect(changed).toContain('uniform float neuroimageOverlayOpacity;')
    expect(changed).toContain('ocolor.a *= neuroimageOverlayOpacity;\n\tfloat a = color.a + ocolor.a * (1.0 - color.a);')
    expect(changed).toContain('color = vec4(background.rgb, opacity);')
    expect(changed).not.toContain('background.a *=')
    const native = readFileSync(new URL('../../node_modules/@niivue/niivue/src/shader-srcs.ts', import.meta.url), 'utf8')
    expect(native).toContain('float a = color.a + ocolor.a * (1.0 - color.a);')
  })

  it('fails closed if a dependency update changes the pinned composition hook', () => {
    expect(() => sliceOverlayOpacityShader('void main() {}')).toThrow('recognized overlay composition')
    expect(() => sliceOverlayOpacityShader(slice + slice)).toThrow('recognized overlay composition')
  })

  it('installs the slice shader once and updates only its overlay uniform while restoring base opacity', () => {
    const f = fixture(), nativeProgram = {}, ownedProgram = {}, nativeFragment = {}, ownedFragment = {}
    const gl = {
      SHADER_TYPE: 35663, FRAGMENT_SHADER: 35632,
      getAttachedShaders: vi.fn(program => program === nativeProgram ? [nativeFragment] : [ownedFragment]),
      getShaderParameter: vi.fn(() => 35632), getShaderSource: vi.fn(() => slice),
      uniform1f: vi.fn(), deleteShader: vi.fn(), deleteProgram: vi.fn(),
    }
    Object.defineProperty(f.viewer.nv, 'gl', { value: gl })
    f.viewer.nv.sliceMMShader = { program: nativeProgram } as typeof f.viewer.nv.sliceMMShader
    const material = { program: ownedProgram, uniforms: { neuroimageOverlayOpacity: 'overlay-opacity' }, use: vi.fn() }
    const install = vi.spyOn(f.viewer.nv, 'setCustomSliceShader').mockImplementation(fragment => {
      expect(fragment).toContain('ocolor.a *= neuroimageOverlayOpacity;')
      expect(f.viewer.nv.deferVolumeUploads).toBe(true)
      f.viewer.nv.customSliceShader = material as unknown as typeof f.viewer.nv.customSliceShader
    })
    f.viewer.nv.installSliceOverlayOpacity(); f.viewer.nv.installSliceOverlayOpacity()
    expect(install).toHaveBeenCalledOnce()
    expect(f.viewer.nv.deferVolumeUploads).toBe(false)
    f.viewer.nv.sliceOverlayOpacity = .2; f.viewer.nv.sliceBackgroundOpacity = .6
    const nativeDraw = vi.spyOn(Niivue.prototype, 'draw2DMain').mockImplementation(() => {
      expect(f.background.opacity).toBe(.6)
    })
    f.viewer.nv.draw2DMain([0, 0, 100, 100], 0)
    expect(nativeDraw).toHaveBeenCalledOnce()
    expect(gl.uniform1f).toHaveBeenCalledWith('overlay-opacity', .2)
    expect(f.background.opacity).toBe(1)
    expect(f.upload).not.toHaveBeenCalled(); expect(f.layers).not.toHaveBeenCalled()
    vi.spyOn(Niivue.prototype, 'cleanup').mockImplementation(() => {})
    f.viewer.nv.cleanup()
    expect(gl.deleteProgram).toHaveBeenCalledWith(ownedProgram)
    expect(gl.deleteShader).toHaveBeenCalledWith(ownedFragment)
    expect(f.viewer.nv.customSliceShader).toBeNull()
  })

  it.each([
    ['mri-labels', 'labels'], ['mri-labels', 'probability'], ['mri-regions', 'mask'], ['mri-regions', 'probability'],
  ] as const)('moves %s / %s opacity to the slice draw without texture or palette rebuilds', async (representation, overlay) => {
    const f = fixture(representation, overlay), samples = f.viewer.nv.volumes.map(volume => volume.img)
    for (const opacity of [0, .05, .5, 1, .4]) {
      await f.viewer.apply({ ...f.state, labelOpacity: opacity })
      expect(f.viewer.nv.sliceOverlayOpacity).toBe(opacity)
    }
    expect(f.upload).not.toHaveBeenCalled(); expect(f.layers).not.toHaveBeenCalled()
    expect(f.label.setColormapLabel).not.toHaveBeenCalled()
    expect(f.draw).toHaveBeenCalledTimes(5)
    expect(f.viewer.nv.volumes.map(volume => volume.img)).toEqual(samples)
    if (representation === 'mri-labels') expect(f.label.opacity).toBe(overlay === 'probability' ? 0 : 1)
    expect(f.field.opacity).toBe(1)
    expect((f.viewer as unknown as { meshes: Map<string, NVMesh> }).meshes.get('one')!.opacity).toBe(1)
  })

  it('updates categorical-model base opacity directly and restores it from zero without reupload', async () => {
    const f = fixture('label-model')
    await f.viewer.apply({ ...f.state, labelOpacity: 0 })
    expect(f.label.opacity).toBe(0)
    await f.viewer.apply({ ...f.state, labelOpacity: .8 })
    expect(f.label.opacity).toBe(.8)
    expect(f.viewer.nv.sliceOverlayOpacity).toBe(1)
    expect(f.upload).not.toHaveBeenCalled(); expect(f.layers).not.toHaveBeenCalled()
    expect(f.label.setColormapLabel).not.toHaveBeenCalled()
    expect(f.draw).toHaveBeenCalledTimes(2)
  })

  it('retains overlay uploads for changed visible labels and full image upload for a changed window', async () => {
    const f = fixture()
    await f.viewer.apply({ ...f.state, visible: [] })
    expect(f.layers).toHaveBeenCalledWith(f.label, 1)
    expect(f.label.setColormapLabel).toHaveBeenCalledOnce()
    expect(f.upload).not.toHaveBeenCalled()
    await f.viewer.apply({ ...f.state, visible: [], window: [10, 90] })
    expect(f.upload).toHaveBeenCalledOnce()
  })

  it('does not rescan source trajectories for changes between positive opacity values', async () => {
    const f = fixture('mri-streamlines', 'streamlines'), locate = vi.spyOn(f.viewer, 'locate')
    for (const change of [{ labelOpacity: .2 }, { labelOpacity: .8 }, { meshOpacity: .5 }, { meshOpacity: .8 }, { surfaceOpacity: { one: .4 } }, { surfaceOpacity: { one: .9 } }]) {
      await f.viewer.apply({ ...f.state, ...change })
    }
    expect(locate).not.toHaveBeenCalled()
    expect(f.layers).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled()
  })

  it('rescans trajectories only when opacity changes effective zero/nonzero visibility', async () => {
    const f = fixture('mri-streamlines', 'streamlines'), locate = vi.spyOn(f.viewer, 'locate')
    let state = { ...f.state, labelOpacity: 0 }
    await f.viewer.apply(state)
    expect(locate).toHaveBeenCalledTimes(1)
    state = { ...state, labelOpacity: .4 }
    await f.viewer.apply(state)
    expect(locate).toHaveBeenCalledTimes(2)
    state = { ...state, meshOpacity: 0 }
    await f.viewer.apply(state)
    expect(locate).toHaveBeenCalledTimes(3)
    state = { ...state, surfaceOpacity: { one: .2 } }
    await f.viewer.apply(state)
    expect(locate).toHaveBeenCalledTimes(3)
    state = { ...state, meshOpacity: .6 }
    await f.viewer.apply(state)
    expect(locate).toHaveBeenCalledTimes(4)
    state = { ...state, surfaceOpacity: { one: 0 } }
    await f.viewer.apply(state)
    expect(locate).toHaveBeenCalledTimes(5)
  })

  it('still rescans trajectories when cursor, source slab or displayed membership changes', async () => {
    const f = fixture('mri-streamlines', 'streamlines'), locate = vi.spyOn(f.viewer, 'locate')
    let state = { ...f.state, position: [4.5, 5, 5] as ViewState['position'] }
    await f.viewer.apply(state)
    state = { ...state, streamlineSlabMm: 2 }
    await f.viewer.apply(state)
    state = { ...state, streamlineLevel: 'preview' }
    await f.viewer.apply(state)
    state = { ...state, visible: [] }
    await f.viewer.apply(state)
    expect(locate).toHaveBeenCalledTimes(4)
  })
})
