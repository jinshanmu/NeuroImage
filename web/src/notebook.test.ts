import { describe, expect, it } from 'vitest'
import { appendNotebookScene, newNotebook, readNotebook, serializeNotebook, NOTEBOOK_SCENE_LIMIT } from './notebook'
import { initialState, makeScene } from './scene'
import type { Manifest } from './types'

const manifest = {
  schema_version: '1.0', package_id: 'synthetic', dataset_id: 'synthetic', package_version: 'v1', title: 'Synthetic test package',
  space: { id: 'native-a', name: 'Native A', coordinate_system: 'RAS', units: 'mm', reference: 'Synthetic', correspondence: 'Synthetic' },
  sources: [], assets: [], lessons_file: 'lessons.json', build: { signature: 'f'.repeat(64), software_version: '0.1.0', parameters: {}, inputs: [] },
  validation: { engineering_status: 'passed', anatomical_review: 'not_performed', report: 'validation.json', warnings: [] },
  volumes: [{ id: 't1', kind: 'image', name: 'Synthetic', file: 't1.nii.gz', shape: [8, 8, 8], affine_ras_mm: [[1,0,0,-4],[0,1,0,-4],[0,0,1,-4],[0,0,0,1]], voxel_size_mm: [1,1,1], orientation: 'RAS', cal_min: 0, cal_max: 100 }],
  structures: [{ id: 'test:11', name: 'Left caudate test', source_name: 'Synthetic', label_value: 11, category: 'Synthetic', laterality: 'left', color: [10,20,30], mesh_file: 'm.gii', voxel_count: 50, volume_mm3: 50, center_ras_mm: [-2,1,0], target_ras_mm: [-2,1,0], bounds_ras_mm: [[-3,0,-1],[-1,2,1]], evidence: 'Synthetic', source_notes: [], review_status: 'not_reviewed' }],
} satisfies Manifest

describe('portable teaching notebooks', () => {
  it('keeps two independent source-bound scenes and their annotations', () => {
    const state = initialState(manifest)
    state.note = 'First source observation'
    const first = makeScene(manifest, state)
    let book = appendNotebookScene(newNotebook(manifest), first, 'First view')
    state.position = [2, 3, 4]; state.note = 'Second observation'; state.radiological = false
    state.annotations = [{id:'location',text:'Saved coordinate',position_ras_mm:[2,3,4],structure_id:'test:11'}]
    book = appendNotebookScene(book, makeScene(manifest, state), 'Second view')
    const restored = readNotebook(JSON.parse(serializeNotebook(book, manifest, [])), manifest)
    expect(restored.scenes.map(entry => entry.title)).toEqual(['First view','Second view'])
    expect(restored.scenes[0].scene.state.position).toEqual([-2,1,0])
    expect(restored.scenes[0].scene.state.note).toBe('First source observation')
    expect(restored.scenes[1].scene.state).toEqual(state)
    first.state.note = 'Changed after capture'
    expect(book.scenes[0].scene.state.note).toBe('First source observation')
  })
  it.each(['package_id','package_version','build_signature','space_id'])('rejects a different notebook %s', key => {
    const book = { ...newNotebook(manifest), [key]: 'different' }
    expect(() => readNotebook(book, manifest)).toThrow('different atlas')
  })
  it('rejects an incompatible or malformed embedded scene without accepting a partial notebook', () => {
    const book = appendNotebookScene(newNotebook(manifest), makeScene(manifest, initialState(manifest)), 'Valid first scene')
    const second = structuredClone(book.scenes[0]); second.id = 'second'; second.scene.space_id = 'unrelated'
    book.scenes.push(second)
    expect(() => readNotebook(book, manifest)).toThrow('different atlas')
    second.scene.space_id = manifest.space.id; second.scene.state.position = [NaN,0,0]
    expect(() => readNotebook(book, manifest)).toThrow('coordinates')
  })
  it('does not import an asserted expert approval or fabricated source declaration', () => {
    const book = appendNotebookScene(newNotebook(manifest), makeScene(manifest, initialState(manifest)), 'Source view')
    const input = { ...book, review_status: 'expert-approved' }
    input.scenes[0].scene.provenance.anatomical_review = 'expert-approved'
    input.scenes[0].scene.provenance.processing = { invented_registration: true }
    const restored = readNotebook(input, manifest)
    expect(restored.review_status).toBe('user-authored-unreviewed')
    expect(restored.scenes[0].scene.provenance.anatomical_review).toBe('not_performed')
    expect(restored.scenes[0].scene.provenance.processing).toEqual(manifest.build)
  })
  it('rejects duplicate entries, invalid text and unsupported formats', () => {
    const book = appendNotebookScene(newNotebook(manifest), makeScene(manifest, initialState(manifest)), 'Source view')
    book.scenes.push(structuredClone(book.scenes[0]))
    expect(() => readNotebook(book, manifest)).toThrow('duplicate')
    book.scenes.pop(); book.title = ' '
    expect(() => readNotebook(book, manifest)).toThrow('title')
    book.title = 'Valid'
    expect(() => readNotebook({...book,schema_version:'9.0'}, manifest)).toThrow('Unsupported')
  })
  it('bounds scene count and refuses cross-space append', () => {
    const scene = makeScene(manifest, initialState(manifest))
    let book = newNotebook(manifest)
    for (let i=0;i<NOTEBOOK_SCENE_LIMIT;i++) book=appendNotebookScene(book,scene,`Scene ${i+1}`)
    expect(() => appendNotebookScene(book,scene,'Extra')).toThrow('already contains')
    scene.space_id='another-space'
    expect(() => appendNotebookScene(newNotebook(manifest),scene,'Wrong space')).toThrow('same atlas')
  })
})
