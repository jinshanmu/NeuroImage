import { zipSync, strToU8 } from 'fflate'
import { download, makeScene } from './scene'
import { probabilityNavigationDescription, probabilityScale } from './probability'
import { displayLevel } from './streamlines'
import { cutawayDescription } from './cutaway'
import type { Manifest, ViewState } from './types'

export async function exportTeachingImage(imageUrl: string, manifest: Manifest, state: ViewState, base: string) {
  const image = new Image(); image.src = imageUrl; await image.decode()
  const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!
  const reference = manifest.volumes.find(volume => volume.id === state.background)!
  const selected = manifest.structures.find(structure => structure.id === state.selected)
  const derivedMask = selected?.mask?.origin === 'derived-from-probability'
  const practiceHidden = state.teaching?.practice && !state.teaching.revealed
  const excerpt = (text: string, limit: number) => { const clean = text.replace(/\s+/g, ' ').trim(); return clean.length > limit ? clean.slice(0, limit - 1) + '…' : clean }
  const markerLines = state.annotations.slice(0, 8).map((marker, index) => `${index + 1}. ${excerpt(marker.text, 110)} | RAS mm ${marker.position_ras_mm.map(value => value.toFixed(1)).join(', ')}`)
  const lines = [manifest.title + ' | ' + manifest.space.name,
    reference.name + ' | Cursor RAS mm: ' + state.position.map(value => value.toFixed(1)).join(', ') + ' | ' + (state.radiological ? 'Radiological display' : 'Neurological display'),
    practiceHidden ? 'Identification target | Answer hidden in this image' : 'Selected source structure: ' + (selected?.name ?? 'No source structure selected'),
    'Normal anatomy learning | ' + (manifest.representation === 'ct-labels' ? 'Original CT and source fluid-space labels' : manifest.representation === 'scalar-fields' ? 'Source statistical fields; no reference MRI or segmented anatomy' : manifest.representation === 'mri-volume' ? 'Original source image; no segmentation or anatomical surfaces' : manifest.representation === 'mri-streamlines' ? 'Reference MRI and computational trajectories' : manifest.representation === 'label-model' ? 'Categorical label model; no original MRI' : manifest.representation === 'mri-regions' ? (derivedMask ? 'Source probabilities and project-derived display mask' : 'Independent source regions and probabilities') : 'Source-derived labels and surfaces'),
    ...(manifest.volumes.find(v=>v.id===state.background)?.scalar ? (() => { const field=manifest.volumes.find(v=>v.id===state.background)!.scalar!; return [`Field: ${field.metric} | ${field.statistic} | Units: ${field.units}`,`Display window: ${state.window.join(' to ')} ${field.units}`,field.interpretation,field.derivation,field.reference] })() : []),
    ...manifest.volumes.filter(volume => volume.kind === 'image' && volume.image_evidence).flatMap(volume => { const evidence = volume.image_evidence!; return [`${evidence.modality}: ${evidence.intensity_units} | Source array: ${evidence.source_dataset}`, evidence.acquisition, evidence.sampling, evidence.calibration] }),
    ...(manifest.representation === 'mri-volume' ? [`Image intensity window: ${state.window.join(' to ')} | 3D intensity display ${state.imageContext ? 'enabled' : 'disabled'}`, 'Native image samples and acquired field of view retained. Bright signal and display contrast do not establish vessel identity or anatomical boundaries.'] : []),
    ...(reference.native_frame ? [`Exact source frame: ${reference.native_frame.frame+1} of ${reference.native_frame.source_shape[3]} | Native sampling preserved; no interpolation, averaging or added resolution.`] : []),
    ...(manifest.representation === 'mri-streamlines' ? [
      `Display sampling: ${state.streamlineLevel ?? 'standard'} | 2D section slab: ${state.streamlineSlabMm ?? 1} mm total thickness`,
      'Original source vertices retained; no smoothing or added registration. Display density is not axon count, confidence or probability.',
      ...manifest.structures.filter(s => s.kind === 'streamline-bundle' && state.visible.includes(s.id)).map(s =>
        `${practiceHidden ? 'Visible bundle' : s.name}: ${displayLevel(s as import('./types').StreamlineStructure, state.streamlineLevel).streamline_count} displayed / ${s.streamlines!.source_streamline_count} source trajectories`),
    ] : []),
    ...(state.background2D !== undefined ? [`2D background: ${state.background2D ? Math.round((state.backgroundOpacity2D ?? 1)*100)+'% opacity' : 'hidden'}`] : []),
    ...(state.surfaceContext?.enabled ? [`Same-source brain context: neutral gray, ${Math.round(state.surfaceContext.opacity*100)}% opacity; separate from foreground structures.`] : []),
    ...(Object.keys(state.surfaceOpacity ?? {}).length ? [`Individual 3D opacity multipliers: ${Object.keys(state.surfaceOpacity!).length} source regions | Display settings only`] : []),
    ...(state.surfaceCutaway ? [cutawayDescription(state.surfaceCutaway)] : []),
    ...(state.sectionPlanes?.length ? ['3D section guides: ' + state.sectionPlanes.join(', ') + ' | Schematic planes at the cursor; no tissue or image texture'] : []),
    ...(state.focus3D ? ['3D rotation center RAS mm: ' + state.focus3D.map(value => value.toFixed(1)).join(', ') + ' | View setting only'] : []),
    ...(selected?.probability ? ['2D overlay: ' + (state.overlay === 'probability' ? 'selected source probability channel (' + probabilityScale(selected.probability).join(' to ') + ')' : state.overlay === 'mask' ? (derivedMask ? 'project-derived binary display mask' : 'selected independent source mask') : 'source navigation labels'),
      probabilityNavigationDescription(manifest.build),
      ...(!practiceHidden ? [selected.probability.interpretation, selected.probability.derivation] : ['Source interpretation and derivation accompany this image in provenance.json.'])] : []),
    ...manifest.sources.map(s => s.title + ' · ' + s.version + ' · ' + s.license_name),
    'Package ' + manifest.package_version + ' | Viewer ' + __NEUROIMAGE_VIEWER__.version + ' / ' + __NEUROIMAGE_VIEWER__.build_sha256.slice(0, 12),
    'Full source, license, processing and rendering records accompany this image.',
    ...(!practiceHidden && state.note.trim() ? ['Teaching note: ' + excerpt(state.note, 145)] : []),
    ...(!practiceHidden && state.annotations.length ? ['User teaching markers | ' + (state.showMarkers === false ? 'Markers hidden in this view' : '2D: matching slice; 3D: projected through anatomy'), ...markerLines,
      ...(state.annotations.length > 8 ? ['Additional markers and full note text are included in teaching-notes.txt.'] : ['Full marker text and coordinates are included in teaching-notes.txt.'])] : [])]
  canvas.width = Math.max(image.width, 1000)
  ctx.font = '15px sans-serif'
  const wrapped = lines.flatMap(line => {
    const rows: string[] = []; let current = ''
    for (const word of line.split(/\s+/)) {
      const candidate = current ? current + ' ' + word : word
      if (current && ctx.measureText(candidate).width > canvas.width - 40) { rows.push(current); current = word }
      else current = candidate
    }
    rows.push(current); return rows
  })
  canvas.height = image.height + 32 + wrapped.length * 24
  ctx.fillStyle = '#0b1520'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0)
  ctx.fillStyle = '#cad5df'; ctx.font = '15px sans-serif'
  wrapped.forEach((line, i) => ctx.fillText(line, 20, image.height + 28 + i * 24, canvas.width - 40))
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image export failed.')), 'image/png'))
  const files: Record<string, Uint8Array> = {
    'anatomy.png': new Uint8Array(await blob.arrayBuffer()),
    'scene.json': strToU8(JSON.stringify(makeScene(manifest, state), null, 2)),
    'provenance.json': strToU8(JSON.stringify(manifest, null, 2)),
    'rendering.json': strToU8(JSON.stringify(__NEUROIMAGE_VIEWER__, null, 2)),
    'teaching-notes.txt': strToU8(['NeuroImage user teaching notes', 'Package: ' + manifest.package_id + ' / ' + manifest.package_version, 'Native space: ' + manifest.space.id,
      '', 'Notes are user-authored teaching observations, not source labels or expert-reviewed findings.', '', state.note,
      '', ...state.annotations.flatMap((marker, index) => [`${index + 1}. ${marker.text}`, 'RAS mm: ' + marker.position_ras_mm.join(', '), 'Associated source structure: ' + (marker.structure_id ?? 'none'), 'Marker ID: ' + marker.id, ''])].join('\n')),
    'README.txt': strToU8('NeuroImage teaching export\n\nThe image and scene derive from the independently acquired atlas identified in provenance.json. The source licenses apply to data derivatives. Software is Apache-2.0. Retain attribution, source versions and processing records. No independent expert anatomical review has been performed. This export contains no image volumes or meshes; scene restoration requires the exact matching local atlas package.\n'),
  }
  for (const license of manifest.assets.filter(asset => asset.role === 'license')) {
    const response = await fetch(base + license.path)
    if (!response.ok) throw new Error('A required source license could not be included. Export cancelled.')
    files[license.path] = new Uint8Array(await response.arrayBuffer())
  }
  const zip = zipSync(files, { level: 6 })
  download(zip.buffer as ArrayBuffer, `${manifest.package_id}-teaching-export.zip`, 'application/zip')
}
