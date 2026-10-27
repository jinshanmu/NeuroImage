import { datasetFamilies, datasetOptionName, familySelection, selectedFamilyId } from './datasetFamilies'
import { DatasetDetail } from './DatasetDetail'
import { SelectField } from './SelectField'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ANATOMY_GROUPS, ANATOMY_TOPICS, browseTargets, groupTargets, targetScope } from './anatomyNavigation'
import type { AnatomyScope, BrowseGroup, BrowseTarget } from './anatomyNavigation'
import type { AtlasEntry } from './types'
import type { AnatomyLibrary, SourceInfo } from './useAnatomyLibrary'
import { canonicalBrowseSourceId, sourceIsBrowsable } from './sourceBrowse'

interface Props {
  atlases:AtlasEntry[]; workspace:boolean; library:AnatomyLibrary; dataset:string|null;
  group:string|null; onGroup:(group:string|null)=>void;
  onDataset:(dataset:string|null)=>void;
  onOpen:(key:string,structureId?:string,scope?:AnatomyScope,signal?:AbortSignal)=>Promise<void>;
}
function GroupCard({group,targets,busy,open,onExplore,topicCount=0}: {group:BrowseGroup;targets:BrowseTarget[];busy:boolean;open:(target:BrowseTarget,group:BrowseGroup)=>void;onExplore?:()=>void;topicCount?:number}) {
  const choices=groupTargets(group,targets), [choice,setChoice]=useState('')
  const target=choices.find(item=>item.dataset_id===choice)??choices[0]
  const regionalTopicsOnly=!target&&!!onExplore&&topicCount>0
  return <article className={'anatomy-card '+(group.id==='general-anatomy'?'whole-brain-card':'')}>
    <button className="anatomy-entry" disabled={busy||(!target&&!regionalTopicsOnly)} onClick={()=>target?open(target,group):onExplore?.()} aria-label={'Browse '+group.title}>
      <span className="anatomy-symbol" aria-hidden="true">{group.id==='general-anatomy'?'◎':'○'}</span>
      <span>{group.kind==='variation'&&<span className="topic-kind">VARIATION</span>}<h2>{group.title}</h2></span><span className="entry-arrow" aria-hidden="true">↗</span>
    </button>
    <div className="anatomy-source">{target?<><label><span className="sr-only">Source for {group.title}</span><SelectField aria-label={'Source for '+group.title} value={target.dataset_id} onChange={event=>setChoice(event.target.value)} disabled={busy}>{choices.map(item=><option key={item.key} value={item.dataset_id}>{datasetOptionName(item)}</option>)}</SelectField></label><small>{choices.length} {choices.length===1?'source':'sources'}</small></>:<small>{regionalTopicsOnly?'Regional topics only':'No local atlas available'}</small>}</div>
    {onExplore&&topicCount>0&&<button className="anatomy-detail-link" disabled={busy} onClick={onExplore} aria-label={'Explore details for '+group.title}>Detailed anatomy <span>{topicCount} {topicCount===1?'topic':'topics'} →</span></button>}
  </article>
}

export function AnatomyHome({atlases,workspace,library,dataset,group,onGroup,onDataset,onOpen}:Props) {
  const {snapshot,loading}=library
  const [error,setError]=useState(''), [opening,setOpening]=useState('')
  const openingRequest=useRef<AbortController|null>(null)
  useEffect(()=>()=>openingRequest.current?.abort(),[])
  useEffect(()=>{openingRequest.current?.abort();setOpening('');window.scrollTo(0,0)},[dataset])
  const refresh=()=>{setError('');void library.refresh(true)}
  const targets=useMemo(()=>browseTargets(atlases,snapshot?.packages).filter(target=>sourceIsBrowsable(target.dataset_id)),[atlases,snapshot])
  const sourceMap=new Map<string,SourceInfo>((snapshot?.sources??[]).filter(source=>sourceIsBrowsable(source.id)).map(source=>[source.id,source]))
  for(const item of targets)if(!sourceMap.has(item.dataset_id))sourceMap.set(item.dataset_id,{id:item.dataset_id,title:item.title,sources:item.sources??[],dataset_info:item.dataset_info})
  const readyDatasets=new Set(targets.map(target=>target.dataset_id))
  const sources=[...sourceMap.values()].sort((a,b)=>Number(readyDatasets.has(b.id))-Number(readyDatasets.has(a.id))||a.title.localeCompare(b.title))
  const canonicalDataset=dataset?canonicalBrowseSourceId(dataset):dataset
  const selected=sources.find(item=>item.id===canonicalDataset)
  const families=datasetFamilies(sources).sort((a,b)=>Number(b.members.some(source=>readyDatasets.has(source.id)))-Number(a.members.some(source=>readyDatasets.has(source.id)))||a.title.localeCompare(b.title))
  const canShowEmpty=!loading&&!library.error&&(!workspace||snapshot!==null)
  const family=families.find(item=>item.id===selectedFamilyId(dataset))
  const parentFamily=families.find(item=>item.members.some(source=>source.id===canonicalDataset))
  const datasetFamily=family??parentFamily
  const displayed=targets
  const region=!dataset?ANATOMY_GROUPS.find(item=>item.id===group||item.coverageIds?.includes(group??'')):undefined
  const availableTopics=ANATOMY_TOPICS.filter(topic=>groupTargets(topic,displayed).length)
  const groups=region?availableTopics.filter(topic=>topic.parentId===region.id):ANATOMY_GROUPS.filter(group=>groupTargets(group,displayed).length||(dataset&&availableTopics.some(topic=>topic.parentId===group.id)))
  async function open(target:BrowseTarget,group?:BrowseGroup) {
    openingRequest.current?.abort()
    const controller=new AbortController();openingRequest.current=controller
    setError('');setOpening(group?.title??target.title)
    try {
      let key=target.key
      if(!target.active) {
        // The bookmark endpoint performs the same exact-package verification
        // directly, without starting a worker and polling an activation job.
        const response=await fetch('/api/workspace/atlases/'+encodeURIComponent(key),{signal:controller.signal})
        const result=await response.json()
        if(!response.ok)throw Error(result.error??'The local atlas could not be opened.')
        key=result.atlas_key
      }
      controller.signal.throwIfAborted()
      await onOpen(key,undefined,group?targetScope(group,target):undefined,controller.signal)
    } catch(error){if(!controller.signal.aborted)setError(String(error))} finally{if(openingRequest.current===controller)setOpening('')}
  }
  return <main className="anatomy-home" aria-busy={!!opening}>
    <section className="anatomy-main" aria-label="Browse anatomy">
      <div className="anatomy-home-heading">{(region||dataset)&&<div className="eyebrow">{region?'DETAILED ANATOMY':'DATASET'}</div>}<h1>{region?.title??datasetFamily?.title??selected?.title??(dataset??'Browse anatomy')}</h1>{!dataset&&region&&<p>Choose a topic and source.</p>}{region&&<button onClick={()=>onGroup(null)}>Back to anatomy groups</button>}</div>
      {(error||library.error)&&<div className="error" role="alert">{error||library.error}<button onClick={refresh}>Refresh sources</button><button onClick={()=>{setError('');library.clearError()}}>Dismiss</button></div>}
      {loading&&!opening&&<p role="status">Loading</p>}
      {opening&&<p role="status">Opening atlas…</p>}
      {dataset&&datasetFamily&&<DatasetDetail family={datasetFamily} targets={targets} busy={!!opening||loading} onOpen={target=>void open(target)}/>}
      {dataset&&!datasetFamily&&canShowEmpty&&<p className="empty-library">This dataset is not available in the current source library.</p>}
      {!dataset&&<div className="anatomy-grid">{groups.map(group=><GroupCard key={'all'+group.id} group={group} targets={displayed} busy={!!opening||loading} open={(target,group)=>void open(target,group)} onExplore={region?undefined:()=>onGroup(group.id)} topicCount={availableTopics.filter(topic=>topic.parentId===group.id).length}/>)}</div>}
      {region&&!groups.length&&canShowEmpty&&<p className="empty-library">No detailed topics are available for this source selection.<button onClick={()=>onGroup(null)}>Back to anatomy groups</button></p>}
      {!dataset&&!region&&!groups.length&&canShowEmpty&&<div className="home-empty"><h2>{targets.length?'Open a source package':'No local atlases available'}</h2><p>{targets.length?'Your ready packages are listed below. Each opens in its own source space.':'No atlas is currently available in the local library.'}</p><div className="button-row">{targets.map(target=><button key={target.key} disabled={!!opening} onClick={()=>void open(target)}>{target.title}</button>)}</div></div>}
    </section>
    <aside className="dataset-sidebar" aria-label="Dataset deployment">
      <div className="manager-heading"><h2>Datasets</h2></div>
      {(canShowEmpty||families.length>0)&&<p className="small muted" role="status">{families.length} {families.length===1?'dataset':'datasets'}</p>}
      {!families.length&&canShowEmpty&&<p>No datasets are available.</p>}
      {families.map(item=><button className="dataset-row" key={item.id} aria-pressed={family?.id===item.id||parentFamily?.id===item.id} onClick={()=>onDataset(familySelection(item.id))}><span>{item.title}</span></button>)}
    </aside>
  </main>
}
