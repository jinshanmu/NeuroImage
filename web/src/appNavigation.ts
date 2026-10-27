/** Shareable anatomy and atlas routes. */
export type AppDestination = {
  view?: 'anatomy' | 'atlas'
  dataset?: string
  atlas?: string
  group?: string
}

export function destinationUrl(destination: AppDestination): string {
  const query = new URLSearchParams()
  if (destination.view) query.set('view', destination.view)
  if (destination.dataset) query.set('dataset', destination.dataset)
  if (destination.atlas) query.set('atlas', destination.atlas)
  if (destination.group) query.set('group', destination.group)
  return '/' + (query.size ? '?' + query.toString() : '')
}

/** Retired content and excluded source bookmarks return to the available library. */
export function normalizeBrowseLocation(path: string): string {
  const url = new URL(path, 'http://localhost')
  const retired = ['course', 'teaching-content', 'workspace-content', 'edit-course']
  if (url.searchParams.get('view') === 'teaching' || retired.some(key => url.searchParams.has(key)))
    return destinationUrl({ view: 'anatomy' })
  const excludedFamilies = ['ixi', 'hba', 'humanbrainatlas', 'mesoveins', 'venat', 'mouches', 'arterial_occurrence',
    'inner_ear_ct', 'inner-ear-ct', 'topcow', 'topcow2023', 'topcow2024', 'topbrain', 'topbrain2025',
    'tcia_cases', 'ucsf_pdgm', 'ucsf-pdgm', 'msd_brain_tumour', 'msd_brain_tumor']
  if (['atlas', 'dataset'].some(key => {
    const selection = (url.searchParams.get(key) ?? '').toLowerCase().replace(/^family:/, '')
    return selection.startsWith('nextbrain') || excludedFamilies.some(id =>
      selection === id || selection.startsWith(id + '_') || selection.startsWith(id + '-'))
  }))
    return destinationUrl({ view: 'anatomy' })
  if (url.searchParams.get('view') === 'workspace')
    return destinationUrl({ view: 'anatomy', dataset: url.searchParams.get('dataset') ?? undefined })
  return path
}

export function navigate(destination: AppDestination): void {
  const url = destinationUrl(destination)
  if (location.pathname + location.search !== url) history.pushState(null, '', url)
}
