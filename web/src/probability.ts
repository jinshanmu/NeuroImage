import type { Manifest, ProbabilityEvidence } from './types'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function probabilityNavigationDescription(build: Manifest['build']): string {
  const recipe = record(build.recipe), mask = record(recipe.mask_rule)
  const percent = recipe.probability_units === 'percent'
  if (mask.operator === '>=' && typeof mask.threshold === 'number' && Number.isFinite(mask.threshold) && mask.threshold > 0 && mask.threshold <= (percent ? 100 : 1)) {
    if (mask.origin === 'derived-from-probability')
      return `The 3D display mask is computed at source probability ≥ ${mask.threshold}${percent ? '%' : ''}. This viewing threshold is not an individual vessel or tissue boundary. The original probability values remain unchanged; the 2D overlay shows the selected field.`
    return `Independent source masks use support ≥ ${mask.threshold}${percent ? '%' : ''}. Overlaps are retained. The 2D overlay shows the selected region only; 3D surfaces follow each original mask.`
  }
  const rule = record(record(build.recipe).hard_label_rule)
  if (rule.method === 'maximum-probability-inclusive-threshold' && typeof rule.threshold === 'number' &&
      Number.isFinite(rule.threshold) && rule.threshold > 0 && rule.threshold <= 1)
    return `Source navigation labels select the maximum channel at support ≥ ${rule.threshold}. Surfaces follow those labels.`
  return 'Surfaces follow the delivered categorical navigation labels. Consult the source definition for their relationship to probabilities.'
}

export function probabilityScale(evidence?: ProbabilityEvidence | null): [string, string] {
  return evidence?.units === 'percent' ? ['0%', '100%'] : ['0', '1']
}

export function formatProbability(value: number | null | undefined, evidence?: ProbabilityEvidence | null): string {
  if (value == null || !Number.isFinite(value)) return 'Unavailable at cursor'
  return evidence?.units === 'percent' ? `${value.toFixed(2)}%` : value.toFixed(4)
}
