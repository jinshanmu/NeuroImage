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

/** Context comes exclusively from brain structures in the current source package. */
export function brainBackgroundIds(structures: { id: string; kind?: string }[], coverage: AnatomyCoverage[] = []): string[] {
  const cortex = coverage.find(group => group.id === 'cerebral-cortex')?.structure_ids ?? []
  const available = new Set(structures.filter(item => item.kind !== 'streamline-bundle').map(item => item.id))
  if (!cortex.some(id => available.has(id))) return []
  return [...new Set(coverage.filter(group => ['cerebral-cortex', 'cerebellum', 'brainstem'].includes(group.id))
    .flatMap(group => group.structure_ids ?? []))].filter(id => available.has(id))
}

export function contextIds(state: { visible: string[]; surfaceContext?: SurfaceContext }): string[] {
  const context = state.surfaceContext
  return context?.enabled && context.opacity > 0 ? context.structure_ids.filter(id => !state.visible.includes(id)) : []
}

export function validSurfaceContext(value: unknown, ids: Set<string>): value is SurfaceContext {
  if (!value || typeof value !== 'object') return false
  const context = value as SurfaceContext
  return typeof context.enabled === 'boolean' && typeof context.opacity === 'number' && Number.isFinite(context.opacity)
    && context.opacity >= 0 && context.opacity <= 1 && Array.isArray(context.structure_ids)
    && new Set(context.structure_ids).size === context.structure_ids.length && context.structure_ids.every(id => ids.has(id))
}
