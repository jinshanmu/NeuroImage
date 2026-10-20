/** Shareable anatomy, source-management and atlas routes. */
export type AppDestination = {
  view?: 'anatomy' | 'workspace' | 'atlas'
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

/** Retired teaching bookmarks return to anatomy without requesting removed APIs. */
export function normalizeBrowseLocation(path: string): string {
  const url = new URL(path, 'http://localhost')
  const retired = ['course', 'teaching-content', 'workspace-content', 'edit-course']
  if (url.searchParams.get('view') === 'teaching' || retired.some(key => url.searchParams.has(key)))
    return destinationUrl({ view: 'anatomy' })
  return path
}

export function navigate(destination: AppDestination): void {
  const url = destinationUrl(destination)
  if (location.pathname + location.search !== url) history.pushState(null, '', url)
}
