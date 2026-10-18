import { describe, expect, it } from 'vitest'
import { formatProbability, probabilityNavigationDescription, probabilityScale } from './probability'
import type { Manifest, ProbabilityEvidence } from './types'

const build = (rule?: unknown): Manifest['build'] => ({ signature:'test',software_version:'test',parameters:{},inputs:[],recipe:{hard_label_rule:rule} })
describe('source-defined probability interpretation', () => {
  it('uses the declared threshold instead of a fixed dataset-specific value', () => {
    const description = probabilityNavigationDescription(build({method:'maximum-probability-inclusive-threshold',threshold:.6}))
    expect(description).toContain('≥ 0.6')
    expect(description).not.toContain('0.25')
    expect(description).not.toMatch(/observer|population|reflection|right.side/i)
  })
  it.each([undefined,{method:'unknown',threshold:.25},{method:'maximum-probability-inclusive-threshold',threshold:-1},{method:'maximum-probability-inclusive-threshold',threshold:NaN}])('does not invent a relationship when its declaration is unsupported %#', rule => {
    const description=probabilityNavigationDescription(build(rule))
    expect(description).toContain('Consult the source definition')
    expect(description).not.toContain('≥')
  })
  it('retains source percent values and describes a project display threshold', () => {
    const evidence: ProbabilityEvidence = {volume_id:'arterial_probability',source_input:'probability',source_channel:null,interpretation:'Source occurrence',derivation:'Source atlas',units:'percent'}
    expect(formatProbability(62.5,evidence)).toBe('62.50%')
    expect(probabilityScale(evidence)).toEqual(['0%','100%'])
    expect(formatProbability(.625,{...evidence,units:'fraction'})).toBe('0.6250')
    expect(formatProbability(null,evidence)).toBe('Unavailable at cursor')
    expect(formatProbability(NaN,evidence)).toBe('Unavailable at cursor')
    const percentBuild={...build(),recipe:{probability_units:'percent',mask_rule:{operator:'>=',threshold:25,origin:'derived-from-probability'}}}
    const description=probabilityNavigationDescription(percentBuild)
    expect(description).toContain('≥ 25%')
    expect(description).toContain('not an individual vessel or tissue boundary')
    expect(description).not.toContain('original mask')
    expect(probabilityNavigationDescription({...percentBuild,recipe:{...percentBuild.recipe,mask_rule:{...percentBuild.recipe.mask_rule,threshold:101}}})).not.toContain('≥')
  })
})
