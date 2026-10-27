import type { AnatomyScope } from './anatomyNavigation'

export const CURRENT_GROUP = 'group'
export const BACKGROUND_STRUCTURES = 'background'
export const ALL_STRUCTURES = 'all'

const CATEGORY_PREFIX = 'category:'

export function categorySection(category: string): string {
  return CATEGORY_PREFIX + category
}

/** Library sections select source objects without changing their display state. */
export function librarySectionStructures<T extends { id: string; category: string }>(
  structures: T[], scope: AnatomyScope | undefined, backgroundIds: readonly string[], selection: string,
): T[] {
  if (selection === ALL_STRUCTURES) return structures
  if (selection.startsWith(CATEGORY_PREFIX)) {
    const category = selection.slice(CATEGORY_PREFIX.length)
    return structures.filter(structure => structure.category === category)
  }
  if (selection === BACKGROUND_STRUCTURES) {
    // Without a restricted group, every source object belongs to this group.
    if (!scope?.structure_ids.length) return []
    const group = new Set(scope.structure_ids), background = new Set(backgroundIds)
    return structures.filter(structure => background.has(structure.id) && !group.has(structure.id))
  }
  // Unknown selections keep the current group's safe default. Whole-brain
  // scopes still use their exact declared IDs, without broadening the source.
  if (!scope?.structure_ids.length) return structures
  const group = new Set(scope.structure_ids)
  return structures.filter(structure => group.has(structure.id))
}
