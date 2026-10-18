import { describe,expect,it } from 'vitest'
import { imageRenderKey,modelRenderKey } from './renderState'
import type { ViewState } from './types'
import type { ModelView } from './modelTypes'

describe('render invalidation',()=>{
  const image={visible:['one'],position:[1,2,3],camera:[110,15,1],note:'',panel:'learn',teaching:{lesson_id:'a',step:0,answer:'',practice:true,revealed:false}} as ViewState
  it('keeps text edits out of GPU work while retaining display and practice changes',()=>{
    expect(imageRenderKey({...image,note:'Observation',panel:'inspect',teaching:{...image.teaching!,answer:'Answer'}})).toBe(imageRenderKey(image))
    for(const change of [{visible:[]},{position:[4,5,6]},{labelOpacity:.2},{teaching:{...image.teaching!,revealed:true}}])expect(imageRenderKey({...image,...change} as ViewState)).not.toBe(imageRenderKey(image))
  })
  it('retains model highlight, geometry and annotation changes independently of responses',()=>{
    const model={visible:['one'],selected:'one',note:'',lesson_id:'a',lesson_step:0,lesson_answer:'',lesson_revealed:false,highlightSelected:true} as ModelView
    expect(modelRenderKey({...model,note:'Observation',lesson_answer:'Answer',lesson_revealed:true})).toBe(modelRenderKey(model))
    expect(modelRenderKey({...model,highlightSelected:false})).not.toBe(modelRenderKey(model))
    expect(modelRenderKey({...model,visible:['two']})).not.toBe(modelRenderKey(model))
  })
})
