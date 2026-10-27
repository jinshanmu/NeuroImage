import { expect, it } from 'vitest'
import { ANATOMY_GROUPS, ANATOMY_TOPICS, anatomyGroup, browseTargets, groupTargets, sourceCoverageNote, targetScope, viewerComparisonTargets, viewerSourceTargets } from './anatomyNavigation'
import type { AnatomyScope } from './anatomyNavigation'
import type { AtlasEntry } from './types'
import { sourceMenuId } from './sourceBrowse'

const viewerAtlas = (dataset:string, change:Partial<AtlasEntry>={}):AtlasEntry => ({
  key:dataset+'-exact',dataset_id:dataset,title:dataset,package_version:'exact',space:'Native source space',
  manifest_url:'/atlas/'+dataset+'/manifest.json',base_url:'/atlas/'+dataset+'/',structures:1,...change,
})
const viewerScope = (id:string):AnatomyScope => ({id,title:id,structure_ids:[]})

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

it('rejects whole-brain routes for sources with only regional or image coverage',()=>{
  const whole=ANATOMY_GROUPS.find(group=>group.id==='general-anatomy')!
  const cortex=ANATOMY_GROUPS.find(group=>group.id==='cerebral-cortex')!
  const targets=browseTargets([], [
    {key:'whole',dataset_id:'cerebra',title:'CerebrA',status:'available',coverage:[{id:whole.id,structure_ids:['cortex','deep','ventricle','brainstem','cerebellum']}]},
    {key:'block',dataset_id:'synthetic_regional',title:'Regional source fixture',status:'available',coverage:[{id:cortex.id,structure_ids:['local-cortex']}]},
    {key:'image',dataset_id:'synthetic_image',title:'Synthetic MRI without labels',status:'available',coverage:[{id:cortex.id,structure_ids:[]}]},
  ])
  expect(groupTargets(whole,targets).map(target=>target.key)).toEqual(['whole'])
  for(const target of targets.slice(1))expect(()=>targetScope(whole,target)).toThrow('whole-brain atlas')
  expect(targetScope(cortex,targets[1]).structure_ids).toEqual(['local-cortex'])
  expect(targetScope(cortex,targets[2]).structure_ids).toEqual([])
})

it('retains the actual source coverage note through combined CSF navigation',()=>{
  const group=ANATOMY_GROUPS.find(group=>group.id==='ventricles')!
  const target=browseTargets([], [{key:'source',dataset_id:'mida',title:'MIDA',status:'available',coverage:[
    {id:'ventricles',structure_ids:['ventricular-csf'],coverage_note:'A single ventricular CSF class.'},
    {id:'cisternal-regions',structure_ids:['ventricular-csf','subarachnoid-csf'],coverage_note:'No named individual cisterns.'},
  ]}])[0]
  expect(sourceCoverageNote(group,target)).toBe('A single ventricular CSF class. No named individual cisterns.')
  expect(targetScope(group,target)).toMatchObject({structure_ids:['ventricular-csf','subarachnoid-csf'],coverage_note:sourceCoverageNote(group,target)})
})

it('keeps individual cortical blocks in detailed discovery without offering a whole regional source',()=>{
  const group=ANATOMY_GROUPS.find(group=>group.id==='cerebral-cortex')!
  const topic=ANATOMY_TOPICS.find(topic=>topic.id==='detail-regional-cortical-labels')!
  const target=browseTargets([], [{key:'block',dataset_id:'synthetic_regional',title:'Regional source fixture',status:'available',coverage:[],
    detail_coverage:[{id:topic.id,structure_ids:['local-cortex'],coverage_note:'Partial histological tissue block.'}]}])[0]
  expect(groupTargets(group,[target])).toEqual([])
  expect(groupTargets(topic,[target])).toEqual([target])
  expect(targetScope(topic,target).coverage_note).toBe('Partial histological tissue block.')
  expect(()=>targetScope(group,target)).toThrow('anatomical group')
})

it('carries the actual subject separately from related context into the workspace',()=>{
  const topic=ANATOMY_TOPICS.find(topic=>topic.id==='detail-cn-visual')!
  const target=browseTargets([], [{key:'model',dataset_id:'source',title:'Source',status:'available',detail_coverage:[
    {id:topic.id,structure_ids:['pathway','downstream-context'],primary_structure_ids:['pathway']},
  ]}])[0]
  expect(targetScope(topic,target)).toMatchObject({structure_ids:['pathway','downstream-context'],primary_structure_ids:['pathway']})
})

it('limits the whole-brain viewer to its three genuinely covered sources',()=>{
  const atlases=['spl_nac','cerebra','mida'].map(dataset=>viewerAtlas(dataset,{
    coverage:[{id:'general-anatomy',title:'Whole brain',evidence:'Fixture',structure_ids:['brain']}],
  }))
  atlases.push(viewerAtlas('cit168_native',{coverage:[{id:'deep-nuclei',title:'Deep nuclei',evidence:'Fixture',structure_ids:['nucleus']}]}))
  atlases.push(viewerAtlas('bigbrain_hippocampus',{detail_coverage:[{id:'detail-medial-temporal',title:'Medial temporal',evidence:'Fixture',structure_ids:['hippocampus']}]}))
  const choices=viewerSourceTargets(atlases,undefined,'spl_nac-exact',viewerScope('general-anatomy'))
  expect(choices.map(target=>target.dataset_id)).toEqual(['spl_nac','cerebra','mida'])
})

it('uses the exact detailed topic rather than its broader parent category',()=>{
  const topic='detail-cn-visual'
  const model=viewerAtlas('z_anatomy',{detail_coverage:[{id:topic,title:'Visual nerve',evidence:'Fixture',structure_ids:['optic-nerve']}]})
  const root=viewerAtlas('mida',{coverage:[{id:'cranial-nerves',title:'Cranial nerves',evidence:'Fixture',structure_ids:['other-nerve']}]})
  const records=[{key:'tracts-ready',dataset_id:'hcp1065_tracts',title:'HCP visual trajectories',package_version:'ready',status:'available',
    detail_coverage:[{id:topic,structure_ids:['visual-trajectory']}]},
    {key:'incomplete',dataset_id:'synthetic_incomplete',title:'Incomplete visual source',status:'incomplete',
      detail_coverage:[{id:topic,structure_ids:['incomplete']}]},
    {key:'failed',dataset_id:'synthetic_failed',title:'Failed visual source',status:'failed',
      detail_coverage:[{id:topic,structure_ids:['failed']}]}]
  const choices=viewerSourceTargets([model,root],records,model.key,viewerScope(topic))
  expect(choices.map(target=>target.dataset_id)).toEqual(['z_anatomy','hcp1065_tracts'])
  expect(targetScope(anatomyGroup(topic)!,choices[1]).structure_ids).toEqual(['visual-trajectory'])
})

it('retains the combined CSF group when a saved route uses its cisternal alias',()=>{
  const atlases=[
    viewerAtlas('spl_nac',{coverage:[{id:'cisternal-regions',title:'Cisternal observation',evidence:'Fixture',structure_ids:[]}]}),
    viewerAtlas('mida',{coverage:[{id:'ventricles',title:'Ventricular CSF',evidence:'Fixture',structure_ids:['ventricular-csf']}]}),
    viewerAtlas('cerebra',{coverage:[{id:'deep-nuclei',title:'Deep nuclei',evidence:'Fixture',structure_ids:['nucleus']}]}),
  ]
  const choices=viewerSourceTargets(atlases,[],atlases[0].key,viewerScope('cisternal-regions'))
  expect(choices.map(target=>target.dataset_id)).toEqual(['spl_nac','mida'])
})

it('shows only family representations without a scope and does not require anatomical coverage',()=>{
  const layers=viewerAtlas('bigbrain_layers'),hippocampus=viewerAtlas('bigbrain_hippocampus')
  const unrelated=viewerAtlas('mida')
  const records=[{key:'hippocampus-newest',dataset_id:hippocampus.dataset_id,title:'BigBrain hippocampus',package_version:'newest',
    status:'available',created_utc:'2026-10-24'},
    {key:'layers-incomplete',dataset_id:layers.dataset_id,title:'BigBrain layers',status:'incomplete',created_utc:'2026-10-25'}]
  const choices=viewerSourceTargets([layers,hippocampus,unrelated],records,layers.key)
  expect(choices.map(target=>target.key).sort()).toEqual([layers.key,'hippocampus-newest'].sort())
  expect(choices).toHaveLength(2)
})

it('keeps all eight THU cases in one unscoped family and unknown families within their dataset',()=>{
  const cases=['001','006','007','009','010','014','021','030'].map(id=>viewerAtlas('thu_mra_case'+id))
  const atlases=[...cases,viewerAtlas('spl_nac'),viewerAtlas('unknown_a'),viewerAtlas('unknown_b'),viewerAtlas('bigbrain'),viewerAtlas('bigbrain_layers')]
  expect(viewerSourceTargets(atlases,[],cases[0].key).map(target=>target.dataset_id)).toEqual(cases.map(target=>target.dataset_id))
  expect(viewerSourceTargets(atlases,[],'unknown_a-exact').map(target=>target.dataset_id)).toEqual(['unknown_a'])
  expect(viewerSourceTargets(atlases,[],'bigbrain-exact').map(target=>target.dataset_id)).toEqual(['bigbrain'])
})

it.each([undefined,viewerScope('general-anatomy')])('retains one selected exact old package per dataset for scope %s',scope=>{
  const coverage=[{id:'general-anatomy',title:'Whole brain',evidence:'Fixture',structure_ids:['brain']}]
  const selected=viewerAtlas('spl_nac',{key:'selected-old',created_utc:'2026-01-01',coverage})
  const other=viewerAtlas(scope?'cerebra':'spl_nac',{key:'registered-other',created_utc:'2026-02-01',coverage})
  const records=[
    {key:'spl-newest',dataset_id:'spl_nac',title:'SPL newest',package_version:'newest',status:'available',created_utc:'2026-10-24',coverage},
    {key:'cerebra-newest',dataset_id:'cerebra',title:'CerebrA newest',package_version:'newest',status:'available',created_utc:'2026-10-24',coverage},
  ]
  const choices=viewerSourceTargets([selected,other],records,selected.key,scope)
  expect(choices.find(target=>target.dataset_id==='spl_nac')?.key).toBe(selected.key)
  expect(choices.filter(target=>target.dataset_id==='spl_nac')).toHaveLength(1)
  expect(choices.some(target=>target.key==='spl-newest')).toBe(false)
  if(scope)expect(choices.find(target=>target.dataset_id==='cerebra')?.key).toBe('cerebra-newest')
  else expect(choices.map(target=>target.key)).toEqual([selected.key])
})

it('does not offer other sources for an unknown scope or a stale current package scope',()=>{
  const active=viewerAtlas('spl_nac',{coverage:[{id:'general-anatomy',title:'Whole brain',evidence:'Fixture',structure_ids:['brain']}]})
  const other=viewerAtlas('cerebra',{coverage:[{id:'cerebral-cortex',title:'Cortex',evidence:'Fixture',structure_ids:['cortex']}]})
  for(const scope of [viewerScope('unknown-topic'),viewerScope('cerebral-cortex')])
    expect(viewerSourceTargets([active,other],[],active.key,scope).map(target=>target.key)).toEqual([active.key])
  expect(viewerSourceTargets([active,other],[],'missing-key',viewerScope('general-anatomy'))).toEqual([])
})

it.each([
  ['cerebra',['spl_nac','mida']],
  ['spl_nac',['cerebra','mida']],
  ['mida',['spl_nac','cerebra']],
] as const)('compares whole-brain %s only with the other covered source datasets',(primary,expected)=>{
  const coverage=[{id:'general-anatomy',title:'Whole brain',evidence:'Fixture',structure_ids:['brain']}]
  const atlases=['spl_nac','cerebra','mida'].map(dataset=>viewerAtlas(dataset,{coverage}))
  atlases.push(viewerAtlas('cit168_native',{coverage:[{id:'deep-nuclei',title:'Nuclei',evidence:'Fixture',structure_ids:['nucleus']}]}))
  const records=[{key:primary+'-another-version',dataset_id:primary,title:'Another primary revision',status:'available',
    package_version:'another',created_utc:'2026-10-24',coverage}]
  const choices=viewerComparisonTargets(atlases,records,primary+'-exact',viewerScope('general-anatomy'))
  expect(choices.map(target=>target.dataset_id)).toEqual(expected)
  expect(choices.some(target=>target.dataset_id===primary)).toBe(false)
})

it('does not expand detailed comparison choices to sources with only parent-group coverage',()=>{
  const topic='detail-cn-visual'
  const detail=[{id:topic,title:'Visual nerve',evidence:'Fixture',structure_ids:['visual-subject']}]
  const primary=viewerAtlas('z_anatomy',{detail_coverage:detail})
  const trajectory=viewerAtlas('hcp1065_tracts',{detail_coverage:detail})
  const parentOnly=viewerAtlas('mida',{coverage:[{id:'cranial-nerves',title:'Nerves',evidence:'Fixture',structure_ids:['nerve']} ]})
  expect(viewerComparisonTargets([primary,trajectory,parentOnly],[],primary.key,viewerScope(topic))
    .map(target=>target.key)).toEqual([trajectory.key])
})

it('compares unscoped BigBrain representations and THU cases within their own family',()=>{
  const layers=viewerAtlas('bigbrain_layers'),hippocampus=viewerAtlas('bigbrain_hippocampus')
  const cases=['001','006','007','009','010','014','021','030'].map(id=>viewerAtlas('thu_mra_case'+id))
  const atlases=[layers,hippocampus,...cases,viewerAtlas('mida')]
  expect(viewerComparisonTargets(atlases,undefined,layers.key).map(target=>target.key)).toEqual([hippocampus.key])
  for(const primary of [cases[0],cases[1]])
    expect(viewerComparisonTargets(atlases,[],primary.key).map(target=>target.key))
      .toEqual(cases.filter(target=>target.dataset_id!==primary.dataset_id).map(target=>target.key))
})

it('preserves an eligible exact old comparison package without duplicating its source',()=>{
  const coverage=[{id:'general-anatomy',title:'Whole brain',evidence:'Fixture',structure_ids:['brain']}]
  const primary=viewerAtlas('cerebra',{coverage})
  const records=[
    {key:'spl-old-comparison',dataset_id:'spl_nac',title:'SPL old',package_version:'old',status:'available',created_utc:'2026-01-01',coverage},
    {key:'spl-latest',dataset_id:'spl_nac',title:'SPL latest',package_version:'latest',status:'available',created_utc:'2026-10-24',coverage},
    {key:'mida-latest',dataset_id:'mida',title:'MIDA',package_version:'latest',status:'available',coverage},
  ]
  const normal=viewerComparisonTargets([primary],records,primary.key,viewerScope('general-anatomy'))
  expect(normal.map(target=>target.key)).toEqual(['spl-latest','mida-latest'])
  const exact=viewerComparisonTargets([primary],records,primary.key,viewerScope('general-anatomy'),'spl-old-comparison')
  expect(exact.map(target=>target.key)).toEqual(['spl-old-comparison','mida-latest'])
  expect(new Set(exact.map(target=>target.dataset_id)).size).toBe(exact.length)
  expect(exact[0].active).toBe(false)
})

it('does not retain an old comparison revision that lacks the actual detailed subject scope',()=>{
  const topic='detail-cn-visual'
  const detail=[{id:topic,title:'Visual nerve',evidence:'Fixture',structure_ids:['visual-subject']}]
  const primary=viewerAtlas('z_anatomy',{detail_coverage:detail})
  const old=viewerAtlas('hcp1065_tracts',{key:'old-parent-only',created_utc:'2026-01-01',
    coverage:[{id:'cranial-nerves',title:'Nerves',evidence:'Fixture',structure_ids:['unrelated-nerve']}]})
  const unrelated=viewerAtlas('cit168_native',{coverage:[{id:'deep-nuclei',title:'Nuclei',evidence:'Fixture',structure_ids:['nucleus']}]})
  const records=[{key:'latest-visual',dataset_id:old.dataset_id,title:'HCP visual',status:'available',package_version:'latest',
    created_utc:'2026-10-24',detail_coverage:detail}]
  for(const comparisonKey of [old.key,unrelated.key,primary.key,'missing-key'])
    expect(viewerComparisonTargets([primary,old,unrelated],records,primary.key,viewerScope(topic),comparisonKey)
      .map(target=>target.key)).toEqual(['latest-visual'])
})

it('retains an exact comparison through the combined CSF alias without inventing cistern labels',()=>{
  const primary=viewerAtlas('spl_nac',{coverage:[{id:'cisternal-regions',title:'Cisternal observation',evidence:'Fixture',structure_ids:[]}]})
  const old=viewerAtlas('mida',{key:'old-ventricles',created_utc:'2026-01-01',
    coverage:[{id:'ventricles',title:'Ventricular CSF',evidence:'Fixture',structure_ids:['ventricular-csf']}]})
  const records=[{key:'new-ventricles',dataset_id:'mida',title:'MIDA',status:'available',created_utc:'2026-10-24',coverage:old.coverage}]
  const choices=viewerComparisonTargets([primary,old],records,primary.key,viewerScope('cisternal-regions'),old.key)
  expect(choices.map(target=>target.key)).toEqual([old.key])
  expect(targetScope(anatomyGroup('cisternal-regions')!,choices[0]).structure_ids).toEqual(['ventricular-csf'])
})

it('has no comparison candidates for unknown or stale scopes, missing primaries or one-source families',()=>{
  const primary=viewerAtlas('cerebra',{coverage:[{id:'general-anatomy',title:'Whole brain',evidence:'Fixture',structure_ids:['brain']}]})
  const other=viewerAtlas('mida',{coverage:[{id:'cerebral-cortex',title:'Cortex',evidence:'Fixture',structure_ids:['cortex']}]})
  for(const scope of [viewerScope('unknown-topic'),viewerScope('cerebral-cortex')])
    expect(viewerComparisonTargets([primary,other],[],primary.key,scope,other.key)).toEqual([])
  expect(viewerComparisonTargets([primary,other],[],'missing-primary',viewerScope('general-anatomy'),other.key)).toEqual([])
  const old=viewerAtlas('cerebra',{key:'old-same-dataset'})
  expect(viewerComparisonTargets([primary,old,other],[],primary.key,undefined,old.key)).toEqual([])
  expect(viewerComparisonTargets([primary,old,other],[],primary.key,viewerScope('general-anatomy'),old.key)).toEqual([])
})

const sharedCoverage=[{id:'general-anatomy',title:'Whole brain',evidence:'Fixture',structure_ids:['brain']}]

it.each([
  ['mida','mida_complete'],['z_anatomy','z_anatomy_complete'],['spl_nac','spl_nac_complete'],
  ['spl_nac','spl_nac_sulci'],['brainstem_navigator_mni','brainstem_navigator_iit'],
])('keeps one normal Source slot for %s and the selected exact %s package', (canonical, variant) => {
  const current=viewerAtlas(canonical,{key:'canonical-current',created_utc:'2026-01-01',coverage:sharedCoverage})
  const historical=viewerAtlas(variant,{key:'variant-exact',created_utc:'2026-02-01',coverage:sharedCoverage})
  const group=anatomyGroup('general-anatomy')!
  expect(groupTargets(group,browseTargets([current,historical])).map(item=>item.key)).toEqual([current.key])
  for(const scope of [undefined,viewerScope(group.id)]) {
    expect(viewerSourceTargets([current,historical],[],current.key,scope).map(item=>item.key)).toEqual([current.key])
    const exact=viewerSourceTargets([current,historical],[],historical.key,scope)
    expect(exact.map(item=>item.key)).toEqual([historical.key])
    expect(exact[0].dataset_id).toBe(variant)
    expect(viewerComparisonTargets([current,historical],[],historical.key,scope,current.key)).toEqual([])
  }
})

it('keeps an exact retired package accessible when no current canonical package has been built',()=>{
  const old=viewerAtlas('mida_complete',{coverage:sharedCoverage})
  const other=viewerAtlas('cerebra',{coverage:sharedCoverage})
  expect(groupTargets(anatomyGroup('general-anatomy')!,browseTargets([old,other])).map(item=>item.key)).toEqual([other.key])
  expect(viewerSourceTargets([old,other],[],old.key,viewerScope('general-anatomy')).map(item=>item.key)).toEqual([other.key,old.key])
  expect(viewerSourceTargets([old],[],old.key).map(item=>item.key)).toEqual([old.key])
  expect(viewerComparisonTargets([other,old],[],other.key,viewerScope('general-anatomy'),old.key).map(item=>item.key)).toEqual([old.key])
})

it('keeps native auxiliary representations as a normal source when they alone cover the detailed topic',()=>{
  const id='detail-central-cortex'
  const main=viewerAtlas('spl_nac',{coverage:sharedCoverage})
  const sulci=viewerAtlas('spl_nac_sulci',{detail_coverage:[{id,title:id,evidence:'Fixture',structure_ids:['native-sulcus']}]})
  expect(groupTargets(anatomyGroup(id)!,browseTargets([main,sulci])).map(item=>item.key)).toEqual([sulci.key])
  expect(viewerSourceTargets([main,sulci],[],sulci.key,viewerScope(id)).map(item=>sourceMenuId(item.dataset_id))).toEqual(['spl_nac'])
})

it('preserves an eligible exact historical comparison in its canonical source slot',()=>{
  const primary=viewerAtlas('cerebra',{coverage:sharedCoverage})
  const current=viewerAtlas('mida',{coverage:sharedCoverage})
  const old=viewerAtlas('mida_complete',{coverage:sharedCoverage})
  const choices=viewerComparisonTargets([primary,current,old],[],primary.key,viewerScope('general-anatomy'),old.key)
  expect(choices.map(item=>item.key)).toEqual([old.key])
})

it.each([
  ['hcp1065_tracts','hcp1065_prob'],['bigbrain_layers','bigbrain_hippocampus'],
  ['mug500_healthy','mug500_source_mesh'],['mug500_healthy_a0031','mug500_source_mesh_a0031'],
])('retains original distinct %s and %s source representations', (first, second) => {
  const atlases=[viewerAtlas(first),viewerAtlas(second)]
  expect(viewerSourceTargets(atlases,[],atlases[0].key).map(item=>item.key).sort()).toEqual(atlases.map(item=>item.key).sort())
  expect(viewerComparisonTargets(atlases,[],atlases[0].key).map(item=>item.key)).toEqual([atlases[1].key])
})
