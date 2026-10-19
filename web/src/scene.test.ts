import { describe, expect, it } from 'vitest'
import { initialState, makeScene, readScene } from './scene'
import { locateSourceStructure } from './navigation'
import type { Lesson, Manifest } from './types'

const manifest = {
  schema_version: '1.0', package_id: 'synthetic', dataset_id: 'synthetic', package_version: 'v1', title: 'Synthetic test package',
  space: { id: 'native-a', name: 'Native A', coordinate_system: 'RAS', units: 'mm', reference: 'Synthetic', correspondence: 'Synthetic' },
  sources: [], assets: [], lessons_file: 'lessons.json', build: { signature: 'f'.repeat(64), software_version: '0.1.0', parameters: {}, inputs: [] },
  validation: { engineering_status: 'passed', anatomical_review: 'not_performed', report: 'validation.json', warnings: [] },
  volumes: [{ id: 't1', kind: 'image', name: 'Synthetic', file: 't1.nii.gz', shape: [8, 8, 8], affine_ras_mm: [[1,0,0,-4],[0,1,0,-4],[0,0,1,-4],[0,0,0,1]], voxel_size_mm: [1,1,1], orientation: 'RAS', cal_min: 0, cal_max: 100 }],
  structures: [{ id: 'test:11', name: 'Left caudate test', source_name: 'Synthetic', label_value: 11, category: 'Synthetic', laterality: 'left', color: [10,20,30], mesh_file: 'm.gii', voxel_count: 50, volume_mm3: 50, center_ras_mm: [-2,1,0], target_ras_mm: [-2,1,0], bounds_ras_mm: [[-3,0,-1],[-1,2,1]], evidence: 'Synthetic', source_notes: [], review_status: 'not_reviewed' }],
} satisfies Manifest

describe('version-bound scenes', () => {
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
  it('round trips equal panels and automatic 3D fitting with the same native point and image framing', () => {
    const state = {...initialState(manifest), layout: 'anatomy' as const, position: [-2, 1, 0] as [number, number, number],
      pan: [0, 0, 0, 1] as [number, number, number, number], focus3D: [-2, 1, 0] as [number, number, number], fitVisible3D: true, camera: [110, 15, 6] as [number, number, number]}
    expect(readScene(makeScene(manifest, state), manifest).state).toEqual(state)
    expect(readScene(makeScene(manifest, {...state, fitVisible3D: false}), manifest).state.fitVisible3D).toBe(false)
    expect(() => readScene(makeScene(manifest, {...state, fitVisible3D: 'true'} as never), manifest)).toThrow('3D fitting')
  })
  it('preserves optional 3D cursor visibility while accepting older scenes', () => {
    const legacy = makeScene(manifest, initialState(manifest))
    expect(readScene(legacy, manifest).state.show3DCursor).toBeUndefined()
    const hidden = makeScene(manifest, {...initialState(manifest), show3DCursor:false})
    expect(readScene(hidden, manifest).state.show3DCursor).toBe(false)
    expect(() => readScene({...hidden, state:{...hidden.state, show3DCursor:'false'}}, manifest)).toThrow('3D cursor')
  })
  it('opens an exact source search target in full sections without changing saved notes or another view', () => {
    const previous = { ...initialState(manifest), note: 'Retained instructor note', visible: [] as string[], pan: [2, 4, 6, 3] as [number, number, number, number], layout: '3d' as const,
      teaching: { lesson_id: 'old', step: 0, practice: true, answer: '', revealed: false }, surfaceCutaway: {axis: 0 as const, side: 1 as const, position_mm: 0, structures: ['test:11']} }
    const state = locateSourceStructure(previous, manifest, 'test:11')
    expect(state.position).toEqual([-2, 1, 0]); expect(state.visible).toEqual(['test:11'])
    expect(state.pan).toEqual([0, 0, 0, 1]); expect(state.layout).toBe('quad')
    expect(state.note).toBe('Retained instructor note'); expect(state.teaching).toBeUndefined(); expect(state.surfaceCutaway).toBeUndefined()
    expect(previous.pan).toEqual([2, 4, 6, 3]); expect(previous.visible).toEqual([])
    expect(() => locateSourceStructure(previous, manifest, 'another-source:11')).toThrow('selected atlas version')
    expect(readScene(makeScene(manifest, state), manifest).state.position).toEqual(state.position)
  })
  it('opens an image-only oblique source without inventing structures or overlays', () => {
    const volume: Manifest = { ...manifest, schema_version: '1.6', representation: 'mri-volume', structures: [],
      volumes: [{ ...manifest.volumes[0], affine_ras_mm: [[-1,.2,0,4],[0,1,.1,-4],[0,0,2,-6],[0,0,0,1]] }] }
    const state = initialState(volume)
    expect(state.selected).toBeNull(); expect(state.visible).toEqual([]); expect(state.overlay).toBe('none')
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
    expect(readScene(makeScene(fields,state),fields).state).toEqual(state)
    expect(()=>readScene(makeScene(fields,{...state,background:'t1'}),fields)).toThrow('background')
    expect(()=>readScene(makeScene(fields,{...state,overlay:'labels'}),fields)).toThrow('label overlay')
  })

  const lessons: Lesson[] = [{ id: 'test-lesson', title: 'Synthetic lesson', objective: 'Exercise state preservation', instruction: 'Generated test content',
    structure_ids: ['test:11'], review_status: 'not_reviewed', sources: [], evidence_limit: 'Synthetic test fixture',
    steps: [{ structure_id: 'test:11', prompt: 'Generated first step', question: 'Synthetic?' }, { structure_id: 'test:11', prompt: 'Generated second step', question: 'Synthetic?' }] }]
  it('preserves lesson step and unrevealed identification work while accepting older scenes', () => {
    const state = initialState(manifest)
    state.panel = 'learn'; state.teaching = { lesson_id: 'test-lesson', step: 1, practice: true, answer: 'An unfinished response', revealed: false }
    expect(readScene(makeScene(manifest, state), manifest, lessons).state).toEqual(state)
    delete state.panel; delete state.teaching
    expect(readScene(makeScene(manifest, state), manifest, lessons).state.teaching).toBeUndefined()
  })
  it.each([{ lesson_id: 'missing' }, { step: -1 }, { step: 2 }, { step: .5 }, { answer: 1 }, { revealed: 'yes' }])('rejects unavailable or malformed teaching context %#', change => {
    const state = initialState(manifest)
    state.teaching = { lesson_id: 'test-lesson', step: 1, practice: true, answer: '', revealed: false, ...change } as typeof state.teaching
    expect(() => readScene(makeScene(manifest, state), manifest, lessons)).toThrow('teaching context')
  })
  it('restores declared categorical models without treating labels as MRI', () => {
    const model: Manifest = { ...manifest, schema_version: '1.1', representation: 'label-model', volumes: [{ ...manifest.volumes[0], id: 'labels', kind: 'labels' }] }
    const state = initialState(model)
    expect(state.background).toBe('labels'); expect(state.labelOpacity).toBe(1)
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
  it('preserves independent evidence, memberships and view centers without categorical labels', () => {
    const { label_value: _value, ...region } = manifest.structures[0]
    const independent: Manifest = { ...manifest, schema_version: '1.4', representation: 'mri-regions', structures: [{ ...region,
      kind: 'independent-region', mask: { volume_id: 'mask-a', source_input: 'mask-a', threshold: .35, threshold_operator: '>=', derivation: 'Generated mask' },
      probability: { volume_id: 'probability-a', source_input: 'probability-a', source_channel: null, interpretation: 'Generated field', derivation: 'Fixture' } }] }
    const state = initialState(independent)
    expect(state.pan).toEqual([0, 0, 0, 1]); expect(state.focus3D).toEqual(state.position)
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
