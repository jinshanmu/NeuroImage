import { expect, it } from 'vitest'
import { ANATOMY_GROUPS, ANATOMY_TOPICS, anatomyGroup, browseTargets, groupTargets, targetScope } from './anatomyNavigation'

it('opens the newest complete source with actual group coverage and retains exact package keys',()=>{
  const group=ANATOMY_GROUPS.find(group=>group.id==='cranial-nerves')!
  const records=[
    {key:'old',dataset_id:'mida',title:'MIDA',status:'available',created_utc:'2026-01-01',coverage:[{id:group.id,structure_ids:['cn1']}]},
    {key:'current',dataset_id:'mida',title:'MIDA',status:'available',created_utc:'2026-02-01',coverage:[{id:group.id,structure_ids:['cn1','cn2']}]},
    {key:'partial',dataset_id:'mida',title:'MIDA',status:'incomplete',created_utc:'2026-03-01',coverage:[{id:group.id}]},
    {key:'unrelated',dataset_id:'other',title:'Other',status:'available',coverage:[{id:'ventricles'}]},
  ]
  const choices=groupTargets(group,browseTargets([],records))
  expect(choices.map(item=>item.key)).toEqual(['current'])
  expect(targetScope(group,choices[0]).structure_ids).toEqual(['cn1','cn2'])
})

it('keeps detailed source scope and shared URLs separate from the ten main groups',()=>{
  expect(ANATOMY_GROUPS).toHaveLength(10)
  const topic=ANATOMY_TOPICS.find(topic=>topic.id==='detail-inner-ear')!
  expect(anatomyGroup(topic.id)).toEqual(topic)
  const targets=browseTargets([], [
    {key:'old',dataset_id:'source',title:'Original version',status:'available',coverage:[{id:'skull-base-context',structure_ids:['bone']}]},
    {key:'ct',dataset_id:'source',title:'CT',status:'available',detail_coverage:[{id:topic.id,structure_ids:['cochlea','vestibule','canals']}]},
  ])
  expect(groupTargets(topic,targets).map(target=>target.key)).toEqual(['ct'])
  expect(targetScope(topic,targets[1]).structure_ids).toEqual(['cochlea','vestibule','canals'])
  expect(()=>targetScope(topic,targets[0])).toThrow('does not supply')
})
