import { describe,expect,it } from 'vitest'
import { imageAssetKey,imageRenderKey,modelAssetKey,modelRenderKey } from './renderState'
import type { ViewState } from './types'
import type { ModelView } from './modelTypes'

describe('render invalidation',()=>{
  const image={visible:['one'],position:[1,2,3],camera:[110,15,1],note:''} as ViewState
  it('keeps text edits out of GPU work while retaining display changes',()=>{
    expect(imageRenderKey({...image,note:'Observation'})).toBe(imageRenderKey(image))
    for(const change of [{visible:[]},{position:[4,5,6]},{labelOpacity:.2}])expect(imageRenderKey({...image,...change} as ViewState)).not.toBe(imageRenderKey(image))
  })
  it('retains model highlight, geometry and annotation changes independently of note text',()=>{
    const model={visible:['one'],selected:'one',note:'',highlightSelected:true} as ModelView
    expect(modelRenderKey({...model,note:'Observation'})).toBe(modelRenderKey(model))
    expect(modelRenderKey({...model,highlightSelected:false})).not.toBe(modelRenderKey(model))
    expect(modelRenderKey({...model,visible:['two']})).not.toBe(modelRenderKey(model))
  })
  it('lets display-only atlas changes finish the same source preparation while invalidating actual dependencies',()=>{
    const state={...image,background:'t1',selected:'one',overlay:'labels',streamlineLevel:'standard',surfaceContext:{enabled:true,opacity:.3,structure_ids:['one','two']}} as ViewState
    for(const change of [{position:[4,5,6]},{camera:[20,-10,2.7]},{meshOpacity:.6},{labelOpacity:0},{surfaceCutaway:{axis:2,side:1,position_mm:3,structures:['one']}},
      {surfaceContext:{...state.surfaceContext!,opacity:.8}},{visible:['two','one']}]){
      expect(imageAssetKey({...state,...change} as ViewState)).toBe(imageAssetKey(state))
    }
    for(const change of [{background:'t2'},{surfaceContext:{...state.surfaceContext!,enabled:false}},{overlay:'probability'},{streamlineLevel:'detail'}]){
      expect(imageAssetKey({...state,...change} as ViewState)).not.toBe(imageAssetKey(state))
    }
    expect(imageAssetKey({...state,overlay:'probability',selected:'two'})).not.toBe(imageAssetKey({...state,overlay:'probability'}))
  })
  it('distinguishes native geometry requests from camera, opacity, cursor and highlight changes',()=>{
    const state={visible:['one'],surfaceContext:{enabled:true,opacity:.3,structure_ids:['two']}} as ModelView
    for(const change of [{opacity:0},{camera:[40,25,2]},{position_native_mm:[3,4,5]},{highlightSelected:true},{surfaceContext:{...state.surfaceContext!,opacity:.9}}]){
      expect(modelAssetKey({...state,...change} as ModelView)).toBe(modelAssetKey(state))
    }
    expect(modelAssetKey({...state,surfaceContext:{...state.surfaceContext!,enabled:false}})).not.toBe(modelAssetKey(state))
    expect(modelAssetKey({...state,visible:[]})).not.toBe(modelAssetKey(state))
  })
})
