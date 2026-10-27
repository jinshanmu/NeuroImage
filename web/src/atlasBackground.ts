import type { AnatomyScope } from './anatomyNavigation'
import type { AnatomyCoverage, SurfaceContext } from './types'

export const BACKGROUND_COLOR = [154, 166, 178] as const

export function contextOpacity(state: { visible: string[]; surfaceContext?: SurfaceContext }, id: string, foreground: number): number {
  return state.visible.includes(id) ? foreground : contextIds(state).includes(id) ? state.surfaceContext!.opacity : 0
}

export function scopedStructures<T extends { id: string }>(structures: T[], scope?: AnatomyScope): T[] {
  if (!scope || scope.id === 'general-anatomy') return structures
  const ids = new Set(scope.structure_ids)
  return structures.filter(item => ids.has(item.id))
}

/** Prefer the declared subject when related structures are also in the view. */
export function primaryStructures<T extends { id: string }>(structures: T[], scope?: AnatomyScope): T[] {
  if (!scope?.primary_structure_ids?.length) return structures
  const ids = new Set(scope.primary_structure_ids)
  const primary = structures.filter(item => ids.has(item.id))
  return primary.length ? primary : structures
}

/** Context comes exclusively from declared brain coverage in this source package. */
export function brainBackgroundIds(structures: { id: string; kind?: string }[], coverage: AnatomyCoverage[] = []): string[] {
  const cortex = coverage.find(group => group.id === 'cerebral-cortex')?.structure_ids ?? []
  const available = new Set(structures.filter(item => item.kind !== 'streamline-bundle').map(item => item.id))
  if (!cortex.some(id => available.has(id))) return []
  // Whole-brain coverage is validated by the source catalog and also retains
  // hippocampal, diencephalic and white-matter context outside regional groups.
  return [...new Set(coverage.filter(group => ['general-anatomy', 'cerebral-cortex', 'deep-nuclei', 'ventricles', 'cerebellum', 'brainstem'].includes(group.id))
    .flatMap(group => group.structure_ids ?? []))].filter(id => available.has(id))
}

export function contextIds(state: { visible: string[]; surfaceContext?: SurfaceContext }): string[] {
  const context = state.surfaceContext
  return context?.enabled && context.opacity > 0 ? context.structure_ids.filter(id => !state.visible.includes(id)) : []
}

/** Reserve the available context before the first draw, while keeping it off.
 * Visibility and opacity then cannot change the source frame of reference.
 */
export function reserveBrainBackground<T extends { surfaceContext?: SurfaceContext }>(state: T, backgroundIds: string[]): T {
  if (!backgroundIds.length) return state
  const ids = [...new Set(backgroundIds)], context = state.surfaceContext
  if (context && context.structure_ids.length === ids.length && context.structure_ids.every((id, index) => id === ids[index])) return state
  return { ...state, surfaceContext: { enabled: false, opacity: .15, ...context, structure_ids: ids } }
}

export function validSurfaceContext(value: unknown, ids: Set<string>): value is SurfaceContext {
  if (!value || typeof value !== 'object') return false
  const context = value as SurfaceContext
  return typeof context.enabled === 'boolean' && typeof context.opacity === 'number' && Number.isFinite(context.opacity)
    && context.opacity >= 0 && context.opacity <= 1 && Array.isArray(context.structure_ids)
    && new Set(context.structure_ids).size === context.structure_ids.length && context.structure_ids.every(id => ids.has(id))
}
