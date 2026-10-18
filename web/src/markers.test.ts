import { describe, expect, it } from 'vitest'
import { projectSliceMarker } from './markers'

const axial = { axCorSag: 0, sliceFrac: .5, AxyzMxy: [0, 0, 3, 0, 0], leftTopMM: [-20, -30], fovMM: [40, 60], leftTopWidthHeight: [100, 200, 400, 300] }

describe('physical teaching marker projection', () => {
  it('projects an in-plane RAS point and mirrors presentation without changing that point', () => {
    const position: [number, number, number] = [-10, 15, 3]
    expect(projectSliceMarker(position, axial)).toEqual([200, 275])
    expect(projectSliceMarker(position, { ...axial, leftTopWidthHeight: [500, 200, -400, 300] })).toEqual([400, 275])
    expect(position).toEqual([-10, 15, 3])
  })
  it('omits off-plane and outside-field points instead of placing them at a nearby edge', () => {
    expect(projectSliceMarker([0, 0, 3.1], axial)).toBeNull()
    expect(projectSliceMarker([25, 0, 3], axial)).toBeNull()
    expect(projectSliceMarker([0, -35, 3], axial)).toBeNull()
    expect(projectSliceMarker([0, 0, 3], { ...axial, axCorSag: 4 })).toBeNull()
  })
  it('uses coronal and sagittal plane coordinates explicitly', () => {
    expect(projectSliceMarker([-10, 3, 15], { ...axial, axCorSag: 1 })).toEqual([200, 275])
    expect(projectSliceMarker([3, -10, 15], { ...axial, axCorSag: 2 })).toEqual([200, 275])
  })
  it('respects the actual displayed plane equation', () => {
    const tilted = { ...axial, AxyzMxy: [0, 0, 3, .2, .1] }
    expect(projectSliceMarker([-10, 15, 6.5], tilted)).toEqual([200, 275])
    expect(projectSliceMarker([-10, 15, 3], tilted)).toBeNull()
  })
})
