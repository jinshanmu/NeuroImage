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
    for (const url of ['/?view=atlas&atlas=source-v1&group=ventricles', '/?view=anatomy&dataset=cerebra', '/?view=workspace&dataset=cerebra', '/'])
      expect(normalizeBrowseLocation(url)).toBe(url)
  })
  it('links dataset acquisition and browsing separately', () => {
    expect(destinationUrl({ view: 'workspace', dataset: 'cerebra' })).toBe('/?view=workspace&dataset=cerebra')
    expect(destinationUrl({ view: 'anatomy', dataset: 'cerebra' })).toBe('/?view=anatomy&dataset=cerebra')
    expect(destinationUrl({})).toBe('/')
  })
})
