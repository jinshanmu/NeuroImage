import { describe,expect,it } from 'vitest'
import { imageRenderKey,modelRenderKey } from './renderState'
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
})
