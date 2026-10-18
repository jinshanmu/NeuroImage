import type { AnatomyCoverage, AtlasEntry } from './types'
import topics from '../../src/neuroimage/catalogs/anatomy-topics.json'

export interface BrowseTarget {
  key: string; dataset_id: string; title: string; package_version: string; created_utc?: string;
  representation?: string; coverage?: AnatomyCoverage[]; detail_coverage?: AnatomyCoverage[]; active: boolean;
}
export interface BrowseGroup { id: string; title: string; description: string; prefer: string[]; coverageIds?: string[]; parentId?: string; kind?: string }
export interface AnatomyScope { id: string; title: string; structure_ids: string[]; entry?: AnatomyCoverage['entry'] }

// Preferences choose a useful starting view, never a licensing or dataset tier.
export const ANATOMY_GROUPS: BrowseGroup[] = [
  {id:'general-anatomy',title:'Whole brain',description:'Cortex, deep structures and their spatial relationships',prefer:['spl_nac','cerebra','mida']},
  {id:'cerebral-cortex',title:'Cerebral cortex',description:'Lobes and source-defined cortical regions',prefer:['cerebra','spl_nac','mida']},
  {id:'deep-nuclei',title:'Deep nuclei',description:'Basal ganglia, thalamic and subcortical regions',prefer:['cit168_native','spl_nac','cerebra']},
  {id:'white-matter-pathways',title:'White-matter pathways',description:'Projection, association and commissural bundles',prefer:['hcp1065_tracts','mida']},
  {id:'ventricles',title:'Ventricles, cisterns and CSF',description:'Ventricular cavities, cisternal regions and native CSF anatomy',prefer:['spl_nac','cerebra','mida'],coverageIds:['ventricles','cisternal-regions']},
  {id:'brainstem',title:'Brainstem',description:'Midbrain, pons, medulla and source nuclei',prefer:['brainstem_navigator_mni','spl_nac','z_anatomy']},
  {id:'cerebellum',title:'Cerebellum',description:'Cerebellar regions in their native context',prefer:['cerebra','spl_nac','mida']},
  {id:'cranial-nerves',title:'Cranial nerves',description:'Nerve models, trajectories and brainstem context',prefer:['z_anatomy','mida','hcp1065_tracts']},
  {id:'vascular-anatomy',title:'Arteries and veins',description:'Named source models and real angiographic images',prefer:['z_anatomy','mouches_arteries','ixi_mra','mida']},
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

export function groupTargets(group: BrowseGroup, targets: BrowseTarget[]): BrowseTarget[] {
  // A normally browsed source opens its latest complete local construction.
  // Exact saved scenes bypass this choice and retain their original binding.
  const latest = new Map<string, BrowseTarget>()
  for (const target of targets) {
    if (!coverageOf(target).some(item => (group.coverageIds ?? [group.id]).includes(item.id))) continue
    const previous = latest.get(target.dataset_id)
    if (!previous || (target.created_utc ?? '') > (previous.created_utc ?? '') ||
      (target.created_utc === previous.created_utc && target.active && !previous.active)) latest.set(target.dataset_id, target)
  }
  const rank = (dataset: string) => { const index=group.prefer.indexOf(dataset); return index < 0 ? 999 : index }
  return [...latest.values()].sort((a,b)=>rank(a.dataset_id)-rank(b.dataset_id)||a.title.localeCompare(b.title))
}

export function targetScope(group: BrowseGroup, target: BrowseTarget): AnatomyScope {
  const coverage = coverageOf(target).filter(item => (group.coverageIds ?? [group.id]).includes(item.id))
  if (group.parentId && !coverage.length) throw Error('This source version does not supply the selected detailed topic. Open an available source from Browse anatomy.')
  return {id:group.id,title:group.title,structure_ids:[...new Set(coverage.flatMap(item => item.structure_ids ?? []))],entry:coverage.find(item => item.entry)?.entry}
}
