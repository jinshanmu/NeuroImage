import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AnatomyHome } from './AnatomyHome'
import type { AtlasEntry, DatasetInfo, DatasetSource } from './types'
import type { AnatomyLibrary, SourceInfo } from './useAnatomyLibrary'

const citation:DatasetSource={id:'source',title:'Original publication',version:'v1',url:'https://example.org/source',citation:'Original source citation.',license_name:'CC0',license_url:'https://example.org/license'}
const info=(label:string,caseId:string|null=null):DatasetInfo=>({description:['Original dataset introduction.'],scope_notes:['Only source-defined anatomy is included.'],space:{name:'Native source space',correspondence:'The original source coordinates are retained.'},representation:'mri-labels',case_id:caseId,case_label:caseId?'Volunteer '+caseId:null,atlas_label:label})
const source=(id:string,datasetInfo:DatasetInfo):SourceInfo=>({id,title:id,sources:[citation],dataset_info:datasetInfo})
const atlas=(item:SourceInfo):AtlasEntry=>({key:item.id+'-exact',dataset_id:item.id,title:item.title,package_version:'exact',space:'Native space',manifest_url:'/atlas/'+item.id+'/manifest.json',base_url:'/atlas/'+item.id+'/',structures:2,dataset_info:item.dataset_info,sources:[{...citation,license_file:'licenses/source.txt'}],coverage:[]})
const render=(selection:string|null,members:SourceInfo[],atlases=members.map(atlas),standalone=false,group:string|null=null)=>{
  const library={snapshot:standalone?null:{session_token:'fixture',sources:members,packages:[],active_job:null},loading:false,error:'',refresh:async()=>{},clearError:()=>{}} as AnatomyLibrary
  return renderToStaticMarkup(createElement(AnatomyHome,{atlases,workspace:!standalone,library,dataset:selection,group,onGroup:()=>{},onDataset:()=>{},onOpen:async()=>{}}))
}

describe('dataset detail navigation',()=>{
  it('shows the introduction and direct complete atlas immediately after choosing a dataset',()=>{
    const member=source('cit168_native',info('Subcortical probabilities and labels'))
    const html=render('family:cit168',[member])
    expect(html).toContain('About this dataset')
    expect(html).toContain('Original dataset introduction.')
    expect(html).toContain('aria-label="Open Complete atlas"')
    expect(html).toContain('Source coverage and coordinates')
    expect(html).toContain('Original source citation.')
    expect(html).toContain('Local license and attribution')
    expect(html.indexOf('Original dataset introduction.')).toBeLessThan(html.indexOf('class="dataset-atlases"'))
    expect(html).not.toContain('class="anatomy-grid"')
    expect(html).not.toContain('dataset-configurations')
    expect(html).not.toContain('Back to anatomy groups')
    expect(html.match(/class="dataset-case"/g)).toHaveLength(1)
  })

  it('groups the eight THU volunteers by their actual case and keeps one complete atlas per case',()=>{
    const members=['001','006','007','009','010','014','021','030'].map(id=>source('thu_mra_case'+id,info('Source MRA and arterial segments',id)))
    const html=render('family:thu_mra',members)
    expect(html.match(/class="dataset-case"/g)).toHaveLength(8)
    expect(html.match(/class="dataset-atlas-button"/g)).toHaveLength(8)
    for(const member of members)expect(html).toContain('Volunteer '+member.dataset_info!.case_id)
    expect(html).not.toContain('Source for Arteries and veins')
  })

  it.each([
    ['family:hcp1065','hcp1065_tracts','hcp1065_prob',null],
    ['family:bigbrain','bigbrain_layers','bigbrain_hippocampus',null],
    ['family:mug500','mug500_healthy','mug500_source_mesh','A0101'],
  ])('keeps two representations of %s in the same atlas or specimen', (selection,first,second,caseId)=>{
    const members=[source(first,info('Original labels',caseId)),source(second,{...info('Author surfaces',caseId),space:{name:'Independent model space',correspondence:'Original independent surface coordinates.'}})]
    const html=render(selection,members)
    expect(html.match(/class="dataset-case"/g)).toHaveLength(1)
    expect(html.match(/class="dataset-atlas-button"/g)).toHaveLength(2)
    expect(html).toContain('Native source space')
    expect(html).toContain('Independent model space')
    expect(html.match(/Original source citation\./g)).toHaveLength(1)
  })

  it('resolves an existing configuration URL to its dataset instead of anatomy groups',()=>{
    const members=[source('bigbrain_layers',info('Layer boundaries')),source('bigbrain_hippocampus',info('Hippocampal surfaces'))]
    const html=render('bigbrain_hippocampus',members)
    expect(html.match(/class="dataset-atlas-button"/g)).toHaveLength(2)
    expect(html).toContain('<h1>BigBrain</h1>')
    expect(html).not.toContain('class="anatomy-grid"')
    expect(html).not.toContain('Back to anatomy groups')
  })

  it('provides the same source introduction in the standalone viewer without workspace APIs',()=>{
    const member=source('cerebra',info('Template MRI and source labels'))
    const html=render('family:cerebra',[],[atlas(member)],true)
    expect(html).toContain('Original dataset introduction.')
    expect(html).toContain('Original source citation.')
    expect(html).toContain('aria-label="Open Complete atlas"')
    expect(html).not.toContain('Download and build')
  })

  it('retains an unbuilt case and its introduction without inventing a ready atlas',()=>{
    const member=source('thu_mra_case001',info('Source MRA','001'))
    const html=render('family:thu_mra',[member],[])
    expect(html).toContain('Original dataset introduction.')
    expect(html).toContain('Atlas is not available locally.')
    expect(html).not.toContain('Download and build')
    expect(html).not.toContain('Back to anatomy groups')
    expect(html).not.toContain('class="dataset-atlas-button"')
  })

  it('retains complete references when an older library snapshot contains only source identity fields',()=>{
    const member=source('cerebra',info('Source atlas'))
    const legacy={...atlas(member),sources:[{id:'source',version:'v1',license_name:'CC0'}] as DatasetSource[]}
    const html=render('family:cerebra',[member],[legacy])
    expect(html).toContain('Original source citation.')
    expect(html).toContain('https://example.org/source')
    expect(html).not.toContain('href="undefined"')
  })

  it.each([
    ['workspace ready',false,true],
    ['standalone ready',true,true],
    ['workspace unbuilt',false,false],
    ['standalone unavailable',true,false],
  ] as const)('has no installation controls or group-back button in %s dataset views',(_,standalone,ready)=>{
    const member=source('cerebra',info('Template MRI and source labels'))
    const html=render('family:cerebra',[member],ready?[atlas(member)]:[],standalone)
    expect(html).not.toContain('Download and build')
    expect(html).not.toContain('dataset-manage-button')
    expect(html).not.toContain('Back to anatomy groups')
    expect(html.includes('class="dataset-atlas-button"')).toBe(ready)
    if(ready||!standalone){
      expect(html).toContain('Original dataset introduction.')
      expect(html).toContain('Original source citation.')
    }
    if(!ready)expect(html).toContain(standalone?'This dataset is not available':'Atlas is not available locally.')
  })

  it('retains back navigation for a detailed anatomy group',()=>{
    const member=source('cerebra',info('Source atlas'))
    const ready={...atlas(member),detail_coverage:[{id:'detail-central-cortex',title:'Central and adjacent cortical regions',evidence:'Fixture',structure_ids:['cortex']}]}
    const html=render(null,[member],[ready],false,'cerebral-cortex')
    expect(html).toContain('DETAILED ANATOMY')
    expect(html).toContain('Central and adjacent cortical regions')
    expect(html.match(/Back to anatomy groups/g)).toHaveLength(1)
    expect(html).not.toContain('class="dataset-detail"')
  })

  it('describes an empty local library without installation instructions',()=>{
    const html=render(null,[],[])
    expect(html).toContain('No local atlases available')
    expect(html).toContain('No atlas is currently available in the local library.')
    expect(html).not.toContain('Build your first local atlas')
    expect(html).not.toContain('download and construction tools')
    expect(html).not.toContain('Back to anatomy groups')
  })

  it('retains a built representation’s local license when its sibling uses the same publication and is unbuilt',()=>{
    const ready=source('mug500_healthy',info('Original skull mask','A0101'))
    const unbuilt=source('mug500_source_mesh',info('Author-cleaned skull surface','A0101'))
    const html=render('family:mug500',[ready,unbuilt],[atlas(ready)])
    expect(html.match(/Original source citation\./g)).toHaveLength(1)
    expect(html).toContain('href="/atlas/mug500_healthy/licenses/source.txt"')
    expect(html).toContain('Local license and attribution')
    expect(html.match(/class="dataset-atlas-button"/g)).toHaveLength(1)
  })

  it('keeps the main anatomy route grouped by anatomy',()=>{
    const member=source('cerebra',info('Source atlas'))
    const ready={...atlas(member),coverage:[{id:'general-anatomy',title:'Whole brain',evidence:'Fixture',structure_ids:['cortex','nuclei']}]}
    const html=render(null,[member],[ready])
    expect(html).toContain('class="anatomy-grid"')
    expect(html).toContain('Source for Whole brain')
    expect(html).not.toContain('class="dataset-detail"')
  })

  it.each([
    ['mida','mida_complete','family:mida'],['z_anatomy','z_anatomy_complete','family:z_anatomy'],
  ])('does not reinsert a registered historical %s parallel package into normal dataset entries', (canonical, retired, selection) => {
    const member=source(canonical,info('Canonical source'))
    const historical=source(retired,info('Retired parallel source'))
    // The retired target can remain in /api/atlases after an exact bookmark opens it.
    for(const members of [[member],[member,historical]]) {
      const html=render(selection,members,[atlas(member),atlas(historical)])
      expect(html.match(/class="dataset-atlas-button"/g)).toHaveLength(1)
      expect(html).toContain('Canonical source')
      expect(html).not.toContain('Retired parallel source')
    }
    expect(render(retired,[member,historical])).toContain('Canonical source')
  })

  it.each([
    ['family:spl_nac','spl_nac','spl_nac_sulci'],
    ['family:brainstem_navigator','brainstem_navigator_mni','brainstem_navigator_iit'],
  ])('retains both native representations in one %s library case', (selection, first, second) => {
    const members=[source(first,info('Original source')),source(second,info('Independent native representation'))]
    const html=render(selection,members)
    expect(html.match(/class="dataset-case"/g)).toHaveLength(1)
    expect(html.match(/class="dataset-atlas-button"/g)).toHaveLength(2)
    expect(html).toContain('Independent native representation')
    expect(html).not.toContain('2 cases')
  })
})
