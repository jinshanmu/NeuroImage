/** Upstream resource families, independent of source representation or license. */
const FAMILIES = [
  { id: 'bigbrain', title: 'BigBrain', prefixes: ['bigbrain_'] },
  { id: 'brainstem_navigator', title: 'Brainstem Navigator', prefixes: ['brainstem_navigator_'] },
  { id: 'cerebra', title: 'CerebrA', prefixes: ['cerebra'] },
  { id: 'cit168', title: 'CIT168', prefixes: ['cit168_'] },
  { id: 'humanbrainatlas', title: 'HumanBrainAtlas', prefixes: ['hba_'] },
  { id: 'hcp1065', title: 'HCP1065', prefixes: ['hcp1065_'] },
  { id: 'inner_ear_ct', title: 'Human Inner Ear CT', prefixes: ['inner_ear_ct_'] },
  { id: 'ixi', title: 'IXI', prefixes: ['ixi_'] },
  { id: 'julich', title: 'Julich-Brain', prefixes: ['julich_'] },
  { id: 'mesoveins', title: 'Meso-vein MRI', prefixes: ['mesoveins'] },
  { id: 'mida', title: 'MIDA', prefixes: ['mida'] },
  { id: 'arterial_occurrence', title: 'Arterial occurrence atlas', prefixes: ['mouches_'] },
  { id: 'mug500', title: 'MUG500+', prefixes: ['mug500_'] },
  { id: 'nextbrain', title: 'NextBrain', prefixes: ['nextbrain_'] },
  { id: 'spl_nac', title: 'SPL/NAC', prefixes: ['spl_nac'] },
  { id: 'suit', title: 'SUIT', prefixes: ['suit_'] },
  { id: 'thu_mra', title: 'THU Cerebral MRA', prefixes: ['thu_mra_'] },
  { id: 'venat', title: 'VENAT', prefixes: ['venat'] },
  { id: 'z_anatomy', title: 'Z-Anatomy', prefixes: ['z_anatomy'] },
]

export interface DatasetFamily<T> { id: string; title: string; members: T[] }
export const familySelection = (id: string) => 'family:' + id
export const selectedFamilyId = (selection: string | null) => selection?.startsWith('family:') ? selection.slice(7) : null

export function datasetFamilies<T extends { id: string; title: string }>(sources: T[]): DatasetFamily<T>[] {
  const grouped = new Map<string, DatasetFamily<T>>()
  for (const source of sources) {
    const definition = FAMILIES.find(family => family.prefixes.some(prefix => prefix.endsWith('_') ? source.id.startsWith(prefix) : source.id === prefix))
    const id = definition?.id ?? source.id
    let family = grouped.get(id)
    if (!family) { family = { id, title: definition?.title ?? source.title, members: [] }; grouped.set(id, family) }
    family.members.push(source)
  }
  return [...grouped.values()].sort((a, b) => a.title.localeCompare(b.title))
}
