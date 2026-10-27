import { expect, it } from 'vitest'
import { brainBackgroundIds, contextIds, contextOpacity, reserveBrainBackground, validSurfaceContext } from './atlasBackground'
import type { SurfaceContext } from './types'

it('uses brain coverage from the same source and excludes unavailable or streamline objects',()=>{
  const structures=[{id:'cortex'},{id:'cerebellum'},{id:'bone'},{id:'tract',kind:'streamline-bundle'}]
  const coverage=[{id:'cerebral-cortex',title:'Cortex',evidence:'Source',structure_ids:['cortex','missing','tract']},
    {id:'cerebellum',title:'Cerebellum',evidence:'Source',structure_ids:['cerebellum']},
    {id:'skull-base-context',title:'Skull',evidence:'Source',structure_ids:['bone']}]
  expect(brainBackgroundIds(structures,coverage)).toEqual(['cortex','cerebellum'])
  expect(brainBackgroundIds(structures,coverage.slice(1))).toEqual([])
})

it('retains all declared whole-brain compartments without adding skull or scalp objects',()=>{
  const structures=['cortex','brainstem','cerebellum','deep-nucleus','ventricle','hippocampus','white-matter','skull','scalp'].map(id=>({id}))
  const coverage=[{id:'general-anatomy',title:'Whole brain',evidence:'Source',structure_ids:['cortex','brainstem','cerebellum','deep-nucleus','ventricle','hippocampus','white-matter','missing']},
    {id:'cerebral-cortex',title:'Cortex',evidence:'Source',structure_ids:['cortex']},
    {id:'brainstem',title:'Brainstem',evidence:'Source',structure_ids:['brainstem']},
    {id:'cerebellum',title:'Cerebellum',evidence:'Source',structure_ids:['cerebellum']},
    {id:'deep-nuclei',title:'Deep nuclei',evidence:'Source',structure_ids:['deep-nucleus']},
    {id:'ventricles',title:'Ventricles',evidence:'Source',structure_ids:['ventricle']},
    {id:'skull-base-context',title:'Skull',evidence:'Source',structure_ids:['skull','scalp']}]
  expect(brainBackgroundIds(structures,coverage)).toEqual(['cortex','brainstem','cerebellum','deep-nucleus','ventricle','hippocampus','white-matter'])
  expect(brainBackgroundIds(structures,coverage.slice(1))).toEqual(['cortex','brainstem','cerebellum','deep-nucleus','ventricle'])
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

it('reserves the complete context before its first zero-opacity draw without changing camera or foreground',()=>{
  const state:{visible:string[];camera:number[];focus3D:number[];zoom3D:number;fitVisible3D:boolean;surfaceContext?:SurfaceContext}=
    {visible:['cortex'],camera:[45,-15,2.7],focus3D:[2,4,6],zoom3D:3,fitVisible3D:false}
  const reserved=reserveBrainBackground(state,['cortex','cerebellum','brainstem','brainstem'])
  expect(reserved).toEqual({...state,surfaceContext:{enabled:false,opacity:.15,structure_ids:['cortex','cerebellum','brainstem']}})
  expect(reserved.camera).toBe(state.camera)
  expect(reserved.focus3D).toBe(state.focus3D)
  expect(reserved.visible).toBe(state.visible)
  expect(reserveBrainBackground(reserved,['cortex','cerebellum','brainstem'])).toBe(reserved)
  expect(reserveBrainBackground(state,[])).toBe(state)
  const enabled={...state,surfaceContext:{enabled:true,opacity:.6,structure_ids:['cortex']}}
  expect(reserveBrainBackground(enabled,['cortex','brainstem'])).toEqual({...enabled,surfaceContext:{...enabled.surfaceContext,structure_ids:['cortex','brainstem']}})
  expect(enabled.surfaceContext.structure_ids).toEqual(['cortex'])
})
