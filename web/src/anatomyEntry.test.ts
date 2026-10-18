import { expect, it } from 'vitest'
import { anatomyEntry } from './anatomyEntry'
import type { Manifest, ViewState } from './types'
import type { AnatomyScope } from './anatomyNavigation'

it('opens a regional entry at its source voxel only when source version and grid match',()=>{
  const affine=[[0,0,1,-30],[-1,0,0,20],[0,1,0,-10],[0,0,0,1]]
  const volume={id:'t2',shape:[50,50,50],affine_ras_mm:affine,cal_min:0,cal_max:100}
  const manifest={sources:[{id:'source',version:'1'}],volumes:[volume],structures:[{id:'context'}]} as Manifest
  const state={annotations:[],position:[0,0,0]} as unknown as ViewState
  const scope:AnatomyScope={id:'region',title:'Region',structure_ids:[],entry:{source_id:'source',source_version:'1',volume_id:'t2',shape:[50,50,50],affine_ras_mm:affine,index:[4,6,8],selected:'context',visible:['context'],label:'Region',reference:'Source grid observation'}}
  const result=anatomyEntry(state,manifest,scope)
  expect(result.position).toEqual([-22,16,-4]); expect(result.background).toBe('t2'); expect(result.pan).toEqual([0,0,0,1])
  expect(result.annotations[0].structure_id).toBeNull(); expect(result.selectionEvidence?.kind).toBe('teaching-marker')
  expect(anatomyEntry(state,{...manifest,sources:[{...manifest.sources[0],version:'2'}]},scope)).toBe(state)
  expect(anatomyEntry(state,{...manifest,volumes:[{...manifest.volumes[0],affine_ras_mm:[[0,0,1,-31],...affine.slice(1)]}]},scope)).toBe(state)
})
