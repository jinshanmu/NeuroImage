import { describe, expect, it } from 'vitest'
import { initialState, makeScene, readScene } from './scene'
import { locateSourceStructure } from './navigation'
import { atlasDisplayView, radiologicalView } from './display'
import type { Manifest, ViewState } from './types'

const manifest = {
  schema_version: '1.0', package_id: 'synthetic', dataset_id: 'synthetic', package_version: 'v1', title: 'Synthetic test package',
  space: { id: 'native-a', name: 'Native A', coordinate_system: 'RAS', units: 'mm', reference: 'Synthetic', correspondence: 'Synthetic' },
  sources: [], assets: [], lessons_file: 'lessons.json', build: { signature: 'f'.repeat(64), software_version: '0.1.0', parameters: {}, inputs: [] },
  validation: { engineering_status: 'passed', anatomical_review: 'not_performed', report: 'validation.json', warnings: [] },
  volumes: [{ id: 't1', kind: 'image', name: 'Synthetic', file: 't1.nii.gz', shape: [8, 8, 8], affine_ras_mm: [[1,0,0,-4],[0,1,0,-4],[0,0,1,-4],[0,0,0,1]], voxel_size_mm: [1,1,1], orientation: 'RAS', cal_min: 0, cal_max: 100 }],
  structures: [{ id: 'test:11', name: 'Left caudate test', source_name: 'Synthetic', label_value: 11, category: 'Synthetic', laterality: 'left', color: [10,20,30], mesh_file: 'm.gii', voxel_count: 50, volume_mm3: 50, center_ras_mm: [-2,1,0], target_ras_mm: [-2,1,0], bounds_ras_mm: [[-3,0,-1],[-1,2,1]], evidence: 'Synthetic', source_notes: [], review_status: 'not_reviewed' }],
} satisfies Manifest

describe('version-bound scenes', () => {
  it.each([undefined, 'mri-labels', 'ct-labels'] as const)('starts %s label and structure opacity at fifty percent', representation => {
    const source: Manifest = { ...manifest, representation }
    const state = initialState(source)
    expect(state.labelOpacity).toBe(.5)
    expect(state.meshOpacity).toBe(.5)
    expect(state.overlay).toBe('labels')
    expect(state.backgroundOpacity2D).toBe(1)
    expect(state.selected).toBe(manifest.structures[0].id)
    expect(state.position).toEqual(manifest.structures[0].target_ras_mm)
    expect(readScene(makeScene(source, state), source).state).toEqual(state)
    if (representation === 'ct-labels') expect(state.showCursor).toBe(false)
  })

  it('retains the opacity recorded in historical scenes when defaults change', () => {
    const historical = makeScene(manifest, { ...initialState(manifest), labelOpacity: .45, meshOpacity: 1 })
    const saved = JSON.stringify(historical)
    const restored = readScene(JSON.parse(saved), manifest)
    expect(restored.state.labelOpacity).toBe(.45)
    expect(restored.state.meshOpacity).toBe(1)
    expect(JSON.stringify(historical)).toBe(saved)
  })

  it('starts streamline opacity at fifty percent without changing its overlay or source selection', () => {
    const { label_value: _label, mesh_file: _mesh, voxel_count: _voxels, volume_mm3: _volume, ...geometry } = manifest.structures[0]
    const source: Manifest = { ...manifest, schema_version: '1.3', representation: 'mri-streamlines', structures: [{ ...geometry,
      kind: 'streamline-bundle', streamlines: { source_input: 'source.tck', coordinate_system: 'RAS', units: 'mm',
        source_streamline_count: 1, source_point_count: 2, decoded_ras_sha256: 'a'.repeat(64),
        target_streamline_index: 0, target_point_index: 0, sampling: 'uniform-source-index-whole-streamlines',
        levels: [{ id: 'standard', file: 'source.tck', streamline_count: 1, point_count: 2 }] } }] }
    const state = initialState(source)
    expect(state.labelOpacity).toBe(.5)
    expect(state.meshOpacity).toBe(.5)
    expect(state.overlay).toBe('streamlines')
    expect(state.selected).toBe(geometry.id)
    expect(state.streamlineLevel).toBe('standard')
    expect(readScene(makeScene(source, state), source).state).toEqual(state)
  })

  it('starts both magnification controls at one without changing the raw camera compatibility field', () => {
    const state = initialState(manifest)
    expect(state.pan[3]).toBe(1)
    expect(state.zoom3D).toBe(1)
    expect(state.camera).toEqual([110, 15, 2])
    expect(readScene(makeScene(manifest, state), manifest).state).toEqual(state)
  })

  it('round trips explicit relative zoom while preserving legacy raw camera limits', () => {
    const state: ViewState = { ...initialState(manifest), zoom3D: 10, camera: [110, 15, 200] }
    const scene = makeScene(manifest, state), before = JSON.stringify(scene)
    expect(readScene(scene, manifest).state).toEqual(state)
    expect(JSON.stringify(scene)).toBe(before)
    delete state.zoom3D
    expect(() => readScene(makeScene(manifest, state), manifest)).toThrow('camera')
    for (const scale of [.1, 20]) {
      state.camera[2] = scale
      const historical = makeScene(manifest, state), saved = JSON.stringify(historical)
      expect(readScene(historical, manifest).state).toEqual(state)
      expect(readScene(historical, manifest).state.zoom3D).toBeUndefined()
      expect(JSON.stringify(historical)).toBe(saved)
    }
  })

  it.each([0, .9, 10.1, 1.05, NaN, Infinity, '2', null])('rejects invalid explicit relative 3D zoom %s', zoom3D => {
    const scene = makeScene(manifest, initialState(manifest))
    Object.assign(scene.state, { zoom3D })
    expect(() => readScene(scene, manifest)).toThrow('3D zoom')
  })

  it('opens historical neurological scenes radiologically without changing stored settings or physical state', () => {
    const historical = makeScene(manifest, { ...initialState(manifest), radiological: false,
      position: [-2.5, 1.5, 3.5], camera: [48, -12, 2], pan: [1, 2, 3, 1.4],
      selected: 'test:11', visible: ['test:11'], note: 'Historical source observation' })
    const saved = JSON.stringify(historical)
    const restored = readScene(JSON.parse(saved), manifest)
    const displayed = radiologicalView(restored.state)
    expect(displayed.radiological).toBe(true)
    expect({ ...displayed, radiological: false }).toEqual(restored.state)
    expect(restored.state.radiological).toBe(false)
    expect(JSON.stringify(historical)).toBe(saved)
  })

  it('initially selects the first source group member ahead of caudate names and preferred subjects', () => {
    const source: Manifest = {...manifest, structures: [
      {...manifest.structures[0],id:'test:first',name:'First source region',target_ras_mm:[1.125,-2.5,3.75]},
      manifest.structures[0],
      {...manifest.structures[0],id:'test:subject',name:'Source nucleus',target_ras_mm:[4,5,6]}]}
    const scope = {id:'detail-subject',title:'Subject',structure_ids:['test:subject','test:11','test:first'],primary_structure_ids:['test:subject']}
    const state = initialState(source,scope)
    expect(state.visible).toEqual(['test:first','test:11','test:subject'])
    expect(state.selected).toBe('test:first')
    expect(state.position).toEqual([1.125,-2.5,3.75])
    expect(state.selectionEvidence?.candidates).toEqual(['test:first'])
    expect(initialState(source).selected).toBe('test:first')
    expect(initialState(source).position).toEqual(source.structures[0].target_ras_mm)
    const saved = {...state,selected:'test:11'}
    expect(readScene(makeScene(source,saved),source).state.selected).toBe('test:11')
  })
  it.each(['ventricles', 'detail-ventricular-system'])('opens every declared structure in %s and retains exact whole-brain scope membership', id => {
    const source: Manifest = { ...manifest, structures: Array.from({ length: 24 }, (_, i) => ({
      ...manifest.structures[0], id: `test:${i}`, name: `Source region ${i}`, label_value: i + 1,
    })) }
    const scope = {id,title:'Ventricles',structure_ids:source.structures.slice(3,21).map(s=>s.id)}
    const state = initialState(source, scope)
    expect(state.visible).toEqual(scope.structure_ids)
    expect(state.selected).toBe('test:3')
    expect(state.background2D).toBe(true)
    expect(state.backgroundOpacity2D).toBe(1)
    expect(state.imageContext).toBe(false)
    expect(state.surfaceContext?.enabled ?? false).toBe(false)
    expect(initialState(source, {...scope,id:'general-anatomy'}).visible).toEqual(scope.structure_ids)
    expect(initialState(source, {...scope,structure_ids:[]}).visible).toEqual(source.structures.map(structure=>structure.id))
  })
  it('starts a whole-brain scope with only its source members and selects its first source object', () => {
    const source: Manifest = { ...manifest, structures: [manifest.structures[0],
      { ...manifest.structures[0], id: 'test:context', name: 'Source brain context' },
      { ...manifest.structures[0], id: 'test:subject', name: 'Source nucleus', target_ras_mm: [1,2,3] }] }
    const scope = { id: 'general-anatomy', title: 'Whole brain',
      structure_ids: ['test:subject', 'missing', 'test:context', 'test:subject'], primary_structure_ids: ['test:subject', 'test:11'] }
    const state = initialState(source, scope)
    expect(state.visible).toEqual(['test:context', 'test:subject'])
    expect(state.selected).toBe('test:context')
    expect(state.visible).toContain(state.selected)
    expect(state.position).toEqual(source.structures[1].target_ras_mm)
    expect(state.selectionEvidence?.candidates).toEqual(['test:context'])
    const saved = makeScene(source, { ...state, selected: 'test:11', visible: ['test:11'], note: 'Explicit source observation' })
    const before = JSON.stringify(saved)
    expect(readScene(saved, source).state.visible).toEqual(['test:11'])
    expect(readScene(saved, source).state.selected).toBe('test:11')
    expect(JSON.stringify(saved)).toBe(before)
    const unavailable = initialState(source, { ...scope, structure_ids: ['missing'] })
    expect(unavailable.visible).toEqual([])
    expect(unavailable.selected).toBeNull()
    expect(unavailable.selectionEvidence?.candidates).toEqual([])
  })
  it('round trips independent background settings and validates source-bound context', () => {
    const state = {...initialState(manifest), background2D:false, backgroundOpacity2D:.4, backgroundOpacity3D:.15,
      surfaceContext:{enabled:true,opacity:.25,structure_ids:['test:11']}}
    expect(readScene(makeScene(manifest,state),manifest).state).toEqual(state)
    for (const change of [{background2D:'yes'},{backgroundOpacity2D:-.1},{backgroundOpacity3D:NaN},
      {surfaceContext:{enabled:true,opacity:1.1,structure_ids:['test:11']}},
      {surfaceContext:{enabled:true,opacity:.2,structure_ids:['other']}}]) {
      expect(()=>readScene(makeScene(manifest,{...state,...change} as never),manifest)).toThrow('background')
    }
  })
  it('opens every source structure and preserves an explicitly saved subset', () => {
    const source: Manifest = { ...manifest, structures: Array.from({ length: 16 }, (_, i) => ({
      ...manifest.structures[0], id: `test:${i}`, name: `Source region ${i}`, label_value: i + 1,
    })) }
    const state = initialState(source)
    expect(state.visible).toEqual(source.structures.map(s => s.id))
    expect(state.fitVisible3D).toBe(true)
    expect(readScene(makeScene(source, { ...state, visible: ['test:4'] }), source).state.visible).toEqual(['test:4'])
    expect(readScene(makeScene(source, { ...state, visible: [] }), source).state.visible).toEqual([])
  })
  it('preserves responsive or explicit panel layouts while retaining legacy grids', () => {
    const state = initialState(manifest)
    expect(state.tileLayout).toBe('auto')
    expect(readScene(makeScene(manifest, {...state, tileLayout:'row'}), manifest).state.tileLayout).toBe('row')
    delete state.tileLayout
    expect(readScene(makeScene(manifest, state), manifest).state.tileLayout).toBeUndefined()
    expect(() => readScene(makeScene(manifest, {...state, tileLayout:'invalid'} as never), manifest)).toThrow('panel layout')
  })
  it('retains historical equal-panel scenes and their recorded 3D fitting settings', () => {
    const state = {...initialState(manifest), layout: 'anatomy' as const, position: [-2, 1, 0] as [number, number, number],
      pan: [0, 0, 0, 1] as [number, number, number, number], focus3D: [-2, 1, 0] as [number, number, number], fitVisible3D: true, camera: [110, 15, 6] as [number, number, number]}
    expect(readScene(makeScene(manifest, state), manifest).state).toEqual(state)
    expect(readScene(makeScene(manifest, {...state, fitVisible3D: false}), manifest).state.fitVisible3D).toBe(false)
    expect(() => readScene(makeScene(manifest, {...state, fitVisible3D: 'true'} as never), manifest)).toThrow('3D fitting')
  })
  it.each([undefined, true, false])('adapts historical equal panels with fitting %s without rewriting their source scene', fitVisible3D => {
    const historical = makeScene(manifest, { ...initialState(manifest), layout: 'anatomy', tileLayout: 'grid',
      radiological: false, fitVisible3D, position: [-2.5, 1.5, 3.5], camera: [48, -12, 2], pan: [1, 2, 3, 1.4],
      selected: 'test:11', visible: ['test:11'], note: 'Historical native source observation' })
    const saved = JSON.stringify(historical)
    const restored = readScene(JSON.parse(saved), manifest)
    const before = JSON.stringify(restored)
    const displayed = atlasDisplayView(restored.state)
    expect(displayed).toEqual({ ...restored.state, radiological: true, layout: 'quad', tileLayout: 'row',
      fitVisible3D: fitVisible3D ?? true })
    expect(restored.state.layout).toBe('anatomy')
    expect(restored.state.radiological).toBe(false)
    expect(JSON.stringify(restored)).toBe(before)
    expect(JSON.stringify(historical)).toBe(saved)
  })
  it.each(['auto', 'grid', 'row'] as const)('preserves the current quad panel arrangement %s', tileLayout => {
    const state = { ...initialState(manifest), tileLayout }
    expect(atlasDisplayView(state)).toBe(state)
    expect(atlasDisplayView(state).tileLayout).toBe(tileLayout)
  })
  it('preserves optional 3D cursor visibility while accepting older scenes', () => {
    const legacy = makeScene(manifest, initialState(manifest))
    expect(readScene(legacy, manifest).state.show3DCursor).toBeUndefined()
    const hidden = makeScene(manifest, {...initialState(manifest), show3DCursor:false})
    expect(readScene(hidden, manifest).state.show3DCursor).toBe(false)
    expect(() => readScene({...hidden, state:{...hidden.state, show3DCursor:'false'}}, manifest)).toThrow('3D cursor')
  })
  it('round trips synchronized cursor visibility without rewriting legacy fields', () => {
    const state = {...initialState(manifest), showCursor: true, show3DCursor: false}
    const scene = makeScene(manifest, state), before = JSON.stringify(scene)
    expect(readScene(scene, manifest).state).toEqual(state)
    expect(JSON.stringify(scene)).toBe(before)
    const hidden = makeScene(manifest, {...state, showCursor: false})
    expect(readScene(hidden, manifest).state.showCursor).toBe(false)
    expect(() => readScene({...hidden, state:{...hidden.state, showCursor:'false'}}, manifest)).toThrow('cursor visibility')
  })
  it('opens an exact source search target in full sections without changing saved notes or another view', () => {
    const previous = { ...initialState(manifest), zoom3D: 10, note: 'Retained instructor note', visible: [] as string[], pan: [2, 4, 6, 3] as [number, number, number, number], layout: '3d' as const,
      surfaceCutaway: {axis: 0 as const, side: 1 as const, position_mm: 0, structures: ['test:11']} }
    const state = locateSourceStructure(previous, manifest, 'test:11')
    expect(state.position).toEqual([-2, 1, 0]); expect(state.visible).toEqual(['test:11'])
    expect(state.pan).toEqual([0, 0, 0, 1]); expect(state.layout).toBe('quad')
    expect(state.zoom3D).toBe(1); expect(previous.zoom3D).toBe(10)
    expect(state.note).toBe('Retained instructor note'); expect(state.surfaceCutaway).toBeUndefined()
    expect(previous.pan).toEqual([2, 4, 6, 3]); expect(previous.visible).toEqual([])
    expect(() => locateSourceStructure(previous, manifest, 'another-source:11')).toThrow('selected atlas version')
    expect(readScene(makeScene(manifest, state), manifest).state.position).toEqual(state.position)
  })
  it('opens an image-only oblique source without inventing structures or overlays', () => {
    const volume: Manifest = { ...manifest, schema_version: '1.6', representation: 'mri-volume', structures: [],
      volumes: [{ ...manifest.volumes[0], affine_ras_mm: [[-1,.2,0,4],[0,1,.1,-4],[0,0,2,-6],[0,0,0,1]] }] }
    const state = initialState(volume)
    expect(state.zoom3D).toBe(1); expect(state.pan[3]).toBe(1)
    expect(state.selected).toBeNull(); expect(state.visible).toEqual([]); expect(state.overlay).toBe('none')
    expect(state.labelOpacity).toBe(0); expect(state.meshOpacity).toBe(.5)
    expect(state.position[0]).toBeCloseTo(1.2); expect(state.position[1]).toBeCloseTo(-.15); expect(state.position[2]).toBe(1)
    expect(readScene(makeScene(volume, state), volume).state).toEqual(state)
    expect(() => readScene(makeScene(volume, { ...state, overlay: 'labels' }), volume)).toThrow('label overlay')
    expect(() => readScene(makeScene(volume, { ...state, selected: 'invented-vessel' }), volume)).toThrow('unknown')
  })
  it('restores a scalar field and its display scale without allowing MRI or label backgrounds', () => {
    const fields: Manifest = {...manifest, schema_version:'1.8',representation:'scalar-fields',structures:[],volumes:[
      {...manifest.volumes[0],id:'mean',kind:'scalar',cal_min:0,cal_max:.3,scalar:{source_input:'mean',metric:'Synthetic fraction',units:'fraction',statistic:'Mean',interpretation:'Generated fixture',derivation:'Generated',reference:'Fixture'}}]}
    const state=initialState(fields)
    expect(state.background).toBe('mean');expect(state.window).toEqual([0,.3]);expect(state.visible).toEqual([])
    expect(state.overlay).toBe('none');expect(state.labelOpacity).toBe(0);expect(state.meshOpacity).toBe(.5)
    expect(readScene(makeScene(fields,state),fields).state).toEqual(state)
    expect(()=>readScene(makeScene(fields,{...state,background:'t1'}),fields)).toThrow('background')
    expect(()=>readScene(makeScene(fields,{...state,overlay:'labels'}),fields)).toThrow('label overlay')
  })

  it('opens historical learning scenes as ordinary anatomy without losing native display state', () => {
    const state = {...initialState(manifest), visible: [], note: 'Preserved observation'}
    const old = {...makeScene(manifest, state), state: {...state, panel: 'learn',
      teaching: {lesson_id: 'retired-lesson', step: 5, practice: true, answer: 'Old response', revealed: false}}}
    const restored = readScene(old, manifest)
    expect(restored.state).toEqual(state)
    expect(old.state.teaching.answer).toBe('Old response')
    expect(restored.state).not.toHaveProperty('teaching')
    expect(restored.state).not.toHaveProperty('panel')
  })
  it('restores declared categorical models without treating labels as MRI', () => {
    const model: Manifest = { ...manifest, schema_version: '1.1', representation: 'label-model', volumes: [{ ...manifest.volumes[0], id: 'labels', kind: 'labels' }] }
    const state = initialState(model)
    expect(state.background).toBe('labels'); expect(state.labelOpacity).toBe(.5); expect(state.meshOpacity).toBe(.5)
    expect(readScene(makeScene(model, state), model).state).toEqual(state)
    expect(() => readScene(makeScene(model, { ...state, background: 't1' }), model)).toThrow('background')
    expect(() => readScene(makeScene(model, { ...state, imageContext: true }), model)).toThrow('background')
  })
  it('preserves source probability viewing and rejects unsupported overlays', () => {
    const probabilistic: Manifest = { ...manifest, schema_version: '1.2', structures: [{ ...manifest.structures[0],
      probability: { volume_id: 'probability-0', source_input: 'probabilities', source_channel: 0, interpretation: 'Synthetic support', derivation: 'Generated fixture' } }] }
    const state = initialState(probabilistic)
    expect(state.overlay).toBe('probability')
    state.selectionEvidence = { kind: 'probability-cursor', candidates: [state.selected!] }
    expect(readScene(makeScene(probabilistic, state), probabilistic).state).toEqual(state)
    expect(() => readScene(makeScene(manifest, state), manifest)).toThrow('probability overlay')
    const malformed = makeScene(probabilistic, state)
    Object.assign(malformed.state, { overlay: 'unknown' })
    expect(() => readScene(malformed, probabilistic)).toThrow('probability overlay')
  })
  it('round trips actual display state, camera, position and annotations', () => {
    const state = initialState(manifest)
    state.position = [-1.5, 2.5, 3.5]; state.camera = [48, -12, 2]; state.pan = [1, 2, 3, 1.4]
    state.focus3D = [-1.5, 2.5, 3.5]
    state.note = 'Source comparison'; state.annotations = [{ id: 'a', text: 'Observe this location', position_ras_mm: [-2, 1, 0], structure_id: 'test:11' }]
    state.visible = []; state.radiological = false; state.meshOpacity = .3; state.showMarkers = false
    state.surfaceOpacity = { 'test:11': .25 }
    state.surfaceCutaway = { axis: 1, side: -1, position_mm: -8.75, structures: ['test:11'] }
    state.sectionPlanes = ['sagittal', 'axial']
    state.selectionEvidence = { kind: 'teaching-marker', candidates: ['test:11'] }
    const restored = readScene(JSON.parse(JSON.stringify(makeScene(manifest, state))), manifest)
    expect(restored.state).toEqual(state)
    expect(restored.provenance.anatomical_review).toBe('not_performed')
  })
  it.each([true, false])('round trips the optional cursor-following cutaway state: %s', followCursor => {
    const state = initialState(manifest)
    state.surfaceCutaway = { axis: 1, side: -1, position_mm: state.position[1], structures: ['test:11'], followCursor }
    expect(readScene(JSON.parse(JSON.stringify(makeScene(manifest, state))), manifest).state).toEqual(state)
  })
  it('preserves independent evidence, memberships and view centers without categorical labels', () => {
    const { label_value: _value, ...region } = manifest.structures[0]
    const independent: Manifest = { ...manifest, schema_version: '1.4', representation: 'mri-regions', structures: [{ ...region,
      kind: 'independent-region', mask: { volume_id: 'mask-a', source_input: 'mask-a', threshold: .35, threshold_operator: '>=', derivation: 'Generated mask' },
      probability: { volume_id: 'probability-a', source_input: 'probability-a', source_channel: null, interpretation: 'Generated field', derivation: 'Fixture' } }] }
    const state = initialState(independent)
    expect(state.pan).toEqual([0, 0, 0, 1]); expect(state.focus3D).toEqual(state.position)
    expect(state.labelOpacity).toBe(.5); expect(state.meshOpacity).toBe(.5); expect(state.overlay).toBe('probability')
    state.overlay = 'mask'; state.selectionEvidence = { kind: 'independent-mask', candidates: [region.id] }
    expect(readScene(makeScene(independent, state), independent).state).toEqual(state)
    expect(() => readScene(makeScene(independent, { ...state, overlay: 'labels' }), independent)).toThrow('overlay')
    expect(() => readScene(makeScene(independent, { ...state, overlay: undefined }), independent)).toThrow('explicit evidence')
    expect(() => readScene(makeScene(independent, { ...state, focus3D: [NaN, 0, 0] }), independent)).toThrow('3D focus')
  })
  it.each(['package_id', 'package_version', 'build_signature', 'space_id'])('rejects mismatched %s', key => {
    const scene = makeScene(manifest, initialState(manifest))
    const changed = { ...scene, [key]: 'another-source' }
    expect(() => readScene(changed, manifest)).toThrow('different atlas')
  })
  it.each([{ visible: ['unknown'] }, { selected: 'unknown' }, { visible: ['test:11','test:11'] }, { position: [NaN,0,0] }, { camera: [0,0,0] }, { labelOpacity: 10 }, { annotations: [{text: 'bad'}] }, { window: [100,0] }, { layout: 'unsupported' }, { showMarkers: 'yes' }])('rejects malformed view state %#', change => {
    const scene = makeScene(manifest, initialState(manifest)); Object.assign(scene.state, change)
    expect(() => readScene(scene, manifest)).toThrow()
  })
  it('keeps saved scenes independent of subsequent UI changes', () => {
    const state = initialState(manifest), scene = makeScene(manifest, state)
    state.position[0] = 100; state.visible.length = 0
    expect(scene.state.position[0]).toBe(-2)
    expect(scene.state.visible).toContain('test:11')
  })
  it.each([null, [], 'opaque', { unknown: .5 }, { 'test:11': -1 }, { 'test:11': 1.1 }, { 'test:11': NaN }, { 'test:11': '0.5' }])('rejects invalid per-structure opacity %#', opacity => {
    const scene = makeScene(manifest, initialState(manifest))
    Object.assign(scene.state, { surfaceOpacity: opacity })
    expect(() => readScene(scene, manifest)).toThrow('surface opacity')
  })
  it.each([null, 'axial', ['axial', 'axial'], ['oblique'], [1]])('rejects invalid section guides %#', guides => {
    const scene = makeScene(manifest, initialState(manifest))
    Object.assign(scene.state, { sectionPlanes: guides })
    expect(() => readScene(scene, manifest)).toThrow('section guides')
  })
})
