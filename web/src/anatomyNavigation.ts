import type { AnatomyCoverage, AtlasEntry, DatasetInfo, DatasetSource } from './types'
import { datasetFamilyIdentity } from './datasetFamilies'
import topics from '../../src/neuroimage/catalogs/anatomy-topics.json'
import { sourceIsBrowsable, sourceMenuId } from './sourceBrowse'

export interface BrowseTarget {
  key: string; dataset_id: string; title: string; package_version: string; created_utc?: string;
  representation?: string; coverage?: AnatomyCoverage[]; detail_coverage?: AnatomyCoverage[]; active: boolean;
  dataset_info?: DatasetInfo; sources?: DatasetSource[]; base_url?: string;
}
export interface BrowseGroup { id: string; title: string; description: string; prefer: string[]; coverageIds?: string[]; parentId?: string; kind?: string }
export interface AnatomyScope { id: string; title: string; structure_ids: string[]; primary_structure_ids?: string[]; coverage_note?: string; entry?: AnatomyCoverage['entry'] }

// Preferences choose a useful starting view, never a licensing or dataset tier.
export const ANATOMY_GROUPS: BrowseGroup[] = [
  {id:'general-anatomy',title:'Whole brain',description:'Labels across the cerebrum, deep structures, ventricles, brainstem and cerebellum',prefer:['spl_nac','cerebra','mida']},
  {id:'cerebral-cortex',title:'Cerebral cortex',description:'Lobes and source-defined cortical regions',prefer:['cerebra','spl_nac','julich_selected']},
  {id:'deep-nuclei',title:'Deep nuclei',description:'Basal ganglia, thalamic and subcortical regions',prefer:['cit168_native','spl_nac','cerebra']},
  {id:'white-matter-pathways',title:'White-matter pathways',description:'Projection, association and commissural bundles',prefer:['hcp1065_tracts','hcp1065_prob','z_anatomy']},
  {id:'ventricles',title:'Ventricles and cisterns',description:'Ventricular cavities, cisternal regions and native CSF anatomy',prefer:['spl_nac','cerebra','mida'],coverageIds:['ventricles','cisternal-regions']},
  {id:'brainstem',title:'Brainstem',description:'Midbrain, pons, medulla and source nuclei',prefer:['brainstem_navigator_mni','spl_nac','z_anatomy']},
  {id:'cerebellum',title:'Cerebellum',description:'Cerebellar regions in their native context',prefer:['cerebra','spl_nac','mida']},
  {id:'cranial-nerves',title:'Cranial nerves',description:'Named nerves, roots and source trajectories',prefer:['z_anatomy','mida','hcp1065_tracts']},
  {id:'vascular-anatomy',title:'Arteries and veins',description:'Named source models and real angiographic images',prefer:['z_anatomy','mida']},
  {id:'skull-base-context',title:'Skull base',description:'Bones, dural context and temporal anatomy',prefer:['z_anatomy','mida']},
]

export const ANATOMY_TOPICS: BrowseGroup[] = topics.topics.map(topic => ({
  id: topic.id, title: topic.title, description: topic.description, prefer: topic.prefer,
  parentId: topic.parent_id, kind: topic.kind,
}))

const coverageOf = (target: BrowseTarget) => [...(target.coverage ?? []), ...(target.detail_coverage ?? [])]

export function anatomyGroup(id: string | null): BrowseGroup | undefined {
  const group = [...ANATOMY_GROUPS, ...ANATOMY_TOPICS].find(group => group.id === id || group.coverageIds?.includes(id ?? ''))
  // Keep the original route identity for browser-saved regional scenes.
  return group && id ? {...group, id} : undefined
}

export function browseTargets(atlases: AtlasEntry[], records: Record<string, unknown>[] = []): BrowseTarget[] {
  const all = new Map<string, BrowseTarget>()
  for (const item of records) {
    if (item.status !== 'available' || typeof item.key !== 'string') continue
    all.set(item.key, {...item, active:false} as unknown as BrowseTarget)
  }
  for (const item of atlases) all.set(item.key, {...item, active:true})
  return [...all.values()]
}

function latestDatasetTargets(targets: BrowseTarget[]): BrowseTarget[] {
  const latest = new Map<string, BrowseTarget>()
  for (const target of targets) {
    const previous = latest.get(target.dataset_id)
    const created = target.created_utc ?? '', previousCreated = previous?.created_utc ?? ''
    if (!previous || created > previousCreated ||
      (created === previousCreated && target.active && !previous.active)) latest.set(target.dataset_id, target)
  }
  return [...latest.values()]
}

function sourceMenuTargets(targets: BrowseTarget[]): BrowseTarget[] {
  const choices = new Map<string, BrowseTarget>()
  for (const target of latestDatasetTargets(targets.filter(target => sourceIsBrowsable(target.dataset_id)))) {
    const id = sourceMenuId(target.dataset_id), previous = choices.get(id)
    // Prefer the original source entry. Auxiliary native representations stay
    // in the dataset library and supply a slot when only they cover a topic.
    if (!previous || target.dataset_id === id) choices.set(id, target)
  }
  return [...choices.values()]
}

const coversGroup = (group: BrowseGroup, target: BrowseTarget) =>
  coverageOf(target).some(item => (group.coverageIds ?? [group.id]).includes(item.id))

export function groupTargets(group: BrowseGroup, targets: BrowseTarget[]): BrowseTarget[] {
  // A normally browsed source opens its latest complete local construction.
  // Exact saved scenes bypass this choice and retain their original binding.
  const covered = targets.filter(target => coversGroup(group, target))
  const rank = (dataset: string) => { const index=group.prefer.findIndex(id=>sourceMenuId(id)===sourceMenuId(dataset)); return index < 0 ? 999 : index }
  return sourceMenuTargets(covered).sort((a,b)=>rank(a.dataset_id)-rank(b.dataset_id)||a.title.localeCompare(b.title))
}

/** Viewer source choices retain the current scope and its exact selected package. */
export function viewerSourceTargets(atlases: AtlasEntry[], records: Record<string, unknown>[] | undefined,
                                    activeKey: string, scope?: AnatomyScope): BrowseTarget[] {
  const targets = browseTargets(atlases, records)
  const active = targets.find(target => target.key === activeKey)
  if (!active) return []
  let choices: BrowseTarget[]
  if (scope) {
    const group = anatomyGroup(scope.id)
    // An unknown or stale scope must not turn this into a global source list.
    if (!group || !coversGroup(group, active)) return [active]
    choices = groupTargets(group, targets)
  } else {
    const identity = (target: BrowseTarget) => datasetFamilyIdentity({id:target.dataset_id,title:target.title}).id
    const family = identity(active)
    const related = targets.filter(target => family === active.dataset_id
      ? target.dataset_id === active.dataset_id : identity(target) === family)
    choices = sourceMenuTargets(related).sort((a,b)=>a.title.localeCompare(b.title)||a.dataset_id.localeCompare(b.dataset_id))
  }
  // Keep the selected immutable package in its one canonical source slot,
  // including historical complete packages and SPL's independent sulci.
  const id = sourceMenuId(active.dataset_id)
  if (!choices.some(target => sourceMenuId(target.dataset_id) === id)) return [...choices, active]
  return choices.map(target => sourceMenuId(target.dataset_id) === id ? active : target)
}

/** Compare only other sources from the primary viewer's current category. */
export function viewerComparisonTargets(atlases: AtlasEntry[], records: Record<string, unknown>[] | undefined,
                                        activeKey: string, scope?: AnatomyScope, comparisonKey?: string): BrowseTarget[] {
  const sources = viewerSourceTargets(atlases, records, activeKey, scope)
  const active = sources.find(target => target.key === activeKey)
  if (!active) return []
  const choices = sources.filter(target => sourceMenuId(target.dataset_id) !== sourceMenuId(active.dataset_id))
  if (!comparisonKey) return choices
  const comparison = browseTargets(atlases, records).find(target => target.key === comparisonKey)
  if (!comparison) return choices
  if (sourceMenuId(comparison.dataset_id) === sourceMenuId(active.dataset_id)) return choices
  if (scope) {
    const group = anatomyGroup(scope.id)
    if (!group || !coversGroup(group, active) || !coversGroup(group, comparison)) return choices
  } else if (datasetFamilyIdentity({id:comparison.dataset_id,title:comparison.title}).id !==
             datasetFamilyIdentity({id:active.dataset_id,title:active.title}).id) {
    return choices
  }
  // Preserve an eligible exact comparison revision in its source's one slot.
  const id = sourceMenuId(comparison.dataset_id)
  if (!choices.some(target => sourceMenuId(target.dataset_id) === id)) return [...choices, comparison]
  return choices.map(target => sourceMenuId(target.dataset_id) === id ? comparison : target)
}

export function targetScope(group: BrowseGroup, target: BrowseTarget): AnatomyScope {
  const coverage = coverageOf(target).filter(item => (group.coverageIds ?? [group.id]).includes(item.id))
  if (!coverage.length) {
    const selected = group.id === 'general-anatomy' ? 'whole-brain atlas' : group.parentId ? 'detailed topic' : 'anatomical group'
    throw Error(`This source version does not supply the selected ${selected}. Open an available source from Browse anatomy.`)
  }
  return {id:group.id,title:group.title,structure_ids:[...new Set(coverage.flatMap(item => item.structure_ids ?? []))],
    primary_structure_ids:[...new Set(coverage.flatMap(item => item.primary_structure_ids ?? item.structure_ids ?? []))],
    coverage_note:sourceCoverageNote(group,target),entry:coverage.find(item => item.entry)?.entry}
}

export function sourceCoverageNote(group: BrowseGroup, target: BrowseTarget): string | undefined {
  const notes = coverageOf(target).filter(item => (group.coverageIds ?? [group.id]).includes(item.id))
    .map(item => item.coverage_note).filter((note): note is string => !!note)
  return [...new Set(notes)].join(' ') || undefined
}
