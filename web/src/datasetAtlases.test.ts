import { describe, expect, it } from 'vitest'
import { browseTargets } from './anatomyNavigation'
import type { BrowseTarget } from './anatomyNavigation'
import { datasetAtlasCases } from './datasetAtlases'
import type { SourceInfo } from './useAnatomyLibrary'

const source = (id: string, title: string, datasetInfo?: SourceInfo['dataset_info']): SourceInfo =>
  ({id, title, sources: [], ...(datasetInfo ? {dataset_info: datasetInfo} : {})})

const info = (caseId: string | null, caseLabel: string | null, atlasLabel: string): NonNullable<SourceInfo['dataset_info']> => ({
  description: [], scope_notes: [], space: {name: 'Original source space', correspondence: 'Source-defined coordinates'},
  representation: 'mri-labels', case_id: caseId, case_label: caseLabel, atlas_label: atlasLabel,
})

const target = (datasetId: string, key = datasetId + '-exact-version', change: Partial<BrowseTarget> = {}): BrowseTarget => ({
  dataset_id: datasetId, key, title: datasetId, package_version: 'exact-version', active: false, ...change,
})

describe('datasetAtlasCases', () => {
  it('offers a single complete atlas without requiring case metadata', () => {
    const member = source('mida', 'MIDA')
    const atlas = target(member.id)
    expect(datasetAtlasCases([member], [atlas])).toEqual([
      {id: 'complete', title: 'Complete atlas', entries: [{source: member, target: atlas, label: 'MIDA'}]},
    ])
  })

  it('groups THU volunteers by their actual case identity and preserves a single case label', () => {
    const case009 = source('thu_mra_case009', 'THU MRA', info('case009', 'Volunteer 009', 'MRA volume'))
    const case030 = source('thu_mra_case030', 'THU MRA', info('case030', 'Volunteer 030', 'MRA volume'))
    const cases = datasetAtlasCases([case009, case030], [target(case030.id), target(case009.id)])
    expect(cases.map(group => [group.id, group.title, group.entries.map(entry => entry.source.id)])).toEqual([
      ['case009', 'Volunteer 009', ['thu_mra_case009']],
      ['case030', 'Volunteer 030', ['thu_mra_case030']],
    ])
    expect(datasetAtlasCases([case009], [target(case009.id)])[0].title).toBe('Volunteer 009')
  })

  it('keeps HCP configurations in one case group with separate exact packages and spaces', () => {
    const tracts = source('hcp1065_tracts', 'HCP1065', info(null, null, 'Tractography'))
    const probabilities = source('hcp1065_prob', 'HCP1065', {
      ...info(null, null, 'Probabilities'), space: {name: 'Probability template', correspondence: 'Native probability grid'},
    })
    const tractAtlas = target(tracts.id, 'tracts-unchanged-key', {representation: 'mri-streamlines'})
    const probabilityAtlas = target(probabilities.id, 'probability-unchanged-key', {representation: 'mri-probability'})
    const cases = datasetAtlasCases([tracts, probabilities], [tractAtlas, probabilityAtlas])
    expect(cases).toHaveLength(1)
    expect(cases[0].entries.map(entry => [entry.label, entry.target?.key])).toEqual([
      ['Tractography', 'tracts-unchanged-key'], ['Probabilities', 'probability-unchanged-key'],
    ])
    expect(cases[0].entries[0].source).toBe(tracts)
    expect(cases[0].entries[1].source).toBe(probabilities)
    expect(cases[0].entries[0].source.dataset_info?.space).not.toEqual(cases[0].entries[1].source.dataset_info?.space)
  })

  it('uses only the latest complete package per recipe and prefers an active package on equal dates', () => {
    const member = source('source', 'Source')
    const targets = browseTargets([], [
      {key: 'old-key', dataset_id: member.id, title: 'Old package', package_version: 'old', status: 'available', created_utc: '2026-01-01'},
      {key: 'current-key', dataset_id: member.id, title: 'Current package', package_version: 'current', status: 'available', created_utc: '2026-02-01'},
      {key: 'incomplete-key', dataset_id: member.id, title: 'Incomplete package', package_version: 'partial', status: 'incomplete', created_utc: '2026-03-01'},
    ])
    const active = target(member.id, 'active-exact-key', {created_utc: '2026-02-01', active: true})
    const newer = target(member.id, 'newer-exact-key', {created_utc: '2026-04-01'})
    expect(datasetAtlasCases([member], [...targets, active])[0].entries[0].target).toBe(active)
    expect(datasetAtlasCases([member], [active, ...targets, newer])[0].entries[0].target).toBe(newer)
    expect(datasetAtlasCases([member], [...targets].reverse())[0].entries[0].target?.key).toBe('current-key')
  })

  it('prefers an active package when both creation dates are absent', () => {
    const member = source('source', 'Source')
    const active = target(member.id, 'active-key', {active: true})
    const stored = target(member.id, 'stored-key', {created_utc: ''})
    expect(datasetAtlasCases([member], [stored, active])[0].entries[0].target).toBe(active)
    expect(datasetAtlasCases([member], [active, stored])[0].entries[0].target).toBe(active)
  })

  it('opens image-only and uncovered packages without an anatomical scope gate', () => {
    const member = source('synthetic_native_mri', 'Unlabelled image fixture', info(null, null, 'Native MRI'))
    const imageOnly = target(member.id, 'native-mri-exact-key', {representation: 'mri-volume', coverage: [], detail_coverage: []})
    const entry = datasetAtlasCases([member], [imageOnly])[0].entries[0]
    expect(entry.target).toBe(imageOnly)
    expect(entry.target?.key).toBe('native-mri-exact-key')
    expect(entry.label).toBe('Native MRI')
    expect(entry).not.toHaveProperty('scope')
  })

  it('retains an unbuilt recipe as an entry for acquisition and construction', () => {
    const member = source('not_built', 'Original source', info('case1', 'Specimen 1', 'Source atlas'))
    expect(datasetAtlasCases([member], [])).toEqual([
      {id: 'case1', title: 'Specimen 1', entries: [{source: member, target: undefined, label: 'Source atlas'}]},
    ])
  })

  it('does not add unrelated sources or duplicate a member from historical packages', () => {
    const member = source('selected', 'Selected source')
    const unrelated = target('unrelated', 'unrelated-newer-key', {created_utc: '2026-12-01'})
    const cases = datasetAtlasCases([member, member], [unrelated, target(member.id, 'selected-key')])
    expect(cases).toHaveLength(1)
    expect(cases[0].entries).toHaveLength(1)
    expect(cases[0].entries[0].target?.key).toBe('selected-key')
    expect(datasetAtlasCases([], [unrelated])).toEqual([])
  })
})
