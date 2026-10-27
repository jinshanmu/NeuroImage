import { describe, expect, it } from 'vitest'
import { CursorReadout } from './cursorReadout'
import { toggleCanvasStructure } from './canvasSelection'
import type { Vec3 } from './types'

describe('source name at the physical cursor', () => {
  it('retains the source hit after display deselection clears the active structure', () => {
    const cursor = new CursorReadout(), position: Vec3 = [-12, 5, 8]
    cursor.remember(position, 'source:cortex')
    const hidden = toggleCanvasStructure(['source:cortex', 'source:deep'], 'source:cortex', true)
    expect(hidden).toEqual({ selected: null, visible: ['source:deep'] })
    expect(cursor.at(position)).toEqual({ structureId: 'source:cortex' })
  })

  it('distinguishes a known background position from an uncached position', () => {
    const cursor = new CursorReadout(), position: Vec3 = [0, 0, 0]
    expect(cursor.at(position)).toBeUndefined()
    cursor.remember(position, null)
    expect(cursor.at(position)).toEqual({ structureId: null })
    expect(cursor.at([1, 0, 0])).toBeUndefined()
  })

  it('matches small per-axis floating-point drift but rejects a different location', () => {
    const cursor = new CursorReadout()
    cursor.remember([0, 0, 0], 'source:surface')
    expect(cursor.at([.00009, -.00009, .00009])).toEqual({ structureId: 'source:surface' })
    for (const position of [[.0001, 0, 0], [0, -.0001, 0], [0, 0, .0001], [NaN, 0, 0]] as Vec3[]) {
      expect(cursor.at(position)).toBeUndefined()
    }
  })

  it('copies the hit position rather than sharing the caller array', () => {
    const cursor = new CursorReadout(), position: Vec3 = [1, 2, 3]
    cursor.remember(position, 'source:one')
    position[0] = 7
    expect(cursor.at([1, 2, 3])).toEqual({ structureId: 'source:one' })
    expect(cursor.at(position)).toBeUndefined()
  })

  it('does not expose a mutable reference to the cached result', () => {
    const cursor = new CursorReadout(), position: Vec3 = [1, 2, 3]
    cursor.remember(position, 'source:one')
    const result = cursor.at(position)!
    result.structureId = null
    expect(cursor.at(position)).toEqual({ structureId: 'source:one' })
    expect(cursor.at(position)).not.toBe(result)
  })

  it('replaces the old hit when the cursor reaches another structure or true background', () => {
    const cursor = new CursorReadout()
    cursor.remember([1, 2, 3], 'source:one')
    cursor.remember([4, 5, 6], 'source:two')
    expect(cursor.at([1, 2, 3])).toBeUndefined()
    expect(cursor.at([4, 5, 6])).toEqual({ structureId: 'source:two' })
    cursor.remember([4, 5, 6], null)
    expect(cursor.at([4, 5, 6])).toEqual({ structureId: null })
  })

  it('keeps canvas instances isolated and clears disposed readouts', () => {
    const left = new CursorReadout(), right = new CursorReadout(), position: Vec3 = [1, 2, 3]
    left.remember(position, 'left:source')
    right.remember(position, 'right:source')
    left.clear()
    expect(left.at(position)).toBeUndefined()
    expect(right.at(position)).toEqual({ structureId: 'right:source' })
    left.remember(position, 'left:new')
    expect(left.at(position)).toEqual({ structureId: 'left:new' })
  })
})
