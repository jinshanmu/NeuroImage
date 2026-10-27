import { sourceIsBrowsable, sourceMenuId } from './sourceBrowse'

/** Upstream resource families, independent of source representation or license. */
const FAMILIES = [
  { id: 'bigbrain', title: 'BigBrain', prefixes: ['bigbrain_'] },
  { id: 'brainstem_navigator', title: 'Brainstem Navigator', prefixes: ['brainstem_navigator_'] },
  { id: 'cerebra', title: 'CerebrA', prefixes: ['cerebra'] },
  { id: 'cit168', title: 'CIT168', prefixes: ['cit168_'] },
  { id: 'hcp1065', title: 'HCP1065', prefixes: ['hcp1065_'] },
  { id: 'julich', title: 'Julich-Brain', prefixes: ['julich_'] },
  { id: 'mida', title: 'MIDA', prefixes: ['mida', 'mida_'] },
  { id: 'mug500', title: 'MUG500+', prefixes: ['mug500_'] },
  { id: 'spl_nac', title: 'SPL/NAC', prefixes: ['spl_nac', 'spl_nac_'] },
  { id: 'suit', title: 'SUIT', prefixes: ['suit_'] },
  { id: 'thu_mra', title: 'THU Cerebral MRA', prefixes: ['thu_mra_'] },
  { id: 'z_anatomy', title: 'Z-Anatomy', prefixes: ['z_anatomy', 'z_anatomy_'] },
]

export interface DatasetFamily<T> { id: string; title: string; members: T[] }
export const familySelection = (id: string) => 'family:' + id
export const selectedFamilyId = (selection: string | null) => selection?.startsWith('family:') ? selection.slice(7) : null

export function datasetFamilyIdentity(source: { id: string; title: string }): { id: string; title: string } {
  const definition = FAMILIES.find(family => family.prefixes.some(prefix => prefix.endsWith('_') ? source.id.startsWith(prefix) : source.id === prefix))
  return { id: definition?.id ?? source.id, title: definition?.title ?? source.title }
}

export function datasetOptionName({ dataset_id, title }: { dataset_id: string; title: string }): string {
  const sourceId = sourceMenuId(dataset_id)
  const name = datasetFamilyIdentity({ id: sourceId, title }).title
  const variants: Record<string, string> = {
    hcp1065_tracts: 'tracts', hcp1065_prob: 'probabilities',
    mug500_healthy: 'labels', mug500_source_mesh: 'mesh',
    bigbrain_layers: 'layers', bigbrain_hippocampus: 'hippocampus',
  }
  const mug = sourceId.match(/^mug500_(healthy|source_mesh)_(a\d{4})$/)
  const variant = variants[sourceId] ?? (mug ? `${mug[2].toUpperCase()} ${mug[1] === 'healthy' ? 'labels' : 'mesh'}` : undefined) ?? sourceId.match(/^thu_mra_case(\d+)$/)?.[1]
  return variant ? `${name} ${variant}` : name
}

export function datasetFamilies<T extends { id: string; title: string }>(sources: T[]): DatasetFamily<T>[] {
  const grouped = new Map<string, DatasetFamily<T>>()
  for (const source of sources) {
    if (!sourceIsBrowsable(source.id)) continue
    const { id, title } = datasetFamilyIdentity(source)
    let family = grouped.get(id)
    if (!family) { family = { id, title, members: [] }; grouped.set(id, family) }
    family.members.push(source)
  }
  return [...grouped.values()].sort((a, b) => a.title.localeCompare(b.title))
}
