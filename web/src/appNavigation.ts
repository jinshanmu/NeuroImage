/** Small, shareable routes; teaching content stays in its own storage. */
export type AppDestination = {
  view?: 'anatomy' | 'teaching' | 'workspace' | 'atlas'
  dataset?: string
  atlas?: string
  group?: string
  course?: string
  teaching?: string
  editCourse?: string
}

export function destinationUrl(destination: AppDestination): string {
  const query = new URLSearchParams()
  if (destination.view) query.set('view', destination.view)
  if (destination.dataset) query.set('dataset', destination.dataset)
  if (destination.atlas) query.set('atlas', destination.atlas)
  if (destination.group) query.set('group', destination.group)
  if (destination.course) query.set('course', destination.course)
  if (destination.teaching) query.set('teaching-content', destination.teaching)
  if (destination.editCourse) query.set('edit-course', destination.editCourse)
  return '/' + (query.size ? '?' + query.toString() : '')
}

export function navigate(destination: AppDestination): void {
  const url = destinationUrl(destination)
  if (location.pathname + location.search !== url) history.pushState(null, '', url)
}
