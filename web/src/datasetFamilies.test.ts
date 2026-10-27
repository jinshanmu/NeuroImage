import { describe, expect, it } from 'vitest'
import { datasetFamilies, datasetFamilyIdentity, datasetOptionName } from './datasetFamilies'

describe('expanded source configurations', () => {
  it('hides retired parallel configurations and keeps native representations inside their source family', () => {
    const ids = ['spl_nac', 'spl_nac_complete', 'spl_nac_sulci', 'z_anatomy', 'z_anatomy_complete', 'brainstem_navigator_mni', 'brainstem_navigator_iit']
    const families = datasetFamilies(ids.map(id => ({id, title: id})))
    expect(families).toHaveLength(3)
    expect(families.find(item => item.id === 'spl_nac')?.members).toHaveLength(2)
    expect(families.find(item => item.id === 'z_anatomy')?.members).toHaveLength(1)
    expect(families.find(item => item.id === 'brainstem_navigator')?.members).toHaveLength(2)
  })

  it('identifies every healthy skull as the same source family with an explicit case and representation', () => {
    for (let number = 1; number <= 500; number++) {
      const caseId = `a${String(number).padStart(4, '0')}`
      for (const kind of ['healthy', 'source_mesh']) {
        const dataset_id = `mug500_${kind}_${caseId}`
        expect(datasetFamilyIdentity({id:dataset_id,title:dataset_id}).id).toBe('mug500')
        expect(datasetOptionName({dataset_id,title:dataset_id})).toBe(`MUG500+ ${caseId.toUpperCase()} ${kind === 'healthy' ? 'labels' : 'mesh'}`)
      }
    }
  })
})
