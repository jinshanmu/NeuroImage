import { expect, it } from 'vitest'
import { brainBackgroundIds, contextIds, contextOpacity, validSurfaceContext } from './atlasBackground'

it('uses brain coverage from the same source and excludes unavailable or streamline objects',()=>{
  const structures=[{id:'cortex'},{id:'cerebellum'},{id:'bone'},{id:'tract',kind:'streamline-bundle'}]
  const coverage=[{id:'cerebral-cortex',title:'Cortex',evidence:'Source',structure_ids:['cortex','missing','tract']},
    {id:'cerebellum',title:'Cerebellum',evidence:'Source',structure_ids:['cerebellum']},
    {id:'skull-base-context',title:'Skull',evidence:'Source',structure_ids:['bone']}]
  expect(brainBackgroundIds(structures,coverage)).toEqual(['cortex','cerebellum'])
  expect(brainBackgroundIds(structures,coverage.slice(1))).toEqual([])
})

it('keeps foreground selection and opacity independent from context toggles',()=>{
  const state={visible:['target'],surfaceContext:{enabled:true,opacity:.2,structure_ids:['target','background']}}
  expect(contextIds(state)).toEqual(['background'])
  expect(contextOpacity(state,'target',.8)).toBe(.8)
  expect(contextOpacity(state,'background',.8)).toBe(.2)
  expect(contextOpacity(state,'hidden',.8)).toBe(0)
  expect(contextIds({...state,surfaceContext:{...state.surfaceContext,enabled:false}})).toEqual([])
  expect(state.visible).toEqual(['target'])
  const ids=new Set(['target','background'])
  expect(validSurfaceContext(state.surfaceContext,ids)).toBe(true)
  for(const change of [{enabled:'yes'},{opacity:NaN},{opacity:2},{structure_ids:['background','background']},{structure_ids:['another-source']}])
    expect(validSurfaceContext({...state.surfaceContext,...change},ids)).toBe(false)
})
