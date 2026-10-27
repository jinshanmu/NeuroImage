import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Niivue, type NVImage, type NVMesh } from '@niivue/niivue'
import { SourceDepthNiivue } from './depthRenderer'
import { AtlasViewer } from './viewer'
import type { TransparentLabelVolume } from './transparentLabelVolume'
import type { LabelVolumePalette, LabelVolumeResources } from './labelVolumeResources'
import type { Manifest, ViewState } from './types'

const viewers: AtlasViewer[] = []
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1 })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => {
  viewers.splice(0).forEach(viewer => viewer.dispose())
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

function renderer(manifest = { representation: 'mri-labels', structures: [], volumes: [] } as unknown as Manifest) {
  const canvas = { addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement
  const viewer = new AtlasViewer(canvas, manifest, '', () => {}, () => {})
  viewers.push(viewer)
  const nv = viewer.nv, source = { texture: 'source MRI' } as unknown as WebGLTexture
  // Pixel-scissor restoration is covered independently; this fixture isolates
  // volume samplers and compositing without a complete WebGL rasterizer.
  vi.spyOn(nv, 'withDepthPickScissor').mockImplementation(draw => draw())
  const anatomy = { texture: 'solid source labels' } as unknown as WebGLTexture
  let active = 1007
  let depth = 519
  const bindings = new Map<number, WebGLTexture | null>([[1000, source]])
  const uniforms = new Map<unknown, number>()
  const gl = {
    ACTIVE_TEXTURE: 1, TEXTURE_BINDING_3D: 2, TEXTURE0: 1000, TEXTURE_3D: 3, DEPTH_FUNC: 4, LEQUAL: 515, VIEWPORT: 5,
    RGBA: 6, UNSIGNED_BYTE: 7, canvas: { width: 100, height: 100 },
    getParameter: vi.fn((parameter: number) => parameter === 1 ? active : parameter === 4 ? depth : parameter === 5 ? [0, 0, 100, 100] : bindings.get(active)),
    depthFunc: vi.fn((value: number) => { depth = value }),
    activeTexture: vi.fn((value: number) => { active = value }),
    bindTexture: vi.fn((_target: number, texture: WebGLTexture | null) => { bindings.set(active, texture) }),
    uniform1f: vi.fn((name: unknown, value: number) => { uniforms.set(name, value) }), uniform4fv: vi.fn(), readPixels: vi.fn(),
  }
  Object.defineProperty(nv, 'gl', { value: gl })
  nv.renderShader = { use: vi.fn(), uniforms: { backOpacity: 'background', overlays: 'overlays', clipPlaneColor: 'cut-color' } } as unknown as typeof nv.renderShader
  nv.pickingImageShader = { use: vi.fn(), uniforms: { overlays: 'picking-overlays' } } as unknown as typeof nv.pickingImageShader
  nv.volumes = [{ opacity: .42, img: new Float32Array([4, 8, 12, 16]) }] as NVImage[]
  nv.overlays = [{}] as typeof nv.overlays
  nv.imageContext = false
  nv.anatomyVolumeTexture = anatomy
  nv.surfaceCutaway = { axis: 0, side: 1, position_mm: 25, structures: ['cortex'] }
  nv.scene.clipPlaneDepthAziElevs = [[.22, 60, 15]]
  nv.opts.isClipPlanesCutaway = true; nv.opts.isClipAllVolumes = false
  vi.spyOn(nv, 'frac2mm').mockImplementation(fraction => Float32Array.from([200 * fraction[0] - 100, 160 * fraction[1] - 80, 80 * fraction[2] - 40, 1]))
  vi.spyOn(nv, 'mm2frac').mockImplementation(point => Float32Array.from([point[0]/200+.5,point[1]/160+.5,point[2]/80+.5]))
  return { viewer, nv, source, anatomy, gl, active: () => active, boundSource: () => bindings.get(1000), drawOpacity: () => uniforms.get('background') }
}

describe('solid categorical volumes in the existing 3D draw path', () => {
  it.each(['mri-labels', 'ct-labels'] as const)('draws actual cerebellum, brainstem and deep context labels instead of an intensity head volume for %s', async representation => {
    const names = ['cortex', 'cerebellum', 'brainstem', 'thalamus', 'other']
    const bounds = [[[0, 0, 0], [10, 10, 10]], [[-15, -30, -50], [20, -5, 0]], [[-5, -10, -75], [5, 0, -20]],
      [[-7, -12, -15], [7, 5, 0]], [[0, 0, 0], [10, 10, 10]]]
    const structures = names.map((id, index) => ({ id, name: id, source_name: id, color: [100 + index, 130, 160],
      mesh_file: id + '.gii', bounds_ras_mm: bounds[index], target_ras_mm: [5, 5, 10] }))
    const manifest = { representation, structures, volumes: [
      { id: 'image', kind: 'image', shape: [10, 10, 10], voxel_size_mm: [1, 1, 1] },
      { id: 'labels', kind: 'labels', shape: [10, 10, 10], voxel_size_mm: [1, 1, 1] },
    ], assets: [] } as unknown as Manifest
    const f = renderer(manifest), contextTexture = { texture: 'anatomical context labels' } as unknown as WebGLTexture
    const state: ViewState = { selected: 'cortex', visible: ['cortex'], position: [5, 5, 10], background: 'image', overlay: 'labels',
      labelOpacity: .45, meshOpacity: 1, radiological: true, layout: 'quad', camera: [110, 15, 1], pan: [0, 0, 0, 1],
      imageContext: false, backgroundOpacity3D: .7, window: [0, 100], annotations: [], note: '', fitVisible3D: true,
      surfaceContext: { enabled: true, opacity: .35, structure_ids: ['cortex', 'cerebellum', 'brainstem', 'thalamus'] } }
    const label = { opacity: 1, setColormapLabel: vi.fn(), toRAS: [1], img: new Uint8Array([1, 2, 3, 4, 5]) } as unknown as NVImage
    f.nv.volumes.push(label)
    const internal = f.viewer as unknown as { background: string; current: ViewState; rendered: ViewState; meshes: Map<string, NVMesh>;
      meshFiles: Map<string, string>; labelVolumes: LabelVolumeResources; contextVolumes: LabelVolumeResources }
    internal.background = 'image'; internal.current = state; internal.rendered = structuredClone(state)
    for (const structure of structures) {
      internal.meshes.set(structure.id, { id: structure.id, rgba255: [...structure.color, 255], setProperty: vi.fn() } as unknown as NVMesh)
      internal.meshFiles.set(structure.id, structure.mesh_file)
    }
    const foregroundPalettes: LabelVolumePalette[] = [], contextPalettes: LabelVolumePalette[] = []
    vi.spyOn(internal.labelVolumes, 'get').mockImplementation((_nv, source, palette) => {
      expect(source).toBe(label); foregroundPalettes.push(palette); return f.anatomy
    })
    vi.spyOn(internal.contextVolumes, 'get').mockImplementation((_nv, source, palette) => {
      expect(source).toBe(label); contextPalettes.push(palette); return contextTexture
    })
    vi.spyOn(f.nv, 'updateGLVolume').mockImplementation(() => {})
    vi.spyOn(f.nv, 'drawScene').mockImplementation(() => f.nv.drawImage3D(new Float32Array(16), 110, 15))
    const draws: { texture: WebGLTexture | null | undefined; opacity: number | undefined }[] = []
    vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(() => { draws.push({ texture: f.boundSource(), opacity: f.drawOpacity() }) })
    await f.viewer.apply(state)
    expect(contextPalettes).toHaveLength(1)
    expect(contextPalettes[0].A).toEqual([0, 0, 255, 255, 255, 0])
    expect(foregroundPalettes[0].A).toEqual([0, 255, 0, 0, 0, 0])
    expect(draws).toEqual([{ texture: contextTexture, opacity: .35 }, { texture: f.anatomy, opacity: 1 }])
    expect(f.nv.imageContext).toBe(false)
    expect(f.nv.volumeBackgroundOpacity).toBe(.7)
    expect(f.nv.anatomyContextOpacity).toBe(.35)
    expect(f.nv.sliceBackgroundOpacity).toBe(1)
    expect(f.nv.sliceOverlayOpacity).toBe(.45)
    expect(state.visible).toEqual(['cortex'])
    f.nv.volumeObject3D = { extentsMin: [-100, -100, -100], extentsMax: [100, 100, 100] } as typeof f.nv.volumeObject3D
    vi.spyOn(Niivue.prototype, 'draw3D').mockImplementation(() => {})
    const projection = () => {
      f.nv.setPivot3D(); f.nv.draw3D([0, 0, 100, 100])
      return { matrix: Array.from(f.nv.calculateMvpMatrix(null, [0, 0, 100, 100], f.nv.scene.renderAzimuth, f.nv.scene.renderElevation)[0]),
        pivot: [...f.nv.pivot3D], focus: f.nv.focus3D, scale: f.nv.scene.volScaleMultiplier, bounds: f.nv.fitBounds }
    }
    for (const settings of [{ fitVisible3D: true, zoom3D: 1 },
      { fitVisible3D: true, zoom3D: 2.7, camera: [67, -17, 2.7] as ViewState['camera'] },
      { fitVisible3D: false, zoom3D: 3, camera: [142, 27, 3] as ViewState['camera'], focus3D: [3, -2, 1] as [number, number, number] }]) {
      for (const mode of ['surface', 'volume']) {
        const view = (opacity: number): ViewState => ({ ...state, ...settings, imageContext: mode === 'volume' && opacity > 0,
          surfaceContext: { ...state.surfaceContext!, enabled: mode === 'surface' && opacity > 0, opacity } })
        await f.viewer.apply(view(0))
        const original = projection()
        expect(original.matrix.every(Number.isFinite)).toBe(true)
        if (settings.fitVisible3D) expect(f.nv.fitBounds![0][2]).toBe(-75)
        for (const opacity of [.05, .6, 0]) {
          await f.viewer.apply(view(opacity))
          expect(projection()).toEqual(original)
        }
      }
    }
    const contextsWhenEnabled = contextPalettes.length
    draws.length = 0
    await f.viewer.apply({ ...state, surfaceContext: { ...state.surfaceContext!, enabled: false } })
    expect(f.nv.anatomyContextTexture).toBeNull()
    expect(contextPalettes).toHaveLength(contextsWhenEnabled)
    expect(draws).toEqual([{ texture: f.anatomy, opacity: 1 }])
  })

  it.each([false, true])('renders and picks labels with MRI context off, using the same clipped source volume: picking=%s', picking => {
    const f = renderer(), planes = f.nv.scene.clipPlaneDepthAziElevs
    f.nv.uiData.mouseDepthPicker = picking
    const draw = vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(function (this: Niivue) {
      expect(f.boundSource()).toBe(f.anatomy)
      expect(this.scene.clipPlaneDepthAziElevs[0][0]).toBeCloseTo(.125)
      expect(this.scene.clipPlaneDepthAziElevs[0][1]).toBeCloseTo(90)
      expect(this.opts.isClipPlanesCutaway).toBe(false)
      expect(this.opts.isClipAllVolumes).toBe(true)
    })
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    expect(draw).toHaveBeenCalledOnce()
    expect(f.boundSource()).toBe(f.source); expect(f.active()).toBe(1007)
    expect(f.nv.scene.clipPlaneDepthAziElevs).toBe(planes)
    expect(f.nv.opts.isClipPlanesCutaway).toBe(true); expect(f.nv.opts.isClipAllVolumes).toBe(false)
    expect(f.gl.uniform1f).toHaveBeenCalledWith(picking ? 'picking-overlays' : 'overlays', 0)
    if (picking) expect(f.nv.renderShader!.use).not.toHaveBeenCalled()
    else {
      expect(f.gl.uniform1f).toHaveBeenCalledWith('background', 1)
      expect(f.gl.uniform1f).toHaveBeenCalledWith('background', .42)
      expect(f.gl.uniform4fv).toHaveBeenCalledWith('cut-color', [0, 0, 0, 0])
      expect(f.gl.uniform4fv).toHaveBeenLastCalledWith('cut-color', f.nv.opts.clipPlaneColor)
    }
  })

  it('restores the source sampler, active unit and clip settings even when the solid draw fails', () => {
    const f = renderer(), planes = f.nv.scene.clipPlaneDepthAziElevs
    vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(() => { throw new Error('solid draw failed') })
    expect(() => f.nv.drawImage3D(new Float32Array(16), 110, 15)).toThrow('solid draw failed')
    expect(f.boundSource()).toBe(f.source); expect(f.active()).toBe(1007)
    expect(f.nv.scene.clipPlaneDepthAziElevs).toBe(planes)
    expect(f.nv.opts.isClipPlanesCutaway).toBe(true); expect(f.nv.opts.isClipAllVolumes).toBe(false)
    expect(f.gl.uniform1f).toHaveBeenLastCalledWith('overlays', 1)
  })

  it('composites the real image first and independently faded foreground last without changing native depth ordering', () => {
    const f = renderer(), observed: (WebGLTexture | null | undefined)[] = []
    f.nv.imageContext = true; f.nv.volumeBackgroundOpacity = .35
    vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(() => { observed.push(f.boundSource()) })
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    expect(observed).toEqual([f.source, f.anatomy])
    expect(f.gl.uniform1f).toHaveBeenCalledWith('background', .35)
    expect(f.gl.depthFunc).not.toHaveBeenCalled()
    expect(f.boundSource()).toBe(f.source); expect(f.active()).toBe(1007)
  })

  it.each([.25, .5, .75])('applies global %s opacity to the completed foreground volume rather than individual voxels', opacity => {
    const f = renderer(), observed: number[] = []
    f.nv.anatomyVolumeOpacity = opacity
    vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(() => { observed.push(f.drawOpacity()!) })
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    expect(observed).toEqual([opacity])
    expect(f.boundSource()).toBe(f.source); expect(f.active()).toBe(1007)
  })

  it.each([.25, .5, .75])('uses categorical IDs and %s opacity for the transparent foreground draw without changing the 2D source', opacity => {
    const f = renderer(), planes = f.nv.scene.clipPlaneDepthAziElevs
    const ids = { texture: 'categorical source IDs' } as unknown as WebGLTexture
    const samples = f.nv.volumes.map(volume => volume.img)
    const sourceValues = Array.from(samples[0]!)
    f.nv.anatomyIdTexture = ids; f.nv.anatomyVolumeOpacity = opacity
    const helper = (f.nv as unknown as { transparentLabels: TransparentLabelVolume }).transparentLabels
    const transparent = vi.spyOn(helper, 'draw').mockImplementation((viewer, idTexture, value, draw) => {
      expect(viewer).toBe(f.nv); expect(idTexture).toBe(ids); expect(value).toBe(opacity)
      expect(f.boundSource()).toBe(f.anatomy); expect(f.drawOpacity()).toBe(opacity)
      expect(viewer.scene.clipPlaneDepthAziElevs[0][0]).toBeCloseTo(.125)
      return draw()
    })
    const native = vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(() => {})
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    expect(transparent).toHaveBeenCalledOnce(); expect(native).toHaveBeenCalledOnce()
    expect(f.boundSource()).toBe(f.source); expect(f.active()).toBe(1007)
    expect(f.nv.scene.clipPlaneDepthAziElevs).toBe(planes)
    expect(f.nv.anatomyIdTexture).toBe(ids)
    f.nv.volumes.forEach((volume, index) => expect(volume.img).toBe(samples[index]))
    expect(Array.from(f.nv.volumes[0].img!)).toEqual(sourceValues)
    const slices = vi.spyOn(Niivue.prototype, 'draw2DMain').mockImplementation(() => {
      expect(f.boundSource()).toBe(f.source); expect(f.nv.volumes[0].opacity).toBe(.42)
    })
    f.nv.draw2DMain([0, 0, 100, 100], 0)
    expect(slices).toHaveBeenCalledOnce(); expect(transparent).toHaveBeenCalledOnce()
  })

  it.each([
    { opacity: 1, picking: false, nativeDraws: 1 },
    { opacity: .5, picking: true, nativeDraws: 1 },
    { opacity: 0, picking: false, nativeDraws: 0 },
    { opacity: 0, picking: true, nativeDraws: 0 },
  ])('bypasses transparent ray composition for an opaque, zero or picking pass: %j', ({ opacity, picking, nativeDraws }) => {
    const f = renderer(), planes = f.nv.scene.clipPlaneDepthAziElevs
    f.nv.anatomyIdTexture = { texture: 'categorical source IDs' } as unknown as WebGLTexture
    f.nv.anatomyVolumeOpacity = opacity; f.nv.uiData.mouseDepthPicker = picking
    const helper = (f.nv as unknown as { transparentLabels: TransparentLabelVolume }).transparentLabels
    const transparent = vi.spyOn(helper, 'draw').mockImplementation((_viewer, _ids, _opacity, draw) => draw())
    const native = vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(() => {})
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    expect(transparent).not.toHaveBeenCalled(); expect(native).toHaveBeenCalledTimes(nativeDraws)
    expect(f.boundSource()).toBe(f.source); expect(f.active()).toBe(1007)
    expect(f.nv.scene.clipPlaneDepthAziElevs).toBe(planes)
  })

  it('restores source bindings and clipping if transparent categorical composition throws', () => {
    const f = renderer(), planes = f.nv.scene.clipPlaneDepthAziElevs
    f.nv.anatomyIdTexture = { texture: 'categorical source IDs' } as unknown as WebGLTexture
    f.nv.anatomyVolumeOpacity = .5
    const helper = (f.nv as unknown as { transparentLabels: TransparentLabelVolume }).transparentLabels
    vi.spyOn(helper, 'draw').mockImplementation(() => { throw new Error('transparent draw failed') })
    expect(() => f.nv.drawImage3D(new Float32Array(16), 110, 15)).toThrow('transparent draw failed')
    expect(f.boundSource()).toBe(f.source); expect(f.active()).toBe(1007)
    expect(f.nv.scene.clipPlaneDepthAziElevs).toBe(planes)
    expect(f.nv.opts.isClipPlanesCutaway).toBe(true); expect(f.nv.opts.isClipAllVolumes).toBe(false)
    expect(f.gl.uniform1f).toHaveBeenLastCalledWith('overlays', 1)
    expect(f.gl.uniform4fv).toHaveBeenLastCalledWith('cut-color', f.nv.opts.clipPlaneColor)
  })

  it.each(['MRI', 'categorical'] as const)('keeps foreground and %s background opacity independent in both adjustment directions', kind => {
    const f = renderer(), context = { texture: 'context labels' } as unknown as WebGLTexture
    f.nv.imageContext = kind === 'MRI'
    f.nv.anatomyContextTexture = context
    f.nv.volumeBackgroundOpacity = .35; f.nv.anatomyContextOpacity = .35
    const background = kind === 'MRI' ? f.source : context
    const observed: { texture: WebGLTexture | null | undefined; opacity: number | undefined }[] = []
    vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(() => { observed.push({ texture: f.boundSource(), opacity: f.drawOpacity() }) })
    for (const opacity of [.25, .5, .75]) {
      observed.length = 0; f.nv.anatomyVolumeOpacity = opacity
      f.nv.drawImage3D(new Float32Array(16), 110, 15)
      expect(observed).toEqual([{ texture: background, opacity: .35 }, { texture: f.anatomy, opacity }])
    }
    f.nv.anatomyVolumeOpacity = .5
    for (const opacity of [.1, .6, 1]) {
      observed.length = 0
      f.nv.volumeBackgroundOpacity = opacity; f.nv.anatomyContextOpacity = opacity
      f.nv.drawImage3D(new Float32Array(16), 110, 15)
      expect(observed).toEqual([{ texture: background, opacity }, { texture: f.anatomy, opacity: .5 }])
    }
    observed.length = 0
    f.nv.volumeBackgroundOpacity = 0; f.nv.anatomyContextOpacity = 0
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    expect(observed).toEqual([{ texture: f.anatomy, opacity: .5 }])
    expect(f.boundSource()).toBe(f.source); expect(f.active()).toBe(1007)
  })

  it.each(['MRI', 'categorical'] as const)('keeps the %s background visible at zero foreground and navigates on the cursor plane without reading hidden geometry', kind => {
    const f = renderer(), context = { texture: 'context labels' } as unknown as WebGLTexture
    f.nv.imageContext = kind === 'MRI'; f.nv.anatomyContextTexture = context
    f.nv.anatomyVolumeOpacity = 0
    f.nv.volumeBackgroundOpacity = .35; f.nv.anatomyContextOpacity = .35
    const observed: (WebGLTexture | null | undefined)[] = []
    const draw = vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(() => { observed.push(f.boundSource()) })
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    expect(observed).toEqual([kind === 'MRI' ? f.source : context])
    f.nv.cursorPlanePosition = [2,3,.2]
    observed.length = 0; draw.mockClear(); f.nv.uiData.mouseDepthPicker = true
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    expect(draw).not.toHaveBeenCalled()
    f.nv.depthPicker([0, 0, 100, 100], new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]))
    expect(f.gl.readPixels).not.toHaveBeenCalled()
    expect(f.nv.uiData.mouseDepthPicker).toBe(false)
    expect(f.nv.sourceDepthPick).toBe(true)
    expect(f.nv.sourcePlanePick).toBe(true)
    expect(f.nv.scene.crosshairPos[2]).toBeCloseTo(.5025)
    expect(f.boundSource()).toBe(f.source); expect(f.active()).toBe(1007)
  })

  it('omits the foreground draw and depth read entirely at zero opacity when no background is enabled', () => {
    const f = renderer(), draw = vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(() => {})
    f.nv.anatomyVolumeOpacity = 0
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    f.nv.uiData.mouseDepthPicker = true
    f.nv.drawImage3D(new Float32Array(16), 110, 15)
    f.nv.depthPicker([0, 0, 100, 100], new Float32Array(16))
    expect(draw).not.toHaveBeenCalled(); expect(f.gl.readPixels).not.toHaveBeenCalled()
    expect(f.boundSource()).toBe(f.source); expect(f.active()).toBe(1007)
  })

  it.each(['background', 'foreground'] as const)('restores all original bindings and clip settings after the %s composite pass fails', pass => {
    const f = renderer(), planes = f.nv.scene.clipPlaneDepthAziElevs
    f.nv.imageContext = true; f.nv.volumeBackgroundOpacity = .35; f.nv.anatomyVolumeOpacity = .5
    const seen: (WebGLTexture | null | undefined)[] = []
    vi.spyOn(Niivue.prototype, 'drawImage3D').mockImplementation(() => {
      seen.push(f.boundSource())
      if (seen.length === (pass === 'background' ? 1 : 2)) throw new Error('composite failed')
    })
    expect(() => f.nv.drawImage3D(new Float32Array(16), 110, 15)).toThrow('composite failed')
    expect(seen).toEqual(pass === 'background' ? [f.source] : [f.source, f.anatomy])
    expect(f.boundSource()).toBe(f.source); expect(f.active()).toBe(1007)
    expect(f.nv.scene.clipPlaneDepthAziElevs).toBe(planes)
    expect(f.nv.opts.isClipPlanesCutaway).toBe(true); expect(f.nv.opts.isClipAllVolumes).toBe(false)
    expect(f.gl.uniform1f).toHaveBeenLastCalledWith('overlays', 1)
    expect(f.gl.uniform4fv).toHaveBeenLastCalledWith('cut-color', f.nv.opts.clipPlaneColor)
  })

  it('omits hollow source meshes only from the 3D pass while retaining the exact source geometry for 2D and selection', () => {
    const f = renderer(), points = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const mesh = { id: 'source-cortex', pts: points, tris: new Uint32Array([0, 1, 2]), visible: true, opacity: 1 } as unknown as NVMesh
    const meshes = [mesh]; f.nv.meshes = meshes
    const observed: NVMesh[][] = []
    const draw = vi.spyOn(SourceDepthNiivue.prototype, 'drawMesh3D').mockImplementation(function (this: SourceDepthNiivue) { observed.push(this.meshes) })
    const matrix = new Float32Array(16)
    f.nv.drawMesh3D(true, 1, matrix)
    expect(observed[0]).toEqual([])
    expect(f.nv.meshes).toBe(meshes); expect(mesh.pts).toBe(points); expect(mesh.visible).toBe(true); expect(mesh.opacity).toBe(1)
    f.nv.drawMesh3D(true, 1, matrix, undefined, undefined, true)
    expect(draw).toHaveBeenCalledTimes(2); expect(observed[1]).toBe(meshes)
    expect(f.nv.meshes).toBe(meshes)
  })

  it('retains source meshes after a failed pass and keeps the 2D image sampler unchanged', () => {
    const f = renderer(), meshes = [{ id: 'source-cortex' } as NVMesh]
    f.nv.meshes = meshes
    vi.spyOn(SourceDepthNiivue.prototype, 'drawMesh3D').mockImplementation(() => { throw new Error('mesh draw failed') })
    expect(() => f.nv.drawMesh3D(true, 1, new Float32Array(16))).toThrow('mesh draw failed')
    expect(f.nv.meshes).toBe(meshes)
    const drawSlice = vi.spyOn(Niivue.prototype, 'draw2DMain').mockImplementation(function (this: Niivue) {
      expect(f.boundSource()).toBe(f.source)
      expect(this.volumes[0].opacity).toBe(.42)
    })
    f.nv.draw2DMain([0, 0, 100, 100], 0)
    expect(drawSlice).toHaveBeenCalledOnce(); expect(f.boundSource()).toBe(f.source)
  })
})
