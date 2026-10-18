import { expect, it } from 'vitest'
import { compactLabels } from './palette'

it('renders sparse high source values in a small palette while preserving voxels', () => {
  const original = new Uint16Array([0, 4, 60004, 0, 11, 60004, 4])
  const labels = [{label_value: 4}, {label_value: 11}, {label_value: 60004}]
  const result = compactLabels(original.slice(), labels)
  expect(Array.from(result)).toEqual([0,1,3,0,2,3,1])
  expect(Array.from(result, value => value === 0 ? 0 : labels[value-1].label_value)).toEqual(Array.from(original))
})
it('rejects duplicate labels and fractional probability values', () => {
  expect(() => compactLabels(new Uint16Array(1), [{label_value: 4}, {label_value: 4}])).toThrow()
  expect(() => compactLabels(new Float32Array([.5]), [{label_value: 4}])).toThrow()
})
