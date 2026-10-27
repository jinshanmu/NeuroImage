import { describe, expect, it } from 'vitest'
import { full3DPanel } from './full3DPanel'

describe('the entire multiplanar 3D panel', () => {
  const region = [10, 20, 900, 600]
  it('includes the upper and lower blank space in a row', () => {
    expect(full3DPanel([680, 200, 200, 200], [[10, 200], [230, 200], [450, 200]], region))
      .toEqual([680, 20, 230, 600])
  })
  it('includes the left and right blank space in a column', () => {
    expect(full3DPanel([350, 470, 150, 150], [[350, 20], [350, 170], [350, 320]], region))
      .toEqual([10, 470, 900, 150])
  })
  it('fills the available lower right grid quadrant', () => {
    expect(full3DPanel([460, 320, 200, 200], [[10, 320], [10, 20], [460, 20]], region))
      .toEqual([460, 320, 450, 300])
  })
  it('keeps a single 3D view and invalid extents unchanged', () => {
    const rect = [0, 0, 300, 300]
    expect(full3DPanel(rect, [], region)).toBe(rect)
    expect(full3DPanel(rect, [[0, 0], [1, 0], [2, 0]], [0, 0, 0, 0])).toBe(rect)
  })
})
