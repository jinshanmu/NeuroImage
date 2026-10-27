import { describe, expect, it } from 'vitest'
import { destinationUrl, normalizeBrowseLocation } from './appNavigation'

describe('browser destinations', () => {
  it('preserves source and group identity in reloadable viewer links', () => {
    const url = destinationUrl({ view: 'atlas', atlas: 'source/1+2', group: 'deep-nuclei' })
    const query = new URL(url, 'http://localhost').searchParams
    expect(query.get('atlas')).toBe('source/1+2')
    expect(query.get('group')).toBe('deep-nuclei')
    expect(query.get('view')).toBe('atlas')
  })
  it.each(['view=teaching', 'course=old', 'workspace-content=old', 'teaching-content=old', 'edit-course=old'])('returns retired %s bookmarks to anatomy', query => {
    expect(normalizeBrowseLocation('/?' + query)).toBe('/?view=anatomy')
  })
  it('keeps atlas and dataset bookmarks intact', () => {
    for (const url of ['/?view=atlas&atlas=source-v1&group=ventricles', '/?view=anatomy&dataset=cerebra', '/'])
      expect(normalizeBrowseLocation(url)).toBe(url)
  })
  it.each([
    'view=atlas&atlas=nextbrain_case1_block05-2a76e6ca515b16ef&group=general-anatomy',
    'view=anatomy&dataset=nextbrain_case2_block07',
    'view=workspace&dataset=nextbrain_case1_block45',
    'view=anatomy&dataset=family%3Anextbrain',
  ])('returns excluded source bookmark %s to the available anatomy library', query => {
    expect(normalizeBrowseLocation('/?' + query)).toBe('/?view=anatomy')
  })
  it.each([
    ['ixi_mra', 'ixi'], ['hba_native', 'humanbrainatlas'], ['mesoveins', 'mesoveins'],
    ['venat', 'venat'], ['mouches_arteries', 'arterial_occurrence'],
    ['inner_ear_ct_specimen1', 'inner_ear_ct'], ['topcow2024', 'topcow2024'],
    ['topbrain2025', 'topbrain2025'], ['tcia_cases', 'ucsf_pdgm'],
    ['msd_brain_tumour', 'msd_brain_tumour'],
  ])('returns every retired %s dataset, family and exact-version atlas bookmark to anatomy', (dataset, family) => {
    for (const query of [
      'view=atlas&atlas=' + dataset + '-preserved-package-version&group=vascular-anatomy',
      'view=atlas&atlas=' + dataset,
      'view=anatomy&dataset=' + dataset,
      'view=workspace&dataset=' + dataset,
      'view=anatomy&dataset=' + encodeURIComponent('family:' + family),
    ]) expect(normalizeBrowseLocation('/?' + query)).toBe('/?view=anatomy')
    expect(normalizeBrowseLocation('/?view=atlas&atlas=' + dataset.toUpperCase() + '-OLD')).toBe('/?view=anatomy')
  })
  it('normalizes an already open VENAT bookmark while leaving saved-content parameters untouched elsewhere', () => {
    expect(normalizeBrowseLocation('/?view=atlas&atlas=venat-preserved-version&scene=old-scene#position')).toBe('/?view=anatomy')
    const supported = '/?view=atlas&atlas=cerebra-exact-version&scene=old-scene#position'
    expect(normalizeBrowseLocation(supported)).toBe(supported)
  })
  it.each([
    'mida', 'hcp1065_tracts-v1', 'cerebra-venat-v1', 'venation-v1', 'venat2-v1',
    'iximra-v1', 'hba2_native-v1', 'mesoveins2-v1', 'mouches2_arteries-v1',
    'family:ixi2', 'family:humanbrainatlas2', 'family:arterial_occurrence2',
    'inner_ear_ct2', 'topcow20240', 'topbrain20250', 'tcia_normal', 'msd_healthy',
  ])('does not confuse the supported or unrelated selection %s with a retired source', selection => {
    for (const key of ['atlas', 'dataset']) {
      const path = '/?view=anatomy&' + key + '=' + encodeURIComponent(selection)
      expect(normalizeBrowseLocation(path)).toBe(path)
    }
  })
  it.each(['ixi_other-v1', 'hba_archived-v1', 'humanbrainatlas-v1', 'mesoveins_old-v1',
    'venat_archived-v1', 'mouches_tof-v1', 'arterial_occurrence-old'])('normalizes the retired family identity %s consistently with the runtime policy', selection => {
    expect(normalizeBrowseLocation('/?view=atlas&atlas=' + selection)).toBe('/?view=anatomy')
  })
  it('normalizes former installation pages to the dataset introduction', () => {
    expect(normalizeBrowseLocation('/?view=workspace&dataset=cerebra')).toBe('/?view=anatomy&dataset=cerebra')
    expect(normalizeBrowseLocation('/?view=workspace&dataset=family%3Abrainstem_navigator')).toBe('/?view=anatomy&dataset=family%3Abrainstem_navigator')
    expect(normalizeBrowseLocation('/?view=workspace')).toBe('/?view=anatomy')
    expect(destinationUrl({ view: 'anatomy', dataset: 'cerebra' })).toBe('/?view=anatomy&dataset=cerebra')
    expect(destinationUrl({})).toBe('/')
  })
})
