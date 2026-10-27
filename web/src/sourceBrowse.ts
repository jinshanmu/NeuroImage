import policy from '../../src/neuroimage/catalogs/source-browse.json'

const retired: Record<string, string> = policy.retired_parallel_recipes
const menuAliases: Record<string, string> = policy.source_menu_aliases

/** Exact package identities stay intact; these rules only govern normal discovery. */
export const sourceIsBrowsable = (id: string) => !Object.hasOwn(retired, id)
export const canonicalBrowseSourceId = (id: string) => Object.hasOwn(retired, id) ? retired[id] : id
export const sourceMenuId = (id: string) => {
  const canonical = canonicalBrowseSourceId(id)
  return Object.hasOwn(menuAliases, canonical) ? menuAliases[canonical] : canonical
}
