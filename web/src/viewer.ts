import { Niivue, NVMesh } from '@niivue/niivue'
import { imageRenderKey } from './renderState'
import { unProject } from '@niivue/niivue/utils'
import type { Manifest, Vec3, ViewState } from './types'
import { regionMemberships, type SparseMask } from './independentRegions'
import { compactLabels } from './palette'
import { resolveSurfaceSelection } from './selection'
import { SourceDepthNiivue } from './depthRenderer'
import { displayLevel, parseTck, resolveStreamlineSelection } from './streamlines'
import { equalAnatomyPanels, fitBoundsZoom, surfaceOpacity } from './display'
import { sectionPolygon } from './sectionPlanes'
import { removedByCutaway } from './cutaway'
import { depthSamplePixel, decodeSurfaceDepth } from './picking'
import { refreshOverlayTextures, retainVolumeMetadata } from './volumeResources'
import { BACKGROUND_COLOR, contextIds, contextOpacity } from './atlasBackground'
import { loadAssetsInOrder } from './assetLoading'
import { readSourceMask } from './maskLoading'
import { RenderAssets } from './renderAssets'
import { addPreparedMesh } from './meshLoading'

// NiiVue 0.69.0 has no independent public visibility flag for 3D volume rendering.
// This pinned renderer hook preserves its real MRI slice renderer unchanged.
class AtlasNiivue extends SourceDepthNiivue {
  imageContext = false
  sliceBackgroundOpacity: number | null = null
  volumeBackgroundOpacity = 1
  focus3D: Vec3 | null = null
  fitBounds: [Vec3, Vec3] | null = null
  fitting3D = false
  private orientationCalls: Parameters<Niivue['drawSliceOrientationText']>[] | null = null
  private drawingOrientation = false
  private crosshairDrawWidth = Number.NaN
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
    const sample = depthSamplePixel(this.mousePos, this.gl.canvas.height, this.gl.getParameter(this.gl.VIEWPORT))
    if (!sample) return
    // Read an integer pixel and unproject that same pixel's center. The pinned
    // renderer otherwise truncates an extra row after flipping a subpixel Y.
    const rgba = new Uint8Array(4)
    this.gl.readPixels(sample.x, sample.y, 1, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, rgba)
    this.selectedObjectId = rgba[3]
    if (this.selectedObjectId === this.VOLUME_ID) {
      this.scene.crosshairPos = new Float32Array(rgba.slice(0, 3)).map(value => value / 255)
      return
    }
    const depth = decodeSurfaceDepth(rgba)
    if (depth === null) return
    const mm = unProject(sample.fx, sample.fy, depth, args[1]), fraction = this.mm2frac(mm, 0, true)
    if (Array.from(fraction).some(value => !Number.isFinite(value) || value < 0 || value > 1)) return
    this.scene.crosshairPos = fraction
  }
  private anatomyPanel(plane: number): number[] | null {
    if (this.opts.bounds || this.opts.sliceType !== this.sliceTypeMultiplanar || this.opts.heroSliceType !== this.sliceTypeRender
      || !(this.opts.heroImageFraction > 0 && this.opts.heroImageFraction < 1)) return null
    return equalAnatomyPanels(this.effectiveCanvasWidth(), this.effectiveCanvasHeight())[plane === this.sliceTypeRender ? 3 : plane] ?? null
  }
  override draw2D(...args: Parameters<Niivue['draw2D']>) {
    const panel = this.anatomyPanel(args[1])
    if (panel && args[1] >= this.sliceTypeAxial && args[1] <= this.sliceTypeSagittal) {
      const margin = Math.max(0, this.opts.tileMargin) * (this.uiData.dpr || 1) / 2
      args[0] = [panel[0] + margin, panel[1] + margin, Math.max(1, panel[2] - 2 * margin), Math.max(1, panel[3] - 2 * margin)]
      // Let the pinned renderer fit each original plane with its physical aspect
      // ratio. Its screen tile records then also drive the matching pointer map.
      args[3] = [Infinity, Infinity]
    }
    return super.draw2D(...args)
  }
  override draw2DMain(...args: Parameters<Niivue['draw2DMain']>) {
    const background = this.volumes[0], previous = background?.opacity
    if (background && this.sliceBackgroundOpacity !== null) background.opacity = this.sliceBackgroundOpacity
    try { super.draw2DMain(...args) }
    finally { if (background) background.opacity = previous! }
  }
  override draw3D(...args: Parameters<Niivue['draw3D']>) {
    const panel = this.anatomyPanel(this.sliceTypeRender)
    if (panel) args[0] = panel
    if (this.fitBounds) {
      this.fitting3D = true
      try {
        this.setPivot3D()
        this.scene.volScaleMultiplier = 1
        const matrix = this.calculateMvpMatrix(null, args[0] ?? [0, 0, 0, 0], this.scene.renderAzimuth, this.scene.renderElevation)[0]
        this.scene.volScaleMultiplier = fitBoundsZoom(this.fitBounds, matrix)
      } finally { this.fitting3D = false }
    }
    return super.draw3D(...args)
  }
  override drawCrosshairs3D(...args: Parameters<Niivue['drawCrosshairs3D']>) {
    const originalWidth = this.opts.crosshairWidth
    // A source-voxel-sized cursor must not obscure small nuclei when magnified.
    // Adjust only the 3D guide; original slice cursors and coordinates stay intact.
    const width = args[3] ? originalWidth : originalWidth / Math.max(1, this.scene.volScaleMultiplier)
    if (width !== this.crosshairDrawWidth && this.crosshairs3D?.mm) this.crosshairs3D.mm[0] = Number.NaN
    this.crosshairDrawWidth = width
    this.opts.crosshairWidth = width
    try { return super.drawCrosshairs3D(...args) }
    finally { this.opts.crosshairWidth = originalWidth }
  }
  override drawSceneCore() {
    this.orientationCalls = []
    try {
      const result = super.drawSceneCore()
      const calls = this.orientationCalls
      this.orientationCalls = null
      // Crosshairs and later tiles must not overwrite a thin direction glyph,
      // especially the inferior I when it shares the vertical cursor line.
      for (const args of calls) this.drawSliceOrientationText(...args)
      if (this.anatomyPanel(this.sliceTypeRender)) {
        const panels = equalAnatomyPanels(this.effectiveCanvasWidth(), this.effectiveCanvasHeight())
        const depth = this.gl.isEnabled(this.gl.DEPTH_TEST)
        this.gl.disable(this.gl.DEPTH_TEST)
        for (const [x, y, width, height] of panels) {
          if (x > 0) this.drawLine([x, y, x, y + height], this.uiData.dpr || 1, [.16, .23, .28, 1])
          if (y > 0) this.drawLine([x, y, x + width, y], this.uiData.dpr || 1, [.16, .23, .28, 1])
        }
        if (depth) this.gl.enable(this.gl.DEPTH_TEST)
      }
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
    if (!this.imageContext) return
    const shader = this.renderShader
    if (!shader) return
    shader.use(this.gl)
    this.gl.uniform1f(shader.uniforms.backOpacity, this.volumeBackgroundOpacity)
    this.gl.uniform1f(shader.uniforms.overlays, 0)
    try { super.drawImage3D(...args) }
    finally {
      shader.use(this.gl)
      this.gl.uniform1f(shader.uniforms.backOpacity, this.volumes[0]?.opacity ?? 1)
      this.gl.uniform1f(shader.uniforms.overlays, this.overlays.length)
    }
  }
  override sliceScroll3D(change = 0) {
    const clip = this.scene.clipPlaneDepthAziElevs[this.uiData.activeClipPlaneIndex]
    if (this.volumes.length && clip?.[0] < 1.8) return super.sliceScroll3D(change)
    if (change === 0) return
    // Match the scene contract's camera range. The pinned renderer otherwise
    // caps wheel zoom at 2, preventing close inspection of small source regions.
    this.setScale(Math.max(.1, Math.min(20, this.scene.volScaleMultiplier * (change > 0 ? 1.1 : .9))))
  }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export class AtlasViewer {
  readonly nv: AtlasNiivue
  private meshes = new Map<string, NVMesh>()
  private meshFiles = new Map<string, string>()
  private current: ViewState | null = null
  private rendered: ViewState | null = null
  private disposed = false
  private generation = 0
  private syncing = false
  private background = ''
  private task: Promise<void> | null = null
  private appliedKey = ''
  private resize: ResizeObserver
  private pointerIn3D = false
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
      if (this.syncing || !this.current || this.disposed) return
      const location = event as { mm: ArrayLike<number>; axCorSag: number; values: { value: number }[] }
      const position: Vec3 = [location.mm[0], location.mm[1], location.mm[2]]
      if (!position.every(Number.isFinite)) return
      // Render values are dense palette indices; source label values stay in the
      // manifest and on disk. This avoids GPU texture limits for sparse labels.
      const value = location.values[this.labelIndex]?.value
      const voxelSelected = this.manifest.structures[value - 1]?.id ?? null
      // A picked isosurface lies between voxel centers. Its nearest categorical
      // voxel may belong to a neighboring structure, including a hidden one.
      // Resolve the visible surface first, then retain voxel lookup as fallback.
      const selection = this.imageOnly ? this.locate(position) : this.streamlines ? this.locate(position, this.pointerIn3D ? -1 : [2, 1, 0][location.axCorSag] ?? -1) : this.pointerIn3D ? resolveSurfaceSelection(position, [...this.meshes].filter(([id]) => this.current!.visible.includes(id)), voxelSelected,
        Math.max(...this.manifest.volumes.find(v => v.kind === (this.independent ? 'image' : 'labels'))!.voxel_size_mm), this.current.selected,
        this.current.surfaceCutaway ? (id, point) => !removedByCutaway(this.current!.surfaceCutaway, id, point) : undefined) : this.locate(position)
      const selected = selection.selected
      if (position.every((v, i) => Math.abs(v - this.current!.position[i]) < 1e-4) && selected === this.current.selected) return
      this.emit({ ...selection, position })
    }
    this.nv.onAzimuthElevationChange = (a, e) => this.emit({ camera: [a, e, this.nv.scene.volScaleMultiplier] })
    this.nv.onZoom3DChange = z => {
      if (this.syncing || this.nv.fitting3D) return
      this.nv.fitBounds = null
      this.emit({ fitVisible3D: false, camera: [this.nv.scene.renderAzimuth, this.nv.scene.renderElevation, z] })
    }
    this.nv.onIntensityChange = volume => {
      if (!this.model && volume === this.nv.volumes[0] && Number.isFinite(volume.cal_min) && Number.isFinite(volume.cal_max)) this.emit({ window: [volume.cal_min!, volume.cal_max!] })
    }
    this.nv.onMouseUp = () => this.emit({ pan: Array.from(this.nv.scene.pan2Dxyzmm) as ViewState['pan'] })
    this.resize = new ResizeObserver(() => { if (!this.disposed && this.nv.canvas) { this.nv.resizeListener(); this.syncFittedCamera() } })
    canvas.addEventListener('mousedown', this.pointer, true)
    canvas.addEventListener('mousemove', this.pointer, true)
  }
  private pointer = (event: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect(), x = (event.clientX - rect.left) * this.canvas.width / rect.width, y = (event.clientY - rect.top) * this.canvas.height / rect.height
    this.pointerIn3D = this.nv.screenSlices.some(s => { const [l, t, w, h] = s.leftTopWidthHeight; return s.axCorSag === this.nv.sliceTypeRender && x >= l && x <= l + w && y >= t && y <= t + h })
  }
  private emit(patch: Partial<ViewState>) {
    if (this.syncing || this.disposed || !this.current) return
    if (Object.entries(patch).some(([key, value]) => !same(value, this.current![key as keyof ViewState]))) this.changed(patch)
  }
  private syncFittedCamera() {
    if (this.nv.fitBounds) this.emit({ focus3D: this.nv.focus3D!, camera: [this.nv.scene.renderAzimuth, this.nv.scene.renderElevation, this.nv.scene.volScaleMultiplier] })
  }
  async initialize(state: ViewState) {
    await Promise.all([
      this.nv.attachToCanvas(this.canvas).then(() => { this.attached = true; if (this.disposed) this.release() }),
      this.resources.load(this.manifest.assets, this.loading.signal),
    ])
    if (this.disposed) { this.release(); return }
    if (this.labelIndex >= 0 && this.manifest.structures.length + 1 > this.nv.gl.getParameter(this.nv.gl.MAX_TEXTURE_SIZE)) throw new Error('This package has more labels than this GPU can display in one layer.')
    this.resize.observe(this.canvas.parentElement!)
    await this.apply(state)
  }
  apply(state: ViewState): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.current = state
    if (!this.task && this.appliedKey === imageRenderKey(state)) return Promise.resolve()
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
    const nv = this.nv
    // Prepare the complete stack and compact label palette before the first
    // upload. Adding an image or selected field must not upload a partial stack.
    nv.deferVolumeUploads = true
    const context = new Set(contextIds(state)), renderedIds = new Set([...state.visible, ...context])
    const selectionSettings = (value: ViewState | null) => value && [value.position, value.visible, value.streamlineLevel, value.streamlineSlabMm, value.labelOpacity, value.meshOpacity, value.surfaceOpacity]
    if (this.streamlines && state.selectionEvidence?.kind === 'visible-streamline') {
      this.refreshSelection ||= !same(selectionSettings(state), selectionSettings(this.rendered))
    } else this.refreshSelection = false
    if (this.background !== state.background) {
      const image = this.manifest.volumes.find(v => v.id === state.background)!, labels = this.manifest.volumes.find(v => v.kind === 'labels')!
      this.status(`Loading ${image.name}…`)
      this.syncing = true
      try {
        await nv.loadVolumes(this.imageOnly || this.streamlines || this.independent ? [{ url: this.resources.url(image.file), name: image.id + '.nii.gz', colormap: 'gray', cal_min: state.window[0], cal_max: state.window[1] }] : this.model ? [{ url: this.resources.url(labels.file), name: 'labels.nii.gz', opacity: 0, cal_min: 0, cal_max: labels.cal_max }] :
          [{ url: this.resources.url(image.file), name: image.id + '.nii.gz', colormap: 'gray', cal_min: state.window[0], cal_max: state.window[1] },
           { url: this.resources.url(labels.file), name: 'labels.nii.gz', opacity: 0, cal_min: 0, cal_max: labels.cal_max }])
        if (this.disposed) return
        if (this.labelIndex >= 0) {
          const label = nv.volumes[this.labelIndex]
          const display = this.manifest.structures.length <= 255 ? new Uint8Array(label.img!.length) : new Uint16Array(label.img!.length)
          compactLabels(label.img!, this.manifest.structures.filter(s => s.kind !== 'streamline-bundle' && s.kind !== 'independent-region'), display)
          label.img = display
          label.hdr!.datatypeCode = display instanceof Uint8Array ? 2 : 512
          label.hdr!.numBitsPerVoxel = display.BYTES_PER_ELEMENT * 8
          // Render the browser's compact palette as categorical labels. The
          // scalar shader clamps low palette coordinates and can color label 0.
          nv.volumes[this.labelIndex].hdr!.intent_code = 1002
          nv.volumes[this.labelIndex].cal_min = 0; nv.volumes[this.labelIndex].cal_max = this.manifest.structures.length
        }
        this.background = state.background; this.rendered = null
        this.overlayId = ''
      } finally { this.syncing = false }
      if (generation !== this.generation) return
    }
    const selected = state.selected && state.visible.includes(state.selected)
      ? this.manifest.structures.find(s => s.id === state.selected) : null
    const field = state.overlay === 'probability' ? selected?.probability
      : this.independent && state.overlay === 'mask' ? selected?.mask : null
    const wantedOverlay = field?.volume_id ?? '', fieldIndex = this.independent ? 1 : 2
    if (this.overlayId !== wantedOverlay) {
      this.syncing = true
      try {
        if (nv.volumes[fieldIndex]) nv.removeVolume(nv.volumes[fieldIndex])
        this.overlayId = ''; this.rendered = null
        if (wantedOverlay) {
          const volume = this.manifest.volumes.find(v => v.id === wantedOverlay)!
          this.status('Loading selected source ' + (state.overlay === 'mask' ? 'mask…' : 'probability field…'))
          await nv.addVolumeFromUrl({ url: volume.kind === 'mask' ? this.base + volume.file : this.resources.url(volume.file), name: volume.name, colormap: 'viridis', cal_min: volume.cal_min, cal_max: volume.cal_max, opacity: state.labelOpacity })
          if (this.disposed) return
          this.overlayId = wantedOverlay
          if (state.overlay === 'mask' && selected) {
            const [r, g, b] = selected.color
            nv.volumes[fieldIndex].setColormapLabel({ I: [0, 1], R: [0, r], G: [0, g], B: [0, b], A: [0, 255], labels: ['Background', selected.name] })
          }
        }
      } finally { this.syncing = false }
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
      }, this.loading.signal, () => !this.disposed && generation === this.generation)
      if (generation !== this.generation) return
    }
    this.syncing = true
    try {
      nv.markers = state.annotations
      this.updateCutaway(state)
      nv.sectionGuides = (state.sectionPlanes ?? []).map(plane => ({ plane,
        polygon: sectionPolygon(this.manifest.volumes.find(volume => volume.id === state.background)!, state.position, plane) }))
      nv.showMarkers = state.showMarkers !== false
      nv.imageContext = !this.model && state.imageContext
      nv.sliceBackgroundOpacity = this.model ? null : state.background2D === false ? 0 : state.backgroundOpacity2D ?? 1
      nv.volumeBackgroundOpacity = state.backgroundOpacity3D ?? 1
      nv.opts.show3Dcrosshair = state.show3DCursor !== false
      nv.focus3D = state.focus3D ?? null
      const fitted = (state.fitVisible3D ?? state.layout === 'anatomy') && !state.imageContext
        ? this.manifest.structures.filter(structure => renderedIds.has(structure.id) && contextOpacity(state, structure.id, surfaceOpacity(state, structure.id)) > 0) : []
      nv.fitBounds = fitted.length ? [
        [0, 1, 2].map(axis => Math.min(...fitted.map(structure => structure.bounds_ras_mm[0][axis]))) as Vec3,
        [0, 1, 2].map(axis => Math.max(...fitted.map(structure => structure.bounds_ras_mm[1][axis]))) as Vec3
      ] : null
      if (nv.fitBounds) nv.focus3D = nv.fitBounds[0].map((low, axis) => (low + nv.fitBounds![1][axis]) / 2) as Vec3
      nv.opts.meshThicknessOn2D = this.streamlines ? (state.streamlineSlabMm ?? 1) / 2 : 0
      nv.streamlineSectionOpacity = state.labelOpacity
      nv.opts.isRadiologicalConvention = state.radiological
      nv.opts.multiplanarLayout = {auto: 0, grid: 2, row: 3}[state.tileLayout ?? 'grid']
      nv.opts.heroImageFraction = state.layout === 'anatomy' ? .55 : 0
      nv.opts.heroSliceType = nv.sliceTypeRender
      if (state.layout === 'anatomy') nv.opts.multiplanarLayout = 0
      nv.opts.sliceType = { quad: nv.sliceTypeMultiplanar, anatomy: nv.sliceTypeMultiplanar, axial: nv.sliceTypeAxial, coronal: nv.sliceTypeCoronal, sagittal: nv.sliceTypeSagittal, '3d': nv.sliceTypeRender }[state.layout]
      nv.scene.crosshairPos = nv.mm2frac(state.position, 0, true)
      nv.scene.renderAzimuth = state.camera[0]; nv.scene.renderElevation = state.camera[1]; nv.scene.volScaleMultiplier = state.camera[2]
      nv.scene.pan2Dxyzmm = [...state.pan]
      const visible = new Set(state.visible)
      const textureChanged = !this.rendered || !same(state.visible, this.rendered.visible) || state.labelOpacity !== this.rendered.labelOpacity || state.overlay !== this.rendered.overlay || !same(state.window, this.rendered.window)
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
        nv.volumes[this.labelIndex].opacity = state.overlay === 'probability' ? 0 : state.labelOpacity
        }
        if (this.overlayId && nv.volumes[fieldIndex]) nv.volumes[fieldIndex].opacity = state.labelOpacity
      }
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
      } else nv.drawScene()
      this.rendered = structuredClone(state)
    } finally { this.syncing = false }
    nv.deferMeshUpdates = true
    try {
      const missing = [...renderedIds].map(id => {
        const structure = this.manifest.structures.find(s => s.id === id)!
        const level = structure.kind === 'streamline-bundle' ? displayLevel(structure, state.streamlineLevel) : null
        const file = level?.file ?? structure.mesh_file!
        return { id, structure, level, file }
      }).filter(item => this.meshFiles.get(item.id) !== item.file)
      await loadAssetsInOrder(missing, item => this.resources.url(item.file), async ({ id, structure, level, file }, buffer) => {
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
      }, this.loading.signal, () => !this.disposed && generation === this.generation)
      if (generation !== this.generation) return
      for (const [id, mesh] of this.meshes) {
        if (this.meshes.size <= (this.streamlines ? 6 : 32)) break
        if (!renderedIds.has(id)) this.removeMesh(id)
      }
    } finally {
      nv.deferMeshUpdates = false
      if (!this.disposed) nv.drawScene()
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
    return { ...state, position: [...state.position], ...(this.nv.fitBounds ? {fitVisible3D: true, focus3D: this.nv.focus3D!} : {}),
      camera: [this.nv.scene.renderAzimuth, this.nv.scene.renderElevation, this.nv.scene.volScaleMultiplier],
      pan: Array.from(this.nv.scene.pan2Dxyzmm) as ViewState['pan'], window: this.model ? state.window : [this.nv.volumes[0].cal_min ?? state.window[0], this.nv.volumes[0].cal_max ?? state.window[1]] }
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
    const labels = this.nv.volumes[this.labelIndex], vox = labels.mm2vox(position)
    const shape = this.manifest.volumes.find(v => v.kind === 'labels')!.shape
    const inside = Array.from(vox).every((v, i) => v >= 0 && v < shape[i])
    const value = inside ? labels.getValue(vox[0], vox[1], vox[2]) : 0
    const selected = this.manifest.structures[value - 1]?.id ?? null
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
    this.nv.surfaceCutaway = state.surfaceCutaway
    this.nv.cutawayMeshIds = new Set([...this.meshes].filter(([id]) => state.surfaceCutaway?.structures.includes(id)).map(([, mesh]) => mesh.id))
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
    this.nv.cleanup()
    // NiiVue cleanup removes listeners but does not free its GL resources.
    // Each workspace owns its canvas/context, so releasing it is isolated.
    this.nv.gl.getExtension('WEBGL_lose_context')?.loseContext()
    this.meshes.clear(); this.meshFiles.clear(); this.masks.clear()
  }
  dispose() {
    this.disposed = true; this.loading.abort(); this.generation++; this.resize.disconnect(); this.canvas.removeEventListener('mousedown', this.pointer, true); this.canvas.removeEventListener('mousemove', this.pointer, true)
    if (!this.task) this.release()
  }
}
