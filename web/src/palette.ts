import type { RegionStructure } from './types'

/** Map sparse source labels to dense GPU palette indices without changing space. */
export function compactLabels<T extends { length: number; [index: number]: number }>(data: T, structures: Pick<RegionStructure, 'label_value'>[]) {
  const lookup = new Uint16Array(65536)
  structures.forEach((structure, index) => {
    if (!Number.isInteger(structure.label_value) || structure.label_value < 1 || structure.label_value > 65535 || lookup[structure.label_value]) throw new Error('Invalid or duplicate source label value.')
    lookup[structure.label_value] = index + 1
  })
  for (let i = 0; i < data.length; i++) {
    const source = data[i]
    if (!Number.isInteger(source) || source < 0 || source > 65535) throw new Error('Labels must be categorical unsigned integers.')
    data[i] = lookup[source]
  }
  return data
}
