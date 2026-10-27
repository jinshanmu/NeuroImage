import { expect, it } from 'vitest'
import { canonicalBrowseSourceId, sourceIsBrowsable, sourceMenuId } from './sourceBrowse'
import { datasetOptionName } from './datasetFamilies'

it.each([
  ['mida_complete', 'mida', 'MIDA'],
  ['z_anatomy_complete', 'z_anatomy', 'Z-Anatomy'],
  ['spl_nac_complete', 'spl_nac', 'SPL/NAC'],
])('retires %s from discovery while naming an exact historical selection as its source', (old, canonical, title) => {
  expect(sourceIsBrowsable(old)).toBe(false)
  expect(canonicalBrowseSourceId(old)).toBe(canonical)
  expect(sourceMenuId(old)).toBe(canonical)
  expect(datasetOptionName({dataset_id:old,title:'Historical complete package'})).toBe(title)
})

it.each([
  ['spl_nac_sulci', 'spl_nac', 'SPL/NAC'],
  ['brainstem_navigator_iit', 'brainstem_navigator_mni', 'Brainstem Navigator'],
])('retains %s as a library representation and shares one Source menu entry', (id, canonical, title) => {
  expect(sourceIsBrowsable(id)).toBe(true)
  expect(canonicalBrowseSourceId(id)).toBe(id)
  expect(sourceMenuId(id)).toBe(canonical)
  expect(datasetOptionName({dataset_id:id,title:id})).toBe(title)
  expect(datasetOptionName({dataset_id:canonical,title:canonical})).toBe(title)
})

it.each(['hcp1065_prob','hcp1065_tracts','bigbrain_layers','bigbrain_hippocampus',
  'mug500_healthy','mug500_source_mesh','mug500_healthy_a0031','mug500_source_mesh_a0031',
  'thu_mra_case001','constructor','toString','__proto__'])('does not retire or alias the independent source identity %s', id => {
  expect(sourceIsBrowsable(id)).toBe(true)
  expect(sourceMenuId(id)).toBe(id)
})
