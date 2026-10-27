import { describe, expect, it } from 'vitest'
import { categoricalVolumeSelection } from './categoricalVolumeSelection'
import type { SurfaceCutaway, Vec3 } from './types'

const state = { visible: ['cortex', 'nucleus'], meshOpacity: 1 }

describe('source-voxel picking in categorical 3D volumes', () => {
  it('identifies the sampled label inside a solid structure without requiring a nearby surface', () => {
    expect(categoricalVolumeSelection('nucleus', state, [13, -24, 8])).toEqual({
      selected: 'nucleus', selectionEvidence: { kind: 'label-voxel', candidates: ['nucleus'] },
    })
  })

  it('does not turn an empty, hidden or background-only voxel into a different visible structure', () => {
    expect(categoricalVolumeSelection(null, state, [0, 0, 0])).toBeNull()
    expect(categoricalVolumeSelection('hidden-nucleus', state, [0, 0, 0])).toBeNull()
    const withContext = { ...state, surfaceContext: { enabled: true, opacity: .5, structure_ids: ['cerebellum'] } }
    expect(categoricalVolumeSelection('cerebellum', withContext, [0, 0, 0])).toBeNull()
  })

  it('excludes zero-opacity foreground labels independently of an enabled background', () => {
    expect(categoricalVolumeSelection('nucleus', { ...state, meshOpacity: 0 }, [0, 0, 0])).toBeNull()
    expect(categoricalVolumeSelection('nucleus', { ...state, surfaceOpacity: { nucleus: 0 } }, [0, 0, 0])).toBeNull()
    expect(categoricalVolumeSelection('nucleus', { ...state, meshOpacity: .25 }, [0, 0, 0])?.selected).toBe('nucleus')
    expect(categoricalVolumeSelection('cortex', { ...state, surfaceOpacity: { nucleus: 0 } }, [0, 0, 0])?.selected).toBe('cortex')
  })

  it.each([
    [0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1],
  ] as const)('uses the sampled physical plane before following the hit on axis %s, side %s', (axis, side) => {
    const cut: SurfaceCutaway = { axis, side, position_mm: 10, structures: ['cortex'], followCursor: true }
    const picked = { ...state, surfaceCutaway: cut }
    const onPlane: Vec3 = [0, 0, 0]; onPlane[axis] = 10
    const retained: Vec3 = [...onPlane]; retained[axis] -= side * 2
    const removed: Vec3 = [...onPlane]; removed[axis] += side * 2
    expect(categoricalVolumeSelection('nucleus', picked, retained)?.selected).toBe('nucleus')
    expect(categoricalVolumeSelection('nucleus', picked, onPlane)?.selected).toBe('nucleus')
    expect(categoricalVolumeSelection('nucleus', picked, removed)).toBeNull()
    // The render interval also clips labels enabled after the original Cut.
    expect(cut.structures).toEqual(['cortex'])
    expect(cut.position_mm).toBe(10)
  })

  it('rejects nonfinite hit coordinates and opacity without mutating source display state', () => {
    expect(categoricalVolumeSelection('cortex', state, [NaN, 0, 0])).toBeNull()
    expect(categoricalVolumeSelection('cortex', state, [0, Infinity, 0])).toBeNull()
    expect(categoricalVolumeSelection('cortex', { ...state, meshOpacity: NaN }, [0, 0, 0])).toBeNull()
    const original = structuredClone(state), position = [1, 2, 3]
    categoricalVolumeSelection('cortex', state, position)
    expect(state).toEqual(original)
    expect(position).toEqual([1, 2, 3])
  })
})
