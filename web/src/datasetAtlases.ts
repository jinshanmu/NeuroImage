import type { BrowseTarget } from './anatomyNavigation'
import type { SourceInfo } from './useAnatomyLibrary'
import { sourceIsBrowsable } from './sourceBrowse'

export interface DatasetAtlasEntry {
  source: SourceInfo
  target?: BrowseTarget
  label: string
}

export interface DatasetAtlasCase {
  id: string
  title: string
  entries: DatasetAtlasEntry[]
}

/** Complete source packages, grouped by the upstream case rather than anatomy. */
export function datasetAtlasCases(members: SourceInfo[], targets: BrowseTarget[]): DatasetAtlasCase[] {
  const memberIds = new Set(members.filter(source => sourceIsBrowsable(source.id)).map(source => source.id))
  const latest = new Map<string, BrowseTarget>()
  for (const target of targets) {
    if (!memberIds.has(target.dataset_id)) continue
    const previous = latest.get(target.dataset_id)
    const created = target.created_utc ?? '', previousCreated = previous?.created_utc ?? ''
    if (!previous || created > previousCreated ||
      (created === previousCreated && target.active && !previous.active)) latest.set(target.dataset_id, target)
  }

  const cases = new Map<string | null, DatasetAtlasCase>()
  const seen = new Set<string>()
  for (const source of members) {
    if (!sourceIsBrowsable(source.id)) continue
    if (seen.has(source.id)) continue
    seen.add(source.id)
    const info = source.dataset_info
    const caseId = info?.case_id ?? null
    const caseLabel = info?.case_label?.trim()
    let group = cases.get(caseId)
    if (!group) {
      group = {id: caseId ?? 'complete', title: caseLabel || 'Complete atlas', entries: []}
      cases.set(caseId, group)
    } else if (caseLabel && group.title === 'Complete atlas') group.title = caseLabel
    group.entries.push({source, target: latest.get(source.id), label: info?.atlas_label?.trim() || source.title})
  }
  return [...cases.values()]
}
