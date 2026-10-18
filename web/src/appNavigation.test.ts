import { describe, expect, it } from 'vitest'
import { destinationUrl } from './appNavigation'

describe('browser destinations', () => {
  it('preserves source and group identity in reloadable viewer links', () => {
    const url = destinationUrl({ view: 'atlas', atlas: 'source/1+2', group: 'deep-nuclei' })
    const query = new URL(url, 'http://localhost').searchParams
    expect(query.get('atlas')).toBe('source/1+2')
    expect(query.get('group')).toBe('deep-nuclei')
    expect(query.get('view')).toBe('atlas')
  })
  it('encodes teaching identities without placing teaching content in history', () => {
    expect(new URL(destinationUrl({ teaching: 'lesson & source' }), 'http://localhost').searchParams.get('teaching-content')).toBe('lesson & source')
    expect(destinationUrl({ view: 'teaching', editCourse: 'course-1' })).toBe('/?view=teaching&edit-course=course-1')
  })
  it('links dataset acquisition and browsing separately', () => {
    expect(destinationUrl({ view: 'workspace', dataset: 'cerebra' })).toBe('/?view=workspace&dataset=cerebra')
    expect(destinationUrl({ view: 'anatomy', dataset: 'cerebra' })).toBe('/?view=anatomy&dataset=cerebra')
    expect(destinationUrl({})).toBe('/')
  })
})
