import { describe, expect, it } from 'vitest'
import { clipSegment, parseTck, resolveStreamlineSelection, segmentDistance } from './streamlines'
import { initialState, makeScene, readScene } from './scene'
import type { Manifest, StreamlineStructure } from './types'

function fixture() {
  const points = [[-10, 0, -2], [-8, 0, 2], [NaN, NaN, NaN], [3, -4, 1], [3, 4, 1], [NaN, NaN, NaN], [Infinity, Infinity, Infinity]]
  const buffer = new ArrayBuffer(1024 + points.length * 12)
  new Uint8Array(buffer).set(new TextEncoder().encode('mrtrix tracks\ncount: 2\ndatatype: Float32LE\nfile: . 1024\nEND\n'))
  const view = new DataView(buffer)
  points.flat().forEach((value, i) => view.setFloat32(1024 + i * 4, value, true))
  return buffer
}

describe('source trajectory display', () => {
  it('retains the first and last streamline, every vertex, and exact boundaries', () => {
    const data = parseTck(fixture(), { streamline_count: 2, point_count: 4 })
    expect(Array.from(data.pts)).toEqual([-10, 0, -2, -8, 0, 2, 3, -4, 1, 3, 4, 1])
    expect(Array.from(data.offsetPt0)).toEqual([0, 2, 4])
    const selection = resolveStreamlineSelection([-9, 0, 0], [['first', { ...data, visible: true }]], null)
    expect(selection.selected).toBe('first')
    expect(segmentDistance([3, 0, 1], [3, -4, 1], [3, 4, 1])).toBe(0)
  })
  it('rejects truncated arrays, incorrect counts and malformed delimiters', () => {
    expect(() => parseTck(fixture().slice(0, -4), { streamline_count: 2, point_count: 4 })).toThrow('Truncated')
    expect(() => parseTck(fixture(), { streamline_count: 3, point_count: 4 })).toThrow('header')
    const data = fixture(); new DataView(data).setFloat32(1024 + 6 * 4, 1, true)
    expect(() => parseTck(data, { streamline_count: 2, point_count: 4 })).toThrow('point')
  })
  it('clips a crossing segment at the physical slab boundaries', () => {
    expect(clipSegment([-10, 0, -2], [-8, 0, 2], 2, 0, 1)).toEqual([[-9.25, 0, -.5], [-8.75, 0, .5]])
    expect(clipSegment([-10, 0, -2], [-8, 0, 2], 2, 10, 1)).toBeNull()
    expect(clipSegment([1, 2, 3], [2, 3, 3], 2, 3, 1)).toEqual([[1, 2, 3], [2, 3, 3]])
  })
  it('retains overlapping candidates without joining separate streamlines', () => {
    const data = parseTck(fixture(), { streamline_count: 2, point_count: 4 })
    const mesh = { ...data, visible: true, opacity: 1 }
    const candidates = resolveStreamlineSelection([-9, 0, 0], [['a', mesh], ['b', mesh], ['hidden', { ...mesh, visible: false }]], 'b', 1, 2, 1)
    expect(candidates.selected).toBe('b'); expect(candidates.selectionEvidence.candidates).toEqual(['a', 'b'])
    expect(candidates.selectionEvidence.sectionAxis).toBe(2)
    expect(resolveStreamlineSelection([-2, -2, 1.5], [['a', mesh]], null).selected).toBeNull()
    expect(resolveStreamlineSelection([-9, 0, 10], [['a', mesh]], null, 1, 2, 1).selected).toBeNull()
    expect(resolveStreamlineSelection([-9, 0, 0], [['a', { ...mesh, opacity: 0 }]], null).selected).toBeNull()
  })
})

const bundle: StreamlineStructure = { kind: 'streamline-bundle', id: 'test:bundle:L', name: 'Synthetic left trajectories', source_name: 'L', category: 'Synthetic',
  laterality: 'left', color: [90, 130, 200], center_ras_mm: [-9, 0, 0], target_ras_mm: [-10, 0, -2], bounds_ras_mm: [[-10, 0, -2], [-8, 0, 2]],
  evidence: 'Synthetic test; not anatomy', source_notes: [], review_status: 'not_reviewed',
  streamlines: { source_input: 'L', coordinate_system: 'RAS', units: 'mm', source_streamline_count: 1, source_point_count: 2, decoded_ras_sha256: 'a'.repeat(64),
    target_streamline_index: 0, target_point_index: 0, sampling: 'uniform-source-index-whole-streamlines',
    levels: ['preview', 'standard', 'detail', 'full'].map(id => ({ id: id as 'standard', file: id + '.tck', streamline_count: 1, point_count: 2 })) } }
const manifest: Manifest = { schema_version: '1.3', representation: 'mri-streamlines', package_id: 'test', dataset_id: 'test', title: 'Synthetic', package_version: 'v1',
  space: { id: 'test', name: 'Test', coordinate_system: 'RAS', units: 'mm', reference: 'Generated', correspondence: 'Generated' },
  sources: [], assets: [], lessons_file: 'lessons.json', structures: [bundle],
  build: { signature: 'b'.repeat(64), software_version: 'test', parameters: {}, inputs: [] }, validation: { engineering_status: 'passed', anatomical_review: 'not_performed', report: 'validation.json', warnings: [] },
  volumes: [{ id: 't1', name: 'Synthetic', kind: 'image', file: 't1.nii.gz', shape: [20, 20, 20], affine_ras_mm: [[1,0,0,-10],[0,1,0,-10],[0,0,1,-10],[0,0,0,1]], voxel_size_mm: [1,1,1], orientation: 'RAS', cal_min: 0, cal_max: 100 }] }

describe('source-bound streamline scenes', () => {
  it('preserves explicit level, slab, cursor, overlap candidates and opacity', () => {
    const state = initialState(manifest)
    expect(state.overlay).toBe('streamlines'); expect(state.streamlineLevel).toBe('standard')
    state.streamlineLevel = 'detail'; state.streamlineSlabMm = 2.4; state.surfaceOpacity = { [bundle.id]: .3 }
    state.selectionEvidence = { kind: 'visible-streamline', candidates: [bundle.id], sectionAxis: 1 }
    expect(readScene(makeScene(manifest, state), manifest).state).toEqual(state)
  })
  it('rejects a selection section outside the three physical axes', () => {
    const scene = makeScene(manifest, initialState(manifest))
    Object.assign(scene.state, { selectionEvidence: { kind: 'visible-streamline', candidates: [bundle.id], sectionAxis: 3 } })
    expect(() => readScene(scene, manifest)).toThrow('selection section')
  })
  it.each([{ streamlineLevel: 'full' }, { streamlineSlabMm: Infinity }, { streamlineSlabMm: 0 }, { streamlineSlabMm: 20 }, { overlay: 'labels' }])('rejects unsupported streamline settings %#', change => {
    const scene = makeScene(manifest, initialState(manifest)); Object.assign(scene.state, change)
    expect(() => readScene(scene, manifest)).toThrow('streamline display')
  })
})
