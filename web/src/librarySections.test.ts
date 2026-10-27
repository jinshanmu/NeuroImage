import { describe, expect, it } from 'vitest'
import type { AnatomyScope } from './anatomyNavigation'
import type { SurfaceContext } from './types'
import { brainBackgroundIds, reserveBrainBackground } from './atlasBackground'
import { ALL_STRUCTURES, BACKGROUND_STRUCTURES, CURRENT_GROUP, categorySection, librarySectionStructures } from './librarySections'

const structures = [
  { id: 'right-cortex', category: 'Cerebral cortex', name: 'Right cortex' },
  { id: 'left-cortex', category: 'Cerebral cortex', name: 'Left cortex' },
  { id: 'brainstem', category: 'Brainstem', name: 'Brainstem' },
  { id: 'cerebellum', category: 'Cerebellum', name: 'Cerebellum' },
  { id: 'skull', category: 'Bone', name: 'Skull' },
]
const scope: AnatomyScope = {
  id: 'cerebral-cortex', title: 'Cerebral cortex',
  structure_ids: ['left-cortex', 'right-cortex', 'missing', 'left-cortex'],
  primary_structure_ids: ['left-cortex'],
}
const background = ['cerebellum', 'right-cortex', 'missing', 'brainstem', 'brainstem'] as const
const ids = (items: { id: string }[]) => items.map(item => item.id)

describe('source structure-library sections', () => {
  it('keeps every exact group member in manifest order, including non-primary and whole-brain members', () => {
    expect(ids(librarySectionStructures(structures, scope, background, CURRENT_GROUP))).toEqual(['right-cortex', 'left-cortex'])
    const wholeBrain = { ...scope, id: 'general-anatomy', structure_ids: ['cerebellum', 'brainstem'] }
    expect(ids(librarySectionStructures(structures, wholeBrain, background, CURRENT_GROUP))).toEqual(['brainstem', 'cerebellum'])
    expect(librarySectionStructures(structures, { ...scope, structure_ids: ['unavailable'] }, background, CURRENT_GROUP)).toEqual([])
  })

  it('lists only available background anatomy outside the current group without duplicates', () => {
    const result = librarySectionStructures(structures, scope, background, BACKGROUND_STRUCTURES)
    expect(ids(result)).toEqual(['brainstem', 'cerebellum'])
    expect(result[0]).toBe(structures[2])
    expect(result[1]).toBe(structures[3])
    expect(librarySectionStructures(structures, scope, [], BACKGROUND_STRUCTURES)).toEqual([])
  })

  it('retains the background section when its rendering is disabled or foreground visibility changes', () => {
    const coverage = [
      { id: 'cerebral-cortex', title: 'Cortex', evidence: 'Source', structure_ids: ['right-cortex', 'left-cortex'] },
      { id: 'brainstem', title: 'Brainstem', evidence: 'Source', structure_ids: ['brainstem'] },
      { id: 'cerebellum', title: 'Cerebellum', evidence: 'Source', structure_ids: ['cerebellum'] },
      { id: 'skull-base-context', title: 'Skull', evidence: 'Source', structure_ids: ['skull'] },
    ]
    const available = brainBackgroundIds(structures, coverage)
    const initial: { visible: string[]; surfaceContext?: SurfaceContext } = { visible: ['right-cortex'] }
    const off = reserveBrainBackground(initial, available)
    const on = { ...off, visible: ['right-cortex', 'brainstem'], surfaceContext: { ...off.surfaceContext!, enabled: true, opacity: 1 } }
    expect(off.surfaceContext?.enabled).toBe(false)
    expect(ids(librarySectionStructures(structures, scope, off.surfaceContext!.structure_ids, BACKGROUND_STRUCTURES))).toEqual(['brainstem', 'cerebellum'])
    expect(librarySectionStructures(structures, scope, on.surfaceContext.structure_ids, BACKGROUND_STRUCTURES))
      .toEqual(librarySectionStructures(structures, scope, available, BACKGROUND_STRUCTURES))
  })

  it('selects all source objects or a native category across the group boundary', () => {
    expect(librarySectionStructures(structures, scope, background, ALL_STRUCTURES)).toEqual(structures)
    expect(ids(librarySectionStructures(structures, scope, background, categorySection('Brainstem')))).toEqual(['brainstem'])
    expect(ids(librarySectionStructures(structures, scope, background, categorySection('Bone')))).toEqual(['skull'])
    expect(librarySectionStructures(structures, scope, background, categorySection('Unavailable category'))).toEqual([])
    const punctuation = [{ id: 'native', category: 'Source: category / original' }]
    expect(categorySection(punctuation[0].category)).toBe('category:Source: category / original')
    expect(librarySectionStructures(punctuation, undefined, [], categorySection(punctuation[0].category))).toEqual(punctuation)
  })

  it('falls back to the group for unknown selections and treats absent or empty scopes as the complete source', () => {
    expect(ids(librarySectionStructures(structures, scope, background, 'retired-selection'))).toEqual(['right-cortex', 'left-cortex'])
    for (const unscoped of [undefined, { ...scope, structure_ids: [] }]) {
      expect(librarySectionStructures(structures, unscoped, background, CURRENT_GROUP)).toEqual(structures)
      expect(librarySectionStructures(structures, unscoped, background, 'retired-selection')).toEqual(structures)
      expect(librarySectionStructures(structures, unscoped, background, BACKGROUND_STRUCTURES)).toEqual([])
    }
  })

  it('keeps an empty source empty for every section', () => {
    for (const selection of [CURRENT_GROUP, BACKGROUND_STRUCTURES, ALL_STRUCTURES, categorySection('Brainstem'), 'unknown']) {
      expect(librarySectionStructures([], scope, background, selection)).toEqual([])
    }
  })
})
