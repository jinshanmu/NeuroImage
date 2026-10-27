import { Niivue, NVMesh } from '@niivue/niivue'
import { imageAssetKey, imageRenderKey } from './renderState'
import { unProject } from '@niivue/niivue/utils'
import type { Manifest, Vec3, ViewState } from './types'
import { regionMemberships, type SparseMask } from './independentRegions'
import { compactLabels } from './palette'
import { resolveSurfaceSelection } from './selection'
import { SourceDepthNiivue } from './depthRenderer'
import { displayLevel, parseTck, resolveStreamlineSelection } from './streamlines'
import { atlasDisplayView, fitBoundsZoom, surfaceOpacity, FULL_CONTEXT_3D_SCALE, viewZoom3D, zoomFactor, zoomFactor3D, zoomScale3D } from './display'
import { sectionPolygon } from './sectionPlanes'
import { cursorCutaway, removedByCutaway } from './cutaway'
import { depthSamplePixel, decodeSurfaceDepth } from './picking'
import { addPreparedVolume, prepareVolume, refreshOverlayTextures, retainVolumeMetadata, type PreparedVolume } from './volumeResources'
import { BACKGROUND_COLOR, contextIds, contextOpacity } from './atlasBackground'
import { loadAssetsInOrder } from './assetLoading'
import { readSourceMask } from './maskLoading'
import { RenderAssets } from './renderAssets'
import { addPreparedMesh } from './meshLoading'
import { pickCanvas3D, SliceClickGesture, toggleCanvasStructure } from './canvasSelection'
import { CursorReadout } from './cursorReadout'
import { sliceOverlayOpacityShader } from './sliceOverlayOpacity'
import { CrosshairResources } from './crosshairResources'
import { volumeCutawayPlane } from './volumeCutaway'
import { LabelVolumeResources, labelContextVolumePalette, labelVolumePalette, labelVolumeIdPalette } from './labelVolumeResources'
import { categoricalVolumeSelection } from './categoricalVolumeSelection'
import { TransparentLabelVolume } from './transparentLabelVolume'
import { cursorPlanePoint } from './cursorPlane'
import { full3DPanel } from './full3DPanel'

// NiiVue 0.69.0 has no independent public visibility flag for 3D volume rendering.
// This pinned renderer hook preserves its real MRI slice renderer unchanged.
class AtlasNiivue extends SourceDepthNiivue {
  sourceDepthPick: boolean | null = null
  sourcePlanePick = false
  cursorPlanePosition: Vec3 | null = null
  imageContext = false
  holdSceneDraw = false
  anatomyVolumeTexture: WebGLTexture | null = null
  anatomyIdTexture: WebGLTexture | null = null
  anatomyVolumeOpacity = 1
  anatomyContextTexture: WebGLTexture | null = null
  anatomyContextOpacity = 0
  private suppressVolumePick = false
  sliceBackgroundOpacity: number | null = null
  volumeBackgroundOpacity = 1
  sliceOverlayOpacity = 1
  private opacitySliceShader: Niivue['customSliceShader'] = null
  focus3D: Vec3 | null = null
  fitBounds: [Vec3, Vec3] | null = null
  relativeZoom: number | undefined
  zoomBase = FULL_CONTEXT_3D_SCALE
  fitting3D = false
  beforeSceneDraw: () => void = () => {}
  afterSceneDraw: () => void = () => {}
  private orientationCalls: Parameters<Niivue['drawSliceOrientationText']>[] | null = null
  private drawingOrientation = false
  private readonly crosshairResources = new CrosshairResources()
  private readonly transparentLabels = new TransparentLabelVolume()
  override async loadVolumes(...args: Parameters<Niivue['loadVolumes']>): Promise<this> {
    if (!this.thumbnailVisible) retainVolumeMetadata(this, [])
    return super.loadVolumes(...args)
  }
  override removeVolume(...args: Parameters<Niivue['removeVolume']>) {
    super.removeVolume(...args)
    retainVolumeMetadata(this, this.volumes)
  }
  override depthPicker(...args: Parameters<Niivue['depthPicker']>) {
    if (!this.uiData.mouseDepthPicker) return
    this.uiData.mouseDepthPicker = false
    this.sourceDepthPick = false
    this.sourcePlanePick = false
    const sample = depthSamplePixel(this.mousePos, this.gl.canvas.height, this.gl.getParameter(this.gl.VIEWPORT))
    if (!sample) return
    const planeFallback = () => {
      const anchor = this.cursorPlanePosition ?? Array.from(this.frac2mm(this.scene.crosshairPos, 0, true)).slice(0, 3) as Vec3
      const point = cursorPlanePoint(sample.fx, sample.fy, anchor, args[1])
      if (!point) return
      this.scene.crosshairPos = this.mm2frac(point, 0, true)
      this.sourceDepthPick = true
      this.sourcePlanePick = true
    }
    if (this.suppressVolumePick) { planeFallback(); return }
    // Read an integer pixel and unproject that same pixel's center. The pinned
    // renderer otherwise truncates an extra row after flipping a subpixel Y.
    const rgba = new Uint8Array(4)
    this.gl.readPixels(sample.x, sample.y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, rgba)
    this.selectedObjectId = rgba[3]
    if (this.selectedObjectId === this.VOLUME_ID) {
      this.scene.crosshairPos = new Float32Array(rgba.slice(0, 3)).map(value => value / 255)
      this.sourceDepthPick = true
      return
    }
    const depth = decodeSurfaceDepth(rgba)
    if (depth === null) { planeFallback(); return }
    const mm = unProject(sample.fx, sample.fy, depth, args[1]), fraction = this.mm2frac(mm, 0, true)
    if (Array.from(fraction).some(value => !Number.isFinite(value))) { planeFallback(); return }
    this.scene.crosshairPos = fraction
    this.sourceDepthPick = true
  }
  override draw2DMain(...args: Parameters<Niivue['draw2DMain']>) {
    const background = this.volumes[0], previous = background?.opacity
    if (background && this.sliceBackgroundOpacity !== null) background.opacity = this.sliceBackgroundOpacity
    if (this.opacitySliceShader) {
      this.opacitySliceShader.use(this.gl)
      this.gl.uniform1f(this.opacitySliceShader.uniforms.neuroimageOverlayOpacity, this.sliceOverlayOpacity)
    }
    try { super.draw2DMain(...args) }
    finally { if (background) background.opacity = previous! }
  }
  installSliceOverlayOpacity() {
    const shader = this.sliceMMShader
    if (!shader || this.opacitySliceShader) return
    const fragment = this.gl.getAttachedShaders(shader.program)?.find(item => this.gl.getShaderParameter(item, this.gl.SHADER_TYPE) === this.gl.FRAGMENT_SHADER)
    const source = fragment && this.gl.getShaderSource(fragment)
    if (!source) throw new Error('The source slice shader is unavailable.')
    const deferred = this.deferVolumeUploads
    this.deferVolumeUploads = true
    try {
      this.setCustomSliceShader(sliceOverlayOpacityShader(source))
      this.opacitySliceShader = this.customSliceShader
    } finally { this.deferVolumeUploads = deferred }
  }
  override cleanup() {
    this.transparentLabels.dispose(this)
    this.crosshairResources.dispose(this)
    if (this.opacitySliceShader && this.customSliceShader === this.opacitySliceShader) {
      const program = this.opacitySliceShader.program
      for (const shader of this.gl.getAttachedShaders(program) ?? []) this.gl.deleteShader(shader)
      this.gl.deleteProgram(program)
      this.customSliceShader = null
    }
    this.opacitySliceShader = null
    super.cleanup()
  }
  override draw3D(...args: Parameters<Niivue['draw3D']>) {
    if (this.opts.sliceType === this.sliceTypeMultiplanar && !this.opts.heroImageFraction
      && !this.opts.bounds && !this.customLayout?.length && !this.sliceMosaicString && args[0]) {
      const sections = this.screenSlices.filter(slice => [0, 1, 2].includes(slice.axCorSag))
      if (sections.length === 3) args[0] = full3DPanel(args[0], sections.map(slice => slice.leftTopWidthHeight),
        [0, 0, this.effectiveCanvasWidth(), this.effectiveCanvasHeight()])
    }
    if (this.fitBounds) {
      this.fitting3D = true
      try {
        this.setPivot3D()
        this.scene.volScaleMultiplier = 1
        const matrix = this.calculateMvpMatrix(null, args[0] ?? [0, 0, 0, 0], this.scene.renderAzimuth, this.scene.renderElevation)[0]
        this.zoomBase = fitBoundsZoom(this.fitBounds, matrix)
        this.scene.volScaleMultiplier = this.relativeZoom === undefined ? this.zoomBase : zoomScale3D(this.zoomBase, this.relativeZoom)
      } finally { this.fitting3D = false }
    }
    return super.draw3D(...args)
  }
  override calculateMvpMatrix(...args: Parameters<Niivue['calculateMvpMatrix']>) {
    const factor = this.relativeZoom
    if (factor === undefined || factor === 1 || this.fitting3D) return super.calculateMvpMatrix(...args)
    const scale = this.scene.volScaleMultiplier
    this.fitting3D = true
    try {
      // Magnify the screen plane while retaining the reference view's depth
      // interval. Native uniform scaling also shrinks near/far planes and
      // would slice through the source anatomy at higher magnification.
      this.scene.volScaleMultiplier = scale / factor
      const matrices = super.calculateMvpMatrix(...args)
      matrices[0] = Float32Array.from(matrices[0]) as typeof matrices[0]
      for (let column = 0; column < 4; column++) {
        matrices[0][column * 4] *= factor
        matrices[0][column * 4 + 1] *= factor
      }
      return matrices
    } finally {
      this.scene.volScaleMultiplier = scale
      this.fitting3D = false
    }
  }
  override drawCrosshairs3D(...args: Parameters<Niivue['drawCrosshairs3D']>) {
    const is2D = !!args[3]
    // The visual cursor must not write color/depth over the anatomical hit.
    // The native renderer draws it again in the ordinary pass after picking.
    if (!is2D && this.uiData.mouseDepthPicker) return
    if ((!this.opts.show3Dcrosshair && !is2D) || (this.opts.crosshairWidth <= 0 && is2D)) return super.drawCrosshairs3D(...args)
    const originalWidth = this.opts.crosshairWidth
    // A source-voxel-sized cursor must not obscure small nuclei when magnified.
    // Adjust only the 3D guide; original slice cursors and coordinates stay intact.
    const width = is2D ? originalWidth : originalWidth / Math.max(1, this.scene.volScaleMultiplier)
    this.opts.crosshairWidth = width
    try { return this.crosshairResources.draw(this, is2D, width, () => super.drawCrosshairs3D(...args)) }
    finally { this.opts.crosshairWidth = originalWidth }
  }
  override drawSceneCore() {
    if (this.holdSceneDraw) return
    this.beforeSceneDraw()
    this.orientationCalls = []
    try {
      const result = super.drawSceneCore()
      const calls = this.orientationCalls
      this.orientationCalls = null
      // Crosshairs and later tiles must not overwrite a thin direction glyph,
      // especially the inferior I when it shares the vertical cursor line.
      for (const args of calls) this.drawSliceOrientationText(...args)
      this.afterSceneDraw()
      return result
    } finally { this.orientationCalls = null }
  }
  override drawSliceOrientationText(...args: Parameters<Niivue['drawSliceOrientationText']>) {
    if (this.orientationCalls) { this.orientationCalls.push(args); return }
    // The pinned slice renderer leaves depth testing enabled. Once a magnified
    // image fills its tile, the image depth can occlude orientation lettering.
    // Keep the renderer's own orientation mapping, but draw readable foreground
    // labels with a small backing for contrast on bright MRI and cursor lines.
    const depth = this.gl.isEnabled(this.gl.DEPTH_TEST)
    this.gl.disable(this.gl.DEPTH_TEST)
    this.drawingOrientation = true
    try {
      super.drawSliceOrientationText(...args)
    } finally {
      this.drawingOrientation = false
      if (depth) this.gl.enable(this.gl.DEPTH_TEST)
    }
  }
  override drawChar(xy: number[], scale: number, char: number) {
    if (this.drawingOrientation) {
      const pad = 2 * (this.uiData.dpr || 1)
      this.drawRect([xy[0] - pad, xy[1] + .12 * scale, this.textWidth(scale, String.fromCodePoint(char)) + 2 * pad, .9 * scale], [.025, .045, .066, 1])
      this.fontShader!.use(this.gl); this.gl.bindVertexArray(this.genericVAO)
    }
    return super.drawChar(xy, scale, char)
  }
  override setPivot3D() {
    super.setPivot3D()
    if (this.focus3D) this.pivot3D = [...this.focus3D]
  }
  override drawImage3D(...args: Parameters<Niivue['drawImage3D']>) {
    return this.withDepthPickScissor(() => this.drawSourceImage3D(...args))
  }
  private drawSourceImage3D(...args: Parameters<Niivue['drawImage3D']>) {
    if (!this.imageContext && !this.anatomyVolumeTexture) return
    const shader = this.uiData.mouseDepthPicker ? this.pickingImageShader : this.renderShader
    if (!shader) return
    const planes = this.scene.clipPlaneDepthAziElevs, cutaway = this.opts.isClipPlanesCutaway, allVolumes = this.opts.isClipAllVolumes
    const cut = this.surfaceCutaway && this.volumes.length ? volumeCutawayPlane(this.surfaceCutaway, fraction => this.frac2mm(fraction, 0, true)) : null
    const gl = this.gl, anatomy = this.anatomyVolumeTexture, picking = this.uiData.mouseDepthPicker
    this.suppressVolumePick = !!anatomy && this.anatomyVolumeOpacity <= 0
    const active = anatomy ? gl.getParameter(gl.ACTIVE_TEXTURE) : null
    let backgroundTexture: WebGLTexture | null = null
    if (anatomy) {
      gl.activeTexture(gl.TEXTURE0)
      backgroundTexture = gl.getParameter(gl.TEXTURE_BINDING_3D)
    }
    shader.use(this.gl)
    this.gl.uniform1f(shader.uniforms.overlays, 0)
    if (anatomy && shader.uniforms.clipPlaneColor) gl.uniform4fv(shader.uniforms.clipPlaneColor, [0, 0, 0, 0])
    try {
      if (cut) {
        // Scope this plane to the background draw, including its packed-depth
        // pass. Native clipping uses the same sample interval for both shaders.
        this.scene.clipPlaneDepthAziElevs = [cut]
        this.opts.isClipPlanesCutaway = false
        this.opts.isClipAllVolumes = true
      }
      if (anatomy) {
        // Native 3D volume draws use ALWAYS depth and source-alpha blending.
        // Draw context first; the independently faded foreground composites
        // over it, while empty foreground fragments retain background color.
        if (!picking) {
          if (this.imageContext && this.volumeBackgroundOpacity > 0) {
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, backgroundTexture)
            if (shader.uniforms.backOpacity) gl.uniform1f(shader.uniforms.backOpacity, this.volumeBackgroundOpacity)
            super.drawImage3D(...args)
          } else if (this.anatomyContextTexture && this.anatomyContextOpacity > 0) {
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, this.anatomyContextTexture)
            if (shader.uniforms.backOpacity) gl.uniform1f(shader.uniforms.backOpacity, this.anatomyContextOpacity)
            super.drawImage3D(...args)
          }
        }
        if (this.anatomyVolumeOpacity > 0) {
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, anatomy)
          if (shader.uniforms.backOpacity) gl.uniform1f(shader.uniforms.backOpacity, this.anatomyVolumeOpacity)
          if (!picking && this.anatomyVolumeOpacity < 1 && this.anatomyIdTexture) {
            this.transparentLabels.draw(this, this.anatomyIdTexture, this.anatomyVolumeOpacity, () => super.drawImage3D(...args))
          } else super.drawImage3D(...args)
        }
      } else if (this.volumeBackgroundOpacity > 0) {
        if (shader.uniforms.backOpacity) gl.uniform1f(shader.uniforms.backOpacity, this.volumeBackgroundOpacity)
        super.drawImage3D(...args)
      }
    }
    finally {
      this.scene.clipPlaneDepthAziElevs = planes
      this.opts.isClipPlanesCutaway = cutaway
      this.opts.isClipAllVolumes = allVolumes
      shader.use(this.gl)
      if (shader.uniforms.backOpacity) this.gl.uniform1f(shader.uniforms.backOpacity, this.volumes[0]?.opacity ?? 1)
      this.gl.uniform1f(shader.uniforms.overlays, this.overlays.length)
      if (anatomy && shader.uniforms.clipPlaneColor) gl.uniform4fv(shader.uniforms.clipPlaneColor, this.opts.clipPlaneColor)
      if (anatomy) {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, backgroundTexture); gl.activeTexture(active)
      }
    }
  }
  override drawMesh3D(...args: Parameters<Niivue['drawMesh3D']>) {
    if (!this.anatomyVolumeTexture || args[5]) return super.drawMesh3D(...args)
    const original = this.meshes
    this.meshes = []
    try { return super.drawMesh3D(...args) }
    finally { this.meshes = original }
  }
  override sliceScroll3D(change = 0) {
    const clip = this.scene.clipPlaneDepthAziElevs[this.uiData.activeClipPlaneIndex]
    if (this.volumes.length && clip?.[0] < 1.8) return super.sliceScroll3D(change)
    if (change === 0) return
    if (this.relativeZoom !== undefined) {
      this.setScale(zoomScale3D(this.zoomBase, zoomFactor(this.relativeZoom + (change > 0 ? .1 : -.1))))
      return
    }
    // Match the scene contract's camera range. The pinned renderer otherwise
    // caps wheel zoom at 2, preventing close inspection of small source regions.
    this.setScale(Math.max(.1, Math.min(20, this.scene.volScaleMultiplier * (change > 0 ? 1.1 : .9))))
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const cursorView = (state: ViewState): ViewState => {
  const surfaceCutaway = cursorCutaway(state.surfaceCutaway, state.position)
  return surfaceCutaway === state.surfaceCutaway ? state : { ...state, surfaceCutaway }
}
export class AtlasViewer {
  readonly nv: AtlasNiivue
  private readonly labelVolumes = new LabelVolumeResources()
  private readonly contextVolumes = new LabelVolumeResources()
  private readonly labelIds = new LabelVolumeResources()
  private meshes = new Map<string, NVMesh>()
  private meshFiles = new Map<string, string>()
  private current: ViewState | null = null
  private rendered: ViewState | null = null
  private nativeUpdate: ViewState | null = null
  private drawnCursor: { fraction: number[]; position: Vec3 } | null = null
  private disposed = false
  private generation = 0
  private assetGeneration = 0
  private requestedAssetKey = ''
  private requestedKey = ''
  private syncing = false
  private background = ''
  private labelVolume: PreparedVolume | null = null
  private preparedBackground: { id: string; volumes: PreparedVolume[] } | null = null
  private preparedOverlay: { id: string; volume: PreparedVolume } | null = null
  private task: Promise<void> | null = null
  private appliedKey = ''
  private pointerIn3D = false
  private sliceClick = new SliceClickGesture()
  private cursorReadout = new CursorReadout()
  private attached = false
  private released = false
  private labelIndex: number
  private model: boolean
  private overlayId = ''
  private imageOnly: boolean
  private independent: boolean
  private masks = new Map<string, SparseMask>()
  private refreshSelection = false
  private streamlines: boolean
  private loading = new AbortController()
  private resources: RenderAssets
  constructor(private canvas: HTMLCanvasElement, private manifest: Manifest, private base: string,
    private changed: (patch: Partial<ViewState>) => void, private status: (message: string) => void) {
    this.resources = new RenderAssets(base)
    this.imageOnly = ['mri-volume', 'scalar-fields'].includes(manifest.representation ?? '')
    this.model = manifest.representation === 'label-model'
    this.streamlines = manifest.representation === 'mri-streamlines'
    this.independent = manifest.representation === 'mri-regions'
    this.labelIndex = this.imageOnly || this.streamlines || this.independent ? -1 : this.model ? 0 : 1
    this.nv = new AtlasNiivue({ backColor: [.025, .045, .066, 1], fontColor: [.74, .8, .86, 1], crosshairColor: [.5, .9, .84, 1],
      crosshairWidth: 1, show3Dcrosshair: true, isOrientCube: true, isRuler: true, isRadiologicalConvention: true,
      isNearestInterpolation: true, isSliceMM: true, isDepthPickMesh: true, multiplanarForceRender: true, meshThicknessOn2D: 0,
      multiplanarEqualSize: true, multiplanarLayout: 2, tileMargin: 14, dragAndDropEnabled: false,
      showAllOrientationMarkers: true, isColorbar: false, textHeight: -1, fontMinPx: 16, fontSizeScaling: .2,
      // The workspace overlay provides the loading message above the canvas.
      loadingText: '', logLevel: 'error' })
    this.nv.onLocationChange = (event: unknown) => {
      const depthPick = this.nv.sourceDepthPick
      const planePick = this.nv.sourcePlanePick
      this.nv.sourceDepthPick = null
      this.nv.sourcePlanePick = false
      if (this.syncing || !this.current || this.disposed || depthPick === false) return
      const location = event as { mm: ArrayLike<number>; axCorSag: number; values: { value: number }[] }
      const position: Vec3 = [location.mm[0], location.mm[1], location.mm[2]]
      if (!position.every(Number.isFinite)) return
      // Ordinary redraws also report location. Do not search every surface
      // vertex when only the camera moved; an explicit depth pick still must
      // resolve its hit, even if it lands on the existing cursor.
      if (depthPick !== true && position.every((v, i) => Math.abs(v - (this.nativeUpdate ?? this.current)!.position[i]) < 1e-4)) return
      // Render values are dense palette indices; source label values stay in the
      // manifest and on disk. This avoids GPU texture limits for sparse labels.
      const value = location.values[this.labelIndex]?.value
      const voxelSelected = this.manifest.structures[value - 1]?.id ?? null
      // A queued slice move may finish after the physical pointer has entered
      // another tile. Its explicit slice axis outranks the live hover flag.
      const in3D = depthPick === true || (this.pointerIn3D && ![0, 1, 2].includes(location.axCorSag))
      // A picked isosurface lies between voxel centers. Its nearest categorical
      // voxel may belong to a neighboring structure, including a hidden one.
      // Resolve the visible surface first, then retain voxel lookup as fallback.
      const sampledCutaway = this.nv.surfaceCutaway
      const volumeHit = in3D && depthPick === true && !!this.nv.anatomyVolumeTexture && this.nv.selectedObjectId === this.nv.VOLUME_ID
      const selection = planePick ? this.locate(position) : volumeHit ? categoricalVolumeSelection(voxelSelected, { ...this.current, surfaceCutaway: sampledCutaway }, position)
        ?? { selected: null, selectionEvidence: { kind: 'label-voxel' as const, candidates: [] } }
        : this.imageOnly ? this.locate(position) : this.streamlines ? this.locate(position, in3D ? -1 : [2, 1, 0][location.axCorSag] ?? -1) : in3D ? resolveSurfaceSelection(position, [...this.meshes].filter(([id]) => this.current!.visible.includes(id)), voxelSelected,
        Math.max(...this.manifest.volumes.find(v => v.kind === (this.independent ? 'image' : 'labels'))!.voxel_size_mm), this.current.selected,
        sampledCutaway ? (id, point) => !removedByCutaway(sampledCutaway, id, point) : undefined) : this.locate(position)
      // The native depth picker immediately redraws 3D without drawSceneCore.
      // Resolve its hit against the sampled plane before moving that plane.
      this.rememberCursor(position)
      this.updateCursorGuides(position)
      const selected = selection.selected
      if (depthPick === true) this.setCursorStructure(position, selected ?? null)
      if (depthPick === true && position.every((v, i) => Math.abs(v - this.current!.position[i]) < 1e-4)) {
        this.changed(this.cursorPatch({ position }))
        return
      }
      if (depthPick !== true) this.setCursorStructure(position, this.cursorIdentity(selection, position))
      this.emit({ ...selection, position }, true)
    }
    this.nv.beforeSceneDraw = () => {
      const state = this.nativeUpdate ?? this.current
      if (this.syncing || !state || (!state.sectionPlanes?.length && !state.surfaceCutaway?.followCursor) || !this.nv.volumes[0]) return
      // Native dragging draws before React receives its location callback.
      // Keep cursor guides in that same draw, so acknowledging the callback does not
      // require a second full image/surface render.
      const fraction = this.nv.scene.crosshairPos
      // A camera redraw retains the exact application RAS rather than replacing
      // it with a float32 round trip through the native crosshair fractions.
      const position = this.drawnCursor?.fraction.every((value, axis) => value === fraction[axis])
        ? this.drawnCursor.position
        : Array.from(this.nv.frac2mm(fraction, 0, true)).slice(0, 3) as Vec3
      if (!position.every(Number.isFinite)) return
      const physical = position.every((value, axis) => Math.abs(value - state.position[axis]) < 1e-4) ? state.position : position
      this.rememberCursor(physical)
      this.updateCursorGuides(physical)
    }
    this.nv.onAzimuthElevationChange = (a, e) => this.emit({ camera: [a, e, this.nv.scene.volScaleMultiplier] }, true)
    this.nv.afterSceneDraw = () => this.syncFittedCamera()
    this.nv.onZoom3DChange = z => {
      if (this.syncing || this.nv.fitting3D) return
      if (this.current?.zoom3D !== undefined) {
        const factor = zoomFactor3D(z, this.nv.zoomBase)
        this.nv.relativeZoom = factor
        this.nv.fitting3D = true
        try { this.nv.scene.volScaleMultiplier = zoomScale3D(this.nv.zoomBase, factor) }
        finally { this.nv.fitting3D = false }
        this.emit({ zoom3D: factor, camera: [this.nv.scene.renderAzimuth, this.nv.scene.renderElevation, this.nv.scene.volScaleMultiplier] }, true)
        return
      }
      this.nv.fitBounds = null
      this.emit({ fitVisible3D: false, camera: [this.nv.scene.renderAzimuth, this.nv.scene.renderElevation, z] })
    }
    this.nv.onIntensityChange = volume => {
      if (!this.model && volume === this.nv.volumes[0] && Number.isFinite(volume.cal_min) && Number.isFinite(volume.cal_max)) this.emit({ window: [volume.cal_min!, volume.cal_max!] })
    }
    this.nv.onMouseUp = () => this.emit({ pan: Array.from(this.nv.scene.pan2Dxyzmm) as ViewState['pan'] }, true)
    canvas.addEventListener('mousedown', this.pointer, true)
    canvas.addEventListener('mousemove', this.pointer, true)
    canvas.addEventListener('mouseup', this.pickSlice)
    canvas.addEventListener('dblclick', this.doubleClick, true)
    canvas.addEventListener('mouseleave', this.cancelClick)
    canvas.addEventListener('blur', this.cancelClick)
    canvas.addEventListener('wheel', this.cancelClick, true)
    canvas.addEventListener('touchstart', this.cancelClick, true)
  }
  private pointer = (event: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect(), x = (event.clientX - rect.left) * this.canvas.width / rect.width, y = (event.clientY - rect.top) * this.canvas.height / rect.height
    this.pointerIn3D = this.nv.screenSlices.some(s => { const [l, t, w, h] = s.leftTopWidthHeight; return s.axCorSag === this.nv.sliceTypeRender && x >= l && x <= l + w && y >= t && y <= t + h })
    if (event.type === 'mousedown') this.sliceClick.begin(event, this.current?.visible ?? [], !!this.current && (this.pointerIn3D || this.slicePosition(event) !== null))
    else this.sliceClick.move(event)
  }
  private slicePosition(event: MouseEvent): { position: Vec3; axis: number } | null {
    if (!this.nv.volumes[0]) return null
    const rect = this.canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    const x = (event.clientX - rect.left) * this.canvas.width / rect.width, y = (event.clientY - rect.top) * this.canvas.height / rect.height
    const tile = this.nv.screenSlices.find(s => { const [l, t, w, h] = s.leftTopWidthHeight; return [0, 1, 2].includes(s.axCorSag) && x >= l && x < l + w && y >= t && y < t + h })
    if (!tile) return null
    const fraction = this.nv.canvasPos2frac([x, y])
    if (Array.from(fraction).some(value => !Number.isFinite(value) || value < 0 || value > 1)) return null
    const position = Array.from(this.nv.frac2mm(fraction, 0, true)).slice(0, 3) as Vec3
    return position.every(Number.isFinite) ? { position, axis: [2, 1, 0][tile.axCorSag] } : null
  }
  private pickSlice = (event: MouseEvent) => {
    const before = this.sliceClick.finish(event)
    if (before === null || !this.current || this.disposed) return
    this.pointer(event)
    if (this.pointerIn3D) pickCanvas3D(this.nv, this.canvas, event)
    else {
      const hit = this.slicePosition(event)
      if (hit) {
        this.locateCursor(hit.position, hit.axis)
        this.changed(this.cursorPatch({ position: hit.position }))
      }
    }
  }
  private doubleClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const before = this.sliceClick.finishDoubleClick(event)
    if (before === null || !this.current || this.disposed) return
    this.pointer(event)
    if (this.pointerIn3D) return
    const hit = this.slicePosition(event)
    if (!hit) return
    const selection = this.locate(hit.position, hit.axis), id = selection.selected
    if (!id || (this.independent && !selection.selectionEvidence?.candidates.includes(id))) return
    if (this.current.overlay === 'probability' && (this.probabilityAt(hit.position, id) ?? 0) <= 0) return
    this.commitPick(selection, hit.position, before.includes(id))
  }
  private cancelClick = () => this.sliceClick.cancel()
  private commitPick(selection: Partial<ViewState>, position: Vec3, wasVisible: boolean) {
    if (!this.current || !selection.selected) return
    this.setCursorStructure(position, selection.selected)
    const change = toggleCanvasStructure(this.current.visible, selection.selected, wasVisible)
    this.changed(this.cursorPatch({ ...selection, position, ...change,
      ...(wasVisible && selection.selectionEvidence ? { selectionEvidence: { ...selection.selectionEvidence, candidates: [] } } : {}) }))
  }
  private cursorPatch(patch: Partial<ViewState>, baseline = this.nativeUpdate ?? this.current): Partial<ViewState> {
    if (!baseline) return patch
    const cut = 'surfaceCutaway' in patch ? patch.surfaceCutaway : baseline.surfaceCutaway
    const surfaceCutaway = cursorCutaway(cut, patch.position ?? baseline.position)
    return surfaceCutaway === cut ? patch : { ...patch, surfaceCutaway }
  }
  private rememberCursor(position: Vec3) {
    this.nv.cursorPlanePosition = [...position]
    if (position === this.drawnCursor?.position) return
    this.drawnCursor = { fraction: Array.from(this.nv.scene.crosshairPos), position: [...position] }
  }
  private updateCursorGuides(position: Vec3) {
    const state = this.nativeUpdate ?? this.current
    if (!state) return
    this.nv.surfaceCutaway = cursorCutaway(state.surfaceCutaway, position)
    if (!state.sectionPlanes?.length) return
    const volume = this.manifest.volumes.find(item => item.id === state.background)!
    this.nv.sectionGuides = state.sectionPlanes.map(plane => ({ plane, polygon: sectionPolygon(volume, position, plane) }))
  }
  private emit(patch: Partial<ViewState>, native = false) {
    if (this.syncing || this.disposed || !this.current) return
    const baseline = this.nativeUpdate ?? this.current
    patch = this.cursorPatch(patch, baseline)
    if (!Object.entries(patch).some(([key, value]) => !same(value, baseline[key as keyof ViewState]))) return
    // Categorical cursor/camera/pan changes are already drawn by NiiVue. The
    // React echo must still update readouts and memory, without replaying asset
    // checks and the complete render. Selected probability/mask/fiber displays
    // can depend on selection and deliberately retain the full apply path.
    const renderedCurrent = this.nativeUpdate !== null || this.appliedKey === imageRenderKey(this.current)
    this.nativeUpdate = native && !this.task && this.rendered && renderedCurrent && !this.streamlines && !this.independent && this.current.overlay !== 'probability'
      ? { ...baseline, ...patch } : null
    this.changed(patch)
  }
  private syncFittedCamera() {
    if (this.nv.fitBounds) this.emit({ focus3D: this.nv.focus3D!, camera: [this.nv.scene.renderAzimuth, this.nv.scene.renderElevation, this.nv.scene.volScaleMultiplier] }, true)
  }
  async initialize(state: ViewState) {
    await Promise.all([
      this.nv.attachToCanvas(this.canvas).then(() => { this.attached = true; if (this.disposed) this.release() }),
      this.resources.load(this.manifest.assets, this.loading.signal),
    ])
    if (this.disposed) { this.release(); return }
    if (!this.model && !this.streamlines && !this.imageOnly) this.nv.installSliceOverlayOpacity()
    if (this.labelIndex >= 0 && this.manifest.structures.length + 1 > this.nv.gl.getParameter(this.nv.gl.MAX_TEXTURE_SIZE)) throw new Error('This package has more labels than this GPU can display in one layer.')
    await this.apply(state)
    // The final surface draw can fit the camera while the initial apply is
    // still pending. Acknowledge that already drawn camera after the task has
    // settled, before the workspace enables controls and echoes its state.
    this.syncFittedCamera()
  }
  apply(state: ViewState): Promise<void> {
    if (this.disposed) return Promise.resolve()
    state = cursorView(atlasDisplayView(state))
    if (this.preparedBackground && this.preparedBackground.id !== state.background) this.preparedBackground = null
    this.current = state
    const key = imageRenderKey(state)
    const native = this.nativeUpdate
    this.nativeUpdate = null
    if (!this.task && native && imageRenderKey(native) === key) {
      this.rendered = structuredClone(state)
      this.appliedKey = key
      return Promise.resolve()
    }
    if (!this.task && this.appliedKey === key) return Promise.resolve()
    if (this.task && this.requestedKey === key) return this.task
    const assets = imageAssetKey(state)
    if (assets !== this.requestedAssetKey) { this.requestedAssetKey = assets; this.assetGeneration++ }
    this.requestedKey = key
    this.generation++
    if (!this.task) this.task = this.drain().finally(() => { this.task = null; if (this.disposed) this.release() })
    return this.task
  }
  private async drain() {
    let completed = -1
    while (!this.disposed && completed !== this.generation) {
      const generation = this.generation, state = this.current!
      try { await this.render(state, generation) }
      finally { this.nv.deferVolumeUploads = false }
      if (!this.disposed && generation === this.generation) this.appliedKey = imageRenderKey(state)
      completed = generation
    }
  }
  private async render(state: ViewState, generation: number) {
    const nv = this.nv, assetGeneration = this.assetGeneration
    // Prepare the complete stack and compact label palette before the first
    // upload. Adding an image or selected field must not upload a partial stack.
    nv.deferVolumeUploads = true
    const context = new Set(contextIds(state)), renderedIds = new Set([...state.visible, ...context])
    // Brightness changes do not change a trajectory's nearest-source hit.
    // Recheck only when section/3D visibility crosses zero or geometry changes.
    const selectionSettings = (value: ViewState | null) => value && [value.position, value.visible, value.streamlineLevel, value.streamlineSlabMm,
      value.labelOpacity > 0, value.visible.map(id => surfaceOpacity(value, id) > 0)]
    if (this.streamlines && state.selectionEvidence?.kind === 'visible-streamline') {
      this.refreshSelection ||= !same(selectionSettings(state), selectionSettings(this.rendered))
    } else this.refreshSelection = false
    const selected = state.selected && state.visible.includes(state.selected)
      ? this.manifest.structures.find(s => s.id === state.selected) : null
    const field = state.overlay === 'probability' ? selected?.probability
      : this.independent && state.overlay === 'mask' ? selected?.mask : null
    const wantedOverlay = field?.volume_id ?? '', fieldIndex = this.independent ? 1 : 2
    if (this.preparedOverlay && this.preparedOverlay.id !== wantedOverlay) this.preparedOverlay = null
    const replacingBackground = this.background !== state.background
    let preparedBackground = this.preparedBackground?.id === state.background ? this.preparedBackground : null
    if (replacingBackground && !preparedBackground) {
      const image = this.manifest.volumes.find(v => v.id === state.background)!, labels = this.manifest.volumes.find(v => v.kind === 'labels')!
      this.status(`Loading ${image.name}…`)
      const imageOptions = { url: this.resources.url(image.file), name: image.id + '.nii.gz', colormap: 'gray', cal_min: state.window[0], cal_max: state.window[1] }
      const labelOptions = this.labelIndex >= 0 ? { url: this.resources.url(labels.file), name: 'labels.nii.gz', opacity: 0, cal_min: 0, cal_max: labels.cal_max } : null
      const sources = this.model ? [prepareVolume(nv, labelOptions!)] : this.labelIndex === 1
        ? [prepareVolume(nv, imageOptions), this.labelVolume ? Promise.resolve(this.labelVolume) : prepareVolume(nv, labelOptions!)]
        : [prepareVolume(nv, imageOptions)]
      preparedBackground = { id: state.background, volumes: await Promise.all(sources) }
      if (this.disposed) return
      if (this.current?.background === state.background) this.preparedBackground = preparedBackground
      if (generation !== this.generation) return
    }
    const replacingOverlay = replacingBackground || this.overlayId !== wantedOverlay
    let preparedOverlay: PreparedVolume | null = null
    if (replacingOverlay && wantedOverlay) {
      const volume = this.manifest.volumes.find(v => v.id === wantedOverlay)!
      const options = { url: volume.kind === 'mask' ? this.base + volume.file : this.resources.url(volume.file), name: volume.name,
        colormap: 'viridis', cal_min: volume.cal_min, cal_max: volume.cal_max, opacity: 1 }
      if (this.overlayId === wantedOverlay && nv.volumes[fieldIndex]) preparedOverlay = { image: nv.volumes[fieldIndex], options }
      else if (this.preparedOverlay?.id === wantedOverlay) preparedOverlay = this.preparedOverlay.volume
      else {
        this.status('Loading selected source ' + (state.overlay === 'mask' ? 'mask…' : 'probability field…'))
        preparedOverlay = await prepareVolume(nv, options)
        if (this.disposed) return
        this.preparedOverlay = { id: wantedOverlay, volume: preparedOverlay }
      }
      if (generation !== this.generation) return
    }
    if (this.independent) {
      const missing = state.visible.filter(id => !this.masks.has(id)).map(id => {
        const region = this.manifest.structures.find(s => s.id === id)!
        if (region.kind !== 'independent-region') throw new Error('Independent region contract mismatch.')
        const volume = this.manifest.volumes.find(v => v.id === region.mask.volume_id)!
        return { id, region, volume }
      })
      await loadAssetsInOrder(missing, item => this.resources.url(item.volume.file), async ({ id, region, volume }, buffer) => {
        this.status('Loading independent source memberships…')
        const mask = await readSourceMask(buffer, volume, region.voxel_count)
        if (this.disposed) return
        this.masks.set(id, mask)
      }, this.loading.signal, () => !this.disposed && assetGeneration === this.assetGeneration)
      if (generation !== this.generation) return
    }
    if (replacingBackground || replacingOverlay) {
      // Preparation above leaves the old image/grid interactive. Only this
      // short, synchronous complete-stack commit suppresses native drawing.
      nv.holdSceneDraw = true
      this.syncing = true
      try {
        if (replacingBackground) {
          nv.closePAQD(); retainVolumeMetadata(nv, []); nv.volumes = []
          for (const source of preparedBackground!.volumes) addPreparedVolume(nv, source)
          if (this.labelIndex >= 0) {
            const source = preparedBackground!.volumes[this.labelIndex], label = source.image
            if (label !== this.labelVolume?.image) {
              const display = this.manifest.structures.length <= 255 ? new Uint8Array(label.img!.length) : new Uint16Array(label.img!.length)
              compactLabels(label.img!, this.manifest.structures.filter(s => s.kind !== 'streamline-bundle' && s.kind !== 'independent-region'), display)
              label.img = display
              label.hdr!.datatypeCode = display instanceof Uint8Array ? 2 : 512
              label.hdr!.numBitsPerVoxel = display.BYTES_PER_ELEMENT * 8
              label.hdr!.intent_code = 1002
              label.cal_min = 0; label.cal_max = this.manifest.structures.length
              this.labelVolume = source
            }
          }
          this.background = state.background; this.preparedBackground = null
        } else if (nv.volumes[fieldIndex]) nv.removeVolume(nv.volumes[fieldIndex])
        this.rendered = null
        if (preparedOverlay) {
          addPreparedVolume(nv, preparedOverlay)
          if (state.overlay === 'mask' && selected) {
            const [r, g, b] = selected.color
            preparedOverlay.image.setColormapLabel({ I: [0, 1], R: [0, r], G: [0, g], B: [0, b], A: [0, 255], labels: ['Background', selected.name] })
          }
        }
        this.overlayId = wantedOverlay; this.preparedOverlay = null
      } finally { this.syncing = false }
    }
    this.syncing = true
    nv.holdSceneDraw = true
    try {
      nv.markers = state.annotations
      this.updateCutaway(state)
      nv.sectionGuides = (state.sectionPlanes ?? []).map(plane => ({ plane,
        polygon: sectionPolygon(this.manifest.volumes.find(volume => volume.id === state.background)!, state.position, plane) }))
      nv.showMarkers = state.showMarkers !== false
      nv.imageContext = !this.model && state.imageContext
      nv.sliceBackgroundOpacity = this.model ? null : state.background2D === false ? 0 : state.backgroundOpacity2D ?? 1
      nv.volumeBackgroundOpacity = state.backgroundOpacity3D ?? 1
      nv.anatomyVolumeOpacity = state.meshOpacity
      nv.anatomyContextOpacity = state.surfaceContext?.enabled ? state.surfaceContext.opacity : 0
      nv.sliceOverlayOpacity = this.model || this.streamlines || this.imageOnly ? 1 : state.labelOpacity
      const showCursor = state.showCursor ?? state.show3DCursor ?? true
      nv.opts.show3Dcrosshair = showCursor
      nv.opts.crosshairWidth = showCursor ? 1 : 0
      nv.focus3D = state.focus3D ?? null
      // Opacity changes appearance, not the framing contract. In particular,
      // zero opacity must not drop a displayed structure and move the camera.
      const frameIds = new Set([...state.visible, ...(state.surfaceContext?.structure_ids ?? [])])
      const fitted = (state.fitVisible3D ?? false)
        ? this.manifest.structures.filter(structure => frameIds.has(structure.id)) : []
      nv.fitBounds = fitted.length ? [
        [0, 1, 2].map(axis => Math.min(...fitted.map(structure => structure.bounds_ras_mm[0][axis]))) as Vec3,
        [0, 1, 2].map(axis => Math.max(...fitted.map(structure => structure.bounds_ras_mm[1][axis]))) as Vec3
      ] : null
      if (nv.fitBounds) nv.focus3D = nv.fitBounds[0].map((low, axis) => (low + nv.fitBounds![1][axis]) / 2) as Vec3
      nv.opts.meshThicknessOn2D = this.streamlines ? (state.streamlineSlabMm ?? 1) / 2 : 0
      nv.streamlineSectionOpacity = state.labelOpacity
      nv.opts.isRadiologicalConvention = state.radiological
      nv.opts.multiplanarLayout = {auto: 0, grid: 2, row: 3}[state.tileLayout ?? 'grid']
      nv.opts.heroImageFraction = 0
      nv.opts.heroSliceType = nv.sliceTypeRender
      nv.opts.sliceType = { quad: nv.sliceTypeMultiplanar, axial: nv.sliceTypeAxial, coronal: nv.sliceTypeCoronal, sagittal: nv.sliceTypeSagittal, '3d': nv.sliceTypeRender }[state.layout as Exclude<ViewState['layout'], 'anatomy'>]
      nv.scene.crosshairPos = nv.mm2frac(state.position, 0, true)
      this.rememberCursor(state.position)
      nv.relativeZoom = state.zoom3D
      if (!nv.fitBounds) nv.zoomBase = state.camera[2] / viewZoom3D(state)
      nv.scene.renderAzimuth = state.camera[0]; nv.scene.renderElevation = state.camera[1]; nv.scene.volScaleMultiplier = state.camera[2]
      nv.scene.pan2Dxyzmm = [...state.pan]
      const visible = new Set(state.visible)
      const textureChanged = !this.rendered || !same(state.visible, this.rendered.visible) || state.overlay !== this.rendered.overlay || !same(state.window, this.rendered.window)
        || (this.model && (state.background2D !== this.rendered.background2D || state.backgroundOpacity2D !== this.rendered.backgroundOpacity2D))
      if (textureChanged) {
        if (!this.model) { nv.volumes[0].cal_min = state.window[0]; nv.volumes[0].cal_max = state.window[1] }
        if (this.labelIndex >= 0) {
        const entries = [{ color: [0, 0, 0], id: '', name: 'Background' }, ...this.manifest.structures]
        // NiiVue's base-slice shader uses global opacity and ignores label alpha.
        // Hidden categorical base labels therefore also require black RGB.
        const channel = (index: number) => entries.map(entry => this.model && !visible.has(entry.id)
          ? entry.id && state.background2D === true ? Math.round(BACKGROUND_COLOR[index] * (state.backgroundOpacity2D ?? 1)) : 0 : entry.color[index])
        nv.volumes[this.labelIndex].setColormapLabel({ I: entries.map((_, i) => i), R: channel(0), G: channel(1), B: channel(2),
          A: entries.map(x => visible.has(x.id) ? 255 : 0), labels: entries.map(x => x.name) })
        }
      }
      // Opacity belongs to the 2D draw, not the resampled 3D overlay texture.
      // Keeping active textures at full alpha also makes zero -> visible cheap.
      if (this.labelIndex >= 0) nv.volumes[this.labelIndex].opacity = this.model ? state.labelOpacity : state.overlay === 'probability' ? 0 : 1
      if (this.overlayId && nv.volumes[fieldIndex]) nv.volumes[fieldIndex].opacity = 1
      for (const [id, mesh] of this.meshes) {
        mesh.visible = renderedIds.has(id); mesh.opacity = contextOpacity(state, id, surfaceOpacity(state, id))
        const source = this.manifest.structures.find(item => item.id === id)!
        if (source.kind !== 'streamline-bundle') {
          const color = [...(context.has(id) ? BACKGROUND_COLOR : source.color), 255]
          if (color.some((value, axis) => mesh.rgba255[axis] !== value)) mesh.setProperty('rgba255', new Uint8Array(color), nv.gl)
        }
      }
      nv.deferVolumeUploads = false
      if (textureChanged) {
        // A changed overlay can reuse the already displayed MRI/CT texture.
        if (this.rendered && !this.model && same(state.window, this.rendered.window)) refreshOverlayTextures(nv)
        else nv.updateGLVolume()
      }
      if (this.labelIndex >= 0) {
        nv.anatomyVolumeTexture = this.labelVolumes.get(nv, nv.volumes[this.labelIndex], labelVolumePalette(this.manifest.structures, state))
        nv.anatomyIdTexture = state.meshOpacity > 0 && state.meshOpacity < 1
          ? this.labelIds.get(nv, nv.volumes[this.labelIndex], labelVolumeIdPalette(this.manifest.structures, state)) : null
        nv.anatomyContextTexture = state.surfaceContext?.enabled
          ? this.contextVolumes.get(nv, nv.volumes[this.labelIndex], labelContextVolumePalette(this.manifest.structures, state)) : null
      }
      nv.holdSceneDraw = false
      nv.drawScene()
      this.rendered = structuredClone(state)
    } finally { this.syncing = false }
    nv.deferMeshUpdates = true
    let meshesChanged = false
    try {
      // Categorical anatomy is rendered and picked from its source label
      // volume; 2D meshes are disabled, so their duplicate surfaces are unused.
      const missing = this.labelIndex >= 0 ? [] : [...renderedIds].map(id => {
        const structure = this.manifest.structures.find(s => s.id === id)!
        const level = structure.kind === 'streamline-bundle' ? displayLevel(structure, state.streamlineLevel) : null
        const file = level?.file ?? structure.mesh_file!
        return { id, structure, level, file }
      }).filter(item => this.meshFiles.get(item.id) !== item.file)
      await loadAssetsInOrder(missing, item => this.resources.url(item.file), async ({ id, structure, level, file }, buffer) => {
        meshesChanged = true
        if (this.meshes.has(id)) { this.removeMesh(id); }
        this.status(this.streamlines ? 'Loading source streamline display subset…' : 'Loading local structure surfaces…')
        this.syncing = true
        try {
          let mesh: NVMesh
          if (level) {
            const data = parseTck(buffer, level)
            if (this.disposed) return
            mesh = new NVMesh(data.pts, data.offsetPt0, structure.name, new Uint8Array([...structure.color, 0]), surfaceOpacity(state, id), false, nv.gl)
            // In 0.69.0 a zero minimum returns before rebuilding fibers. Negative
            // one disables length filtering while retaining zero-length records.
            mesh.fiberDither = 0; mesh.fiberColor = 'Fixed'; mesh.fiberLength = -1; mesh.fiberDecimationStride = 1
            mesh.fiberRadius = 0; mesh.fiberSides = 0; mesh.updateFibers(nv.gl)
            nv.addMesh(mesh)
          } else {
            const color = [...(context.has(id) ? BACKGROUND_COLOR : structure.color), 255], opacity = contextOpacity(state, id, surfaceOpacity(state, id))
            mesh = this.resources.isPreparedMesh(file)
              ? addPreparedMesh(nv,buffer,structure.source_name,color,opacity)
              : await nv.addMeshFromUrl({ url: this.resources.url(file), buffer, name: structure.source_name + '.gii', rgba255: color, opacity, visible: false })
          }
          if (this.disposed) return
          this.meshes.set(id, mesh); this.meshFiles.set(id, file)
          this.updateCutaway(this.current!)
          mesh.visible = this.current!.visible.includes(id) || contextIds(this.current!).includes(id); mesh.opacity = contextOpacity(this.current!, id, surfaceOpacity(this.current!, id))
        } finally { this.syncing = false }
      }, this.loading.signal, () => !this.disposed && assetGeneration === this.assetGeneration)
      if (generation !== this.generation) return
      for (const [id, mesh] of this.meshes) {
        if (this.meshes.size <= (this.streamlines ? 6 : 32)) break
        if (!renderedIds.has(id)) { this.removeMesh(id); meshesChanged = true }
      }
    } finally {
      nv.deferMeshUpdates = false
      if (!this.disposed && meshesChanged && generation === this.generation) nv.drawScene()
    }
    if (this.refreshSelection) {
      this.refreshSelection = false
      this.emit(this.locate(state.position, state.selectionEvidence?.sectionAxis ?? -1))
    }
    if (this.independent && state.selectionEvidence?.kind === 'independent-mask') this.emit(this.locate(state.position))
    this.syncFittedCamera()
    this.status('Ready · local data')
  }
  snapshot(state: ViewState): ViewState {
    // Location callbacks already update the physical application cursor. Reading
    // it back through GPU-oriented float32 fractions loses precision on oblique
    // grids and shifts thin display-guide edges after a save/restore cycle.
    return { ...cursorView(atlasDisplayView(state)), position: [...state.position], ...(this.nv.fitBounds ? {fitVisible3D: true, focus3D: this.nv.focus3D!} : {}),
      camera: [this.nv.scene.renderAzimuth, this.nv.scene.renderElevation, this.nv.scene.volScaleMultiplier],
      pan: Array.from(this.nv.scene.pan2Dxyzmm) as ViewState['pan'], window: this.model ? state.window : [this.nv.volumes[0].cal_min ?? state.window[0], this.nv.volumes[0].cal_max ?? state.window[1]] }
  }
  zoom3DChange(value: number): Partial<ViewState> {
    const factor = zoomFactor(value)
    return { zoom3D: factor, camera: [this.nv.scene.renderAzimuth, this.nv.scene.renderElevation, zoomScale3D(this.nv.zoomBase, factor)] }
  }
  setCursorStructure(position: Vec3, structureId: string | null): void {
    this.cursorReadout.remember(position, structureId)
  }
  cursorStructureAt(position: Vec3): string | null {
    if (this.disposed) return null
    const known = this.cursorReadout.at(position)
    if (known) return known.structureId
    if (this.labelIndex >= 0 && this.nv.volumes[this.labelIndex] && this.current?.overlay !== 'probability') return this.sourceLabelAt(position)
    return this.current ? this.cursorIdentity(this.locate(position), position) : null
  }
  locateCursor(position: Vec3, sectionAxis = -1): Partial<ViewState> {
    const selection = this.locate(position, sectionAxis)
    this.setCursorStructure(position, this.cursorIdentity(selection, position))
    return this.cursorPatch(selection)
  }
  private cursorIdentity(selection: Partial<ViewState>, position: Vec3): string | null {
    const id = selection.selected ?? null
    if (this.independent && id && !selection.selectionEvidence?.candidates.includes(id)) return null
    if (this.current?.overlay === 'probability' && id && (this.probabilityAt(position, id) ?? 0) <= 0) return null
    return id
  }
  private sourceLabelAt(position: Vec3): string | null {
    const labels = this.nv.volumes[this.labelIndex], volume = this.manifest.volumes.find(v => v.kind === 'labels')
    if (!labels || !volume) return null
    const vox = labels.mm2vox(position), shape = volume.shape
    const inside = Array.from(vox).every((v, i) => v >= 0 && v < shape[i])
    const value = inside ? labels.getValue(vox[0], vox[1], vox[2]) : 0
    return this.manifest.structures[value - 1]?.id ?? null
  }
  locate(position: Vec3, sectionAxis = -1): Partial<ViewState> {
    if (this.imageOnly) return { position, selected: null, selectionEvidence: { kind: 'image-cursor', candidates: [] } }
    if (this.streamlines) {
      const bundles = [...this.meshes].filter((entry): entry is [string, NVMesh & { offsetPt0: Uint32Array }] => entry[1].offsetPt0 !== null)
      const selection = sectionAxis >= 0 && this.current?.labelOpacity === 0
        ? { selected: null, selectionEvidence: { kind: 'visible-streamline' as const, candidates: [], sectionAxis: sectionAxis as 0 | 1 | 2 } }
        : resolveStreamlineSelection(position, bundles, this.current?.selected ?? null, 1, sectionAxis, this.current?.streamlineSlabMm ?? 1)
      return { ...selection, position }
    }
    if (this.independent) return { position, selected: this.current?.selected ?? null,
      selectionEvidence: { kind: 'independent-mask', candidates: regionMemberships(this.masks, this.current?.visible ?? [], position) } }
    if (this.current?.overlay === 'probability') {
      const selected = this.current.selected
      return { position, selected, selectionEvidence: { kind: 'probability-cursor', candidates: selected ? [selected] : [] } }
    }
    const selected = this.sourceLabelAt(position)
    return { position, selected, selectionEvidence: { kind: 'label-voxel', candidates: selected ? [selected] : [] } }
  }
  imageAt(position: Vec3): number | null {
    const volume = this.nv.volumes[0], spec = this.manifest.volumes.find(item => item.id === this.background)
    if (!volume || !spec || !['image', 'scalar'].includes(spec.kind)) return null
    const voxel = volume.mm2vox(position)
    if (Array.from(voxel).some((value, axis) => value < 0 || value >= spec.shape[axis])) return null
    const value = volume.getValue(voxel[0], voxel[1], voxel[2])
    return Number.isFinite(value) ? value : null
  }
  probabilityAt(position: Vec3, selected: string | null): number | null {
    const spec = this.manifest.structures.find(s => s.id === selected)?.probability
    const fieldIndex = this.independent ? 1 : 2
    if (!spec || spec.volume_id !== this.overlayId || !this.nv.volumes[fieldIndex]) return null
    const volume = this.nv.volumes[fieldIndex], vox = volume.mm2vox(position)
    const shape = this.manifest.volumes.find(v => v.id === spec.volume_id)!.shape
    if (Array.from(vox).some((v, i) => v < 0 || v >= shape[i])) return null
    const value = volume.getValue(vox[0], vox[1], vox[2])
    return Number.isFinite(value) ? value : null
  }
  capture(): string { this.nv.drawScene(); return this.canvas.toDataURL('image/png') }
  private updateCutaway(state: ViewState) {
    this.nv.surfaceCutaway = cursorCutaway(state.surfaceCutaway, state.position)
    const context = new Set(contextIds(state))
    const ids = [...this.meshes].filter(([id]) => state.surfaceCutaway && (state.surfaceCutaway.structures.includes(id) || context.has(id))).map(([, mesh]) => mesh.id)
    if (ids.length === this.nv.cutawayMeshIds.size && ids.every(id => this.nv.cutawayMeshIds.has(id))) return
    this.nv.cutawayMeshIds.clear()
    for (const id of ids) this.nv.cutawayMeshIds.add(id)
  }
  private removeMesh(id: string) {
    const mesh = this.meshes.get(id)
    if (!mesh) return
    this.nv.removeMesh(mesh)
    this.meshes.delete(id); this.meshFiles.delete(id)
  }
  private release() {
    if (!this.attached || this.released) return
    this.released = true
    this.labelVolumes.dispose(this.nv)
    this.contextVolumes.dispose(this.nv)
    this.labelIds.dispose(this.nv)
    this.nv.anatomyVolumeTexture = null
    this.nv.anatomyIdTexture = null
    this.nv.anatomyContextTexture = null
    this.nv.cleanup()
    // NiiVue cleanup removes listeners but does not free its GL resources.
    // Each workspace owns its canvas/context, so releasing it is isolated.
    this.nv.gl.getExtension('WEBGL_lose_context')?.loseContext()
    this.meshes.clear(); this.meshFiles.clear(); this.masks.clear()
  }
  dispose() {
    this.cursorReadout.clear()
    this.disposed = true; this.preparedBackground = null; this.preparedOverlay = null; this.labelVolume = null
    this.loading.abort(); this.generation++; this.canvas.removeEventListener('mousedown', this.pointer, true); this.canvas.removeEventListener('mousemove', this.pointer, true)
    this.sliceClick.cancel(); this.canvas.removeEventListener('mouseup', this.pickSlice); this.canvas.removeEventListener('dblclick', this.doubleClick, true); this.canvas.removeEventListener('mouseleave', this.cancelClick); this.canvas.removeEventListener('blur', this.cancelClick); this.canvas.removeEventListener('wheel', this.cancelClick, true); this.canvas.removeEventListener('touchstart', this.cancelClick, true)
    if (!this.task) this.release()
  }
}
