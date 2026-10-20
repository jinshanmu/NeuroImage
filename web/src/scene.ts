import { processingRecord } from './provenance'
import type { Manifest, SceneFile, ViewState } from './types'
import { validateCutaway } from './cutaway'
import { scopedStructures, validSurfaceContext } from './atlasBackground'
import type { AnatomyScope } from './anatomyNavigation'

export function initialState(manifest: Manifest, scope?: AnatomyScope): ViewState {
  const structures = scopedStructures(manifest.structures, scope)
  const first = structures.find(s => s.name.toLowerCase().includes('left caudate')) ?? structures.find(s => s.name.toLowerCase().includes('caudate')) ?? structures[0] ?? manifest.structures[0]
  const model = manifest.representation === 'label-model'
  const streamlines = manifest.representation === 'mri-streamlines'
  const ct = manifest.representation === 'ct-labels'
  const background = manifest.volumes.find(v => v.kind === (model ? 'labels' : manifest.representation === 'scalar-fields' ? 'scalar' : 'image'))!
  if (['mri-volume', 'scalar-fields'].includes(manifest.representation ?? '')) {
    const position = background.affine_ras_mm.slice(0, 3).map(row => row[3] + background.shape.reduce((sum, size, i) => sum + row[i] * (size - 1) / 2, 0)) as ViewState['position']
    return { selected: null, visible: [], position, background: background.id, overlay: 'none', labelOpacity: 0, meshOpacity: 1,
      radiological: true, layout: 'quad', tileLayout: 'auto', camera: [110, 15, .8], pan: [0, 0, 0, 1], imageContext: !scope || scope.id === 'general-anatomy',
      background2D: true, backgroundOpacity2D: 1, backgroundOpacity3D: !scope || scope.id === 'general-anatomy' ? 1 : .2,
      window: [background.cal_min, background.cal_max], annotations: [], showMarkers: true, note: '',
      selectionEvidence: { kind: 'image-cursor', candidates: [] } }
  }
  const regionSpan = Math.max(...first.bounds_ras_mm[1].map((high, i) => high - first.bounds_ras_mm[0][i]), 1)
  const imageSpan = Math.max(...background.shape.map((size, i) => size * background.voxel_size_mm[i]))
  const regionZoom = Math.max(1.4, Math.min(8, imageSpan / (2 * regionSpan)))
  return { selected: structures.length ? first.id : null, visible: structures.map(s => s.id), position: [...first.target_ras_mm],
    background: background.id, overlay: streamlines ? 'streamlines' : first.probability ? 'probability' : 'labels', labelOpacity: model || streamlines ? 1 : .45, meshOpacity: 1, radiological: true, layout: 'quad', tileLayout: 'auto',
    camera: [110, 15, model && regionSpan > .6 * imageSpan ? .8 : streamlines ? 1.4 : manifest.representation === 'mri-regions' ? regionZoom : 2],
    pan: [0, 0, 0, 1], imageContext: false, fitVisible3D: true,
    background2D: true, backgroundOpacity2D: 1, backgroundOpacity3D: .2,
    window: [background.cal_min, background.cal_max], annotations: [], showMarkers: true, note: '', selectionEvidence: { kind: 'source-target', candidates: [first.id] },
    ...(manifest.representation === 'mri-regions' ? { focus3D: [...first.target_ras_mm] as typeof first.target_ras_mm } : {}),
    ...(ct ? { show3DCursor: false, labelOpacity: .18 } : {}),
    ...(streamlines ? { streamlineLevel: 'standard', streamlineSlabMm: 1 } : {}) }
}
export function makeScene(manifest: Manifest, state: ViewState, title = 'Anatomy scene'): SceneFile {
  // Old scene files can carry retired learning state. Keep their anatomy only.
  const { teaching: _teaching, panel: _panel, ...view } = state as ViewState & { teaching?: unknown; panel?: unknown }
  return { schema_version: '1.0', kind: 'neuroimage-scene', title, saved_utc: new Date().toISOString(),
    package_id: manifest.package_id, package_version: manifest.package_version, build_signature: manifest.build.signature,
    space_id: manifest.space.id, state: structuredClone(view),
    provenance: { sources: manifest.sources, processing: processingRecord(manifest.build), anatomical_review: manifest.validation.anatomical_review, renderer: __NEUROIMAGE_VIEWER__ } }
}
function finiteArray(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(x => typeof x === 'number' && Number.isFinite(x))
}
export function readScene(input: unknown, manifest: Manifest): SceneFile {
  if (!input || typeof input !== 'object') throw new Error('This file is not a NeuroImage scene.')
  const scene = input as SceneFile
  if (scene.kind !== 'neuroimage-scene' || scene.schema_version !== '1.0') throw new Error('Unsupported scene format.')
  if (scene.package_id !== manifest.package_id || scene.package_version !== manifest.package_version || scene.build_signature !== manifest.build.signature || scene.space_id !== manifest.space.id)
    throw new Error('This scene belongs to a different atlas version or native space. Open its matching package first.')
  const s = scene.state, ids = new Set(manifest.structures.map(x => x.id))
  if (!s || !Array.isArray(s.visible) || s.visible.length > ids.size || new Set(s.visible).size !== s.visible.length || s.visible.some(x => !ids.has(x)) || (s.selected !== null && !ids.has(s.selected))) throw new Error('Scene contains unknown or duplicate structures.')
  if (!finiteArray(s.position, 3) || !finiteArray(s.camera, 3) || !finiteArray(s.pan, 4) || !finiteArray(s.window, 2) || s.window[0] >= s.window[1] || s.camera[2] < .1 || s.camera[2] > 20 || s.pan[3] < .1 || s.pan[3] > 20) throw new Error('Scene has invalid coordinates, camera or window settings.')
  if (s.tileLayout !== undefined && !['auto', 'grid', 'row'].includes(s.tileLayout)) throw new Error('Scene has an invalid image panel layout.')
  if (s.focus3D !== undefined && !finiteArray(s.focus3D, 3)) throw new Error('Scene has an invalid physical 3D focus.')
  if (s.fitVisible3D !== undefined && typeof s.fitVisible3D !== 'boolean') throw new Error('Scene has an invalid 3D fitting setting.')
  if (s.surfaceCutaway !== undefined && (manifest.representation === 'mri-streamlines' || !validateCutaway(s.surfaceCutaway, ids))) throw new Error('Scene has an invalid source surface cutaway.')
  if (![s.labelOpacity, s.meshOpacity].every(x => Number.isFinite(x) && x >= 0 && x <= 1) || typeof s.radiological !== 'boolean' || typeof s.imageContext !== 'boolean' || !['quad', 'anatomy', 'axial', 'coronal', 'sagittal', '3d'].includes(s.layout)) throw new Error('Scene has invalid display settings.')
  const model = manifest.representation === 'label-model'
  if (s.background2D !== undefined && typeof s.background2D !== 'boolean') throw new Error('Scene has an invalid 2D background setting.')
  if ([s.backgroundOpacity2D, s.backgroundOpacity3D].some(value => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1))) throw new Error('Scene has an invalid background opacity.')
  if (s.surfaceContext !== undefined && !validSurfaceContext(s.surfaceContext, new Set(manifest.structures.filter(item => item.kind !== 'streamline-bundle').map(item => item.id)))) throw new Error('Scene has invalid source background structures.')
  if (!manifest.volumes.some(v => v.id === s.background && v.kind === (model ? 'labels' : manifest.representation === 'scalar-fields' ? 'scalar' : 'image')) || (model && s.imageContext)) throw new Error('Scene background is unavailable.')
  if (s.selectionEvidence && (!['source-target', 'label-voxel', 'independent-mask', 'visible-surface', 'visible-streamline', 'probability-cursor', 'teaching-marker', 'image-cursor'].includes(s.selectionEvidence.kind) || !Array.isArray(s.selectionEvidence.candidates) || s.selectionEvidence.candidates.some(id => !ids.has(id)))) throw new Error('Scene has invalid selection evidence.')
  if (s.selectionEvidence?.kind === 'image-cursor' && !['mri-volume', 'scalar-fields'].includes(manifest.representation ?? '')) throw new Error('Image-only cursor evidence requires an image-only source.')
  if (s.selectionEvidence?.kind === 'independent-mask' && manifest.representation !== 'mri-regions') throw new Error('Independent memberships require independent source regions.')
  if (s.selectionEvidence?.sectionAxis !== undefined && (s.selectionEvidence.kind !== 'visible-streamline' || ![0, 1, 2].includes(s.selectionEvidence.sectionAxis))) throw new Error('Scene has an invalid streamline selection section.')
  if (s.showMarkers !== undefined && typeof s.showMarkers !== 'boolean') throw new Error('Scene has an invalid marker visibility setting.')
  if (s.show3DCursor !== undefined && typeof s.show3DCursor !== 'boolean') throw new Error('Scene has an invalid 3D cursor visibility setting.')
  if (s.surfaceOpacity !== undefined && (!s.surfaceOpacity || typeof s.surfaceOpacity !== 'object' || Array.isArray(s.surfaceOpacity) ||
      Object.entries(s.surfaceOpacity).some(([id, value]) => !ids.has(id) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)))
    throw new Error('Scene has invalid per-structure surface opacity settings.')
  if (s.sectionPlanes !== undefined && (!Array.isArray(s.sectionPlanes) || new Set(s.sectionPlanes).size !== s.sectionPlanes.length ||
      s.sectionPlanes.some(plane => !['axial', 'coronal', 'sagittal'].includes(plane)))) throw new Error('Scene has invalid section guides.')
  if (manifest.representation === 'mri-streamlines') {
    if (s.overlay !== 'streamlines' || !['preview', 'standard', 'detail'].includes(s.streamlineLevel ?? 'standard') ||
        (s.streamlineSlabMm !== undefined && (!Number.isFinite(s.streamlineSlabMm) || s.streamlineSlabMm < .2 || s.streamlineSlabMm > 10)))
      throw new Error('Scene has invalid streamline display settings.')
  } else {
    if (s.streamlineLevel !== undefined || s.streamlineSlabMm !== undefined) throw new Error('Scene streamline display is unavailable.')
    const overlays = ['mri-volume', 'scalar-fields'].includes(manifest.representation ?? '') ? ['none'] : manifest.representation === 'mri-regions' ? ['mask', 'probability'] : ['labels', 'probability']
    if (['mri-volume', 'scalar-fields'].includes(manifest.representation ?? '') && s.overlay !== 'none') throw new Error('An image-only source cannot imply a label overlay.')
    if (manifest.representation === 'mri-regions' && s.overlay === undefined) throw new Error('Independent regions require an explicit evidence overlay.')
    if (s.overlay !== undefined && (!overlays.includes(s.overlay) || (s.overlay === 'probability' && !manifest.structures.some(structure => structure.probability)))) throw new Error('Scene probability overlay is unavailable.')
  }
  if (typeof s.note !== 'string' || s.note.length > 10000 || !Array.isArray(s.annotations) || s.annotations.length > 200 || s.annotations.some(a => !a || typeof a.id !== 'string' || typeof a.text !== 'string' || a.text.length > 2000 || !finiteArray(a.position_ras_mm, 3) || (a.structure_id !== null && !ids.has(a.structure_id)))) throw new Error('Scene has invalid annotations.')
  return makeScene(manifest, s, typeof scene.title === 'string' ? scene.title : 'Restored scene')
}
export function download(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })), link = document.createElement('a')
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function exportScene(manifest: Manifest, state: ViewState) {
  download(JSON.stringify(makeScene(manifest, state), null, 2), `${manifest.package_id}-scene.json`, 'application/json')
}
