import { datasetFamilies, familySelection, selectedFamilyId } from './datasetFamilies'
import { SelectField } from './SelectField'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ANATOMY_GROUPS, ANATOMY_TOPICS, browseTargets, groupTargets, targetScope } from './anatomyNavigation'
import type { AnatomyScope, BrowseGroup, BrowseTarget } from './anatomyNavigation'
import type { AtlasEntry } from './types'

interface SourceInfo { id: string; title: string; inputs_present?: number; inputs_required?: number; sources: {title:string;version:string;license_name:string;url:string}[] }
interface LibrarySnapshot {session_token:string;sources:SourceInfo[];packages:Record<string,unknown>[];active_job:string|null}
interface Props {
  atlases:AtlasEntry[]; workspace:boolean; dataset:string|null;
  group:string|null; onGroup:(group:string|null)=>void;
  onDataset:(dataset:string|null)=>void; onManage:(dataset:string)=>void;
  onOpen:(key:string,structureId?:string,scope?:AnatomyScope,signal?:AbortSignal)=>Promise<void>;
}
const representation=(value?:string)=>value==='ct-labels'?'CT + source anatomy':value==='surface-model'?'Independent 3D model':value==='scalar-fields'?'Native statistical fields':value==='label-model'?'3D label model':value==='mri-streamlines'?'MRI + source trajectories':value==='mri-volume'?'Native MRI':'MRI + anatomy'

function GroupCard({group,targets,busy,open,onExplore,topicCount=0}: {group:BrowseGroup;targets:BrowseTarget[];busy:boolean;open:(target:BrowseTarget,group:BrowseGroup)=>void;onExplore?:()=>void;topicCount?:number}) {
  const choices=groupTargets(group,targets), [choice,setChoice]=useState('')
  const target=choices.find(item=>item.dataset_id===choice)??choices[0]
  return <article className={'anatomy-card '+(group.id==='general-anatomy'?'whole-brain-card':'')}>
    <button className="anatomy-entry" disabled={busy||!target} onClick={()=>target&&open(target,group)} aria-label={'Browse '+group.title}>
      <span className="anatomy-symbol" aria-hidden="true">{group.id==='general-anatomy'?'◎':'○'}</span>
      <span>{group.kind==='variation'&&<span className="topic-kind">VARIATION</span>}<h2>{group.title}</h2><p>{group.description}</p></span><span className="entry-arrow" aria-hidden="true">↗</span>
    </button>
    <div className="anatomy-source">{target?<><label><span className="sr-only">Source for {group.title}</span><SelectField aria-label={'Source for '+group.title} value={target.dataset_id} onChange={event=>setChoice(event.target.value)} disabled={busy}>{choices.map(item=><option key={item.key} value={item.dataset_id}>{item.title}</option>)}</SelectField></label><small>{representation(target.representation)} · {choices.length} {choices.length===1?'source':'sources'}</small></>:<small>Build a source atlas to explore this group</small>}</div>
    {onExplore&&topicCount>0&&<button className="anatomy-detail-link" disabled={busy} onClick={onExplore} aria-label={'Explore details for '+group.title}>Detailed anatomy <span>{topicCount} {topicCount===1?'topic':'topics'} →</span></button>}
  </article>
}

export function AnatomyHome({atlases,workspace,dataset,group,onGroup,onDataset,onManage,onOpen}:Props) {
  const [snapshot,setSnapshot]=useState<LibrarySnapshot|null>(null), [error,setError]=useState(''), [opening,setOpening]=useState('')
  const [loading,setLoading]=useState(workspace)
  const [query,setQuery]=useState(''), [readyOnly,setReadyOnly]=useState(false), [reload,setReload]=useState(0)
  const [notice,setNotice]=useState('')
  const openingRequest=useRef<AbortController|null>(null)
  useEffect(()=>()=>openingRequest.current?.abort(),[])
  useEffect(()=>{openingRequest.current?.abort();setOpening('');setNotice('')},[dataset])
  useEffect(()=>{
    if(!workspace)return
    setLoading(true);setError('')
    const controller=new AbortController()
    fetch('/api/workspace/browse'+(reload?'?refresh=1':''),{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error);setSnapshot(data)}).catch(error=>{if(!controller.signal.aborted)setError(String(error))}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[workspace,atlases,reload])
  const targets=useMemo(()=>browseTargets(atlases,snapshot?.packages),[atlases,snapshot])
  const sourceMap=new Map<string,SourceInfo>((snapshot?.sources??[]).map(source=>[source.id,source]))
  for(const item of targets)if(!sourceMap.has(item.dataset_id))sourceMap.set(item.dataset_id,{id:item.dataset_id,title:item.title,sources:[]})
  const readyDatasets=new Set(targets.map(target=>target.dataset_id))
  const sources=[...sourceMap.values()].sort((a,b)=>Number(readyDatasets.has(b.id))-Number(readyDatasets.has(a.id))||a.title.localeCompare(b.title))
  const selected=sources.find(item=>item.id===dataset)
  const families=datasetFamilies(sources).sort((a,b)=>Number(b.members.some(source=>readyDatasets.has(source.id)))-Number(a.members.some(source=>readyDatasets.has(source.id)))||a.title.localeCompare(b.title))
  const family=families.find(item=>item.id===selectedFamilyId(dataset))
  const parentFamily=families.find(item=>item.members.some(source=>source.id===dataset))
  const filteredFamilies=families.filter(item=>(!readyOnly||item.members.some(source=>readyDatasets.has(source.id)))&&(item.title+' '+item.id).toLowerCase().includes(query.trim().toLowerCase()))
  const sourceStatus=(source:SourceInfo)=>readyDatasets.has(source.id)?'Atlas ready':source.inputs_present===source.inputs_required&&!!source.inputs_required?'Source files present':source.inputs_present?'Source files incomplete':'Not acquired'
  const displayed=dataset?targets.filter(item=>item.dataset_id===dataset):targets
  const region=ANATOMY_GROUPS.find(item=>item.id===group||item.coverageIds?.includes(group??''))
  const availableTopics=ANATOMY_TOPICS.filter(topic=>groupTargets(topic,displayed).length)
  const groups=region?availableTopics.filter(topic=>topic.parentId===region.id):ANATOMY_GROUPS.filter(group=>groupTargets(group,displayed).length)
  async function open(target:BrowseTarget,group?:BrowseGroup) {
    openingRequest.current?.abort()
    const controller=new AbortController();openingRequest.current=controller
    setError('');setNotice('');setOpening(group?.title??target.title)
    try {
      let key=target.key
      if(!target.active) {
        if(!snapshot)throw Error('The local data service is unavailable.')
        const response=await fetch('/api/workspace/jobs',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json','X-NeuroImage-Token':snapshot.session_token},body:JSON.stringify({action:'activate',package_key:key})})
        const job=await response.json();if(!response.ok)throw Error(job.error)
        // Stay on the anatomical entry while the local service verifies its source assets.
        for(;;) {
          const result=await fetch('/api/workspace/jobs/'+encodeURIComponent(job.id),{signal:controller.signal}), updated=await result.json()
          if(!result.ok)throw Error(updated.error)
          if(updated?.status==='complete'){key=updated.result.atlas_key;break}
          if(updated&&['failed','cancelled','interrupted'].includes(updated.status))throw Error(updated.detail)
          await new Promise<void>((resolve,reject)=>{
            const abort=()=>{clearTimeout(timer);reject(new DOMException('Stopped waiting','AbortError'))}
            const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve()},1000)
            controller.signal.addEventListener('abort',abort,{once:true})
            if(controller.signal.aborted)abort()
          })
        }
      }
      controller.signal.throwIfAborted()
      await onOpen(key,undefined,group?targetScope(group,target):undefined,controller.signal)
    } catch(error){if(!controller.signal.aborted)setError(String(error))} finally{if(openingRequest.current===controller)setOpening('')}
  }
  return <main className="anatomy-home">
    <section className="anatomy-main" aria-label="Browse anatomy">
      <div className="anatomy-home-heading"><div className="eyebrow">{region?'DETAILED ANATOMY':dataset?'DATASET':'NEUROANATOMY'}</div><h1>{region?.title??family?.title??selected?.title??(dataset??'Browse anatomy')}</h1><p>{region?'Choose a topic and source.':family?'Choose a case, region or representation within this dataset.':dataset?'Open the views available from this source.':'Choose a region or system.'}</p>{region&&<button onClick={()=>onGroup(null)}>Back to anatomy groups</button>}</div>
      {error&&<div className="error" role="alert">{error}<button onClick={()=>setReload(value=>value+1)}>Refresh sources</button><button onClick={()=>setError('')}>Dismiss</button></div>}
      {loading&&<p role="status">Checking your local source library…</p>}
      {notice&&<p role="status">{notice}</p>}
      {opening&&<div className="opening-atlas" role="status">Opening {opening}… Verifying local atlas files.<button onClick={()=>{openingRequest.current?.abort();setOpening('');setNotice('Stopped waiting. Any verification already started continues in the dataset tools.')}}>Stop waiting</button></div>}
      {family&&<div className="dataset-summary"><button onClick={()=>onDataset(null)}>All datasets</button><p>{family.members.length} source configurations · Each keeps its original definitions and coordinates.</p></div>}
      {family&&<div className="dataset-configurations" aria-label={family.title+' source configurations'}>{family.members.map(source=><button key={source.id} className="dataset-configuration" onClick={()=>onDataset(source.id)}><span>{source.title}</span><small>{sourceStatus(source)}</small><span aria-hidden="true">Open →</span></button>)}</div>}
      {dataset&&!family&&<div className="dataset-summary">{selected?.sources.map((source,index)=><p key={index}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> · {source.version} · {source.license_name}</p>)}{workspace&&!!selected?.sources.length&&<button onClick={()=>onManage(dataset)}>Download and build</button>}{parentFamily&&<button onClick={()=>onDataset(familySelection(parentFamily.id))}>Back to {parentFamily.title}</button>}<button onClick={()=>onDataset(null)}>All anatomy groups</button></div>}
      <div className="anatomy-grid">{groups.map(group=><GroupCard key={(dataset??'all')+group.id} group={group} targets={displayed} busy={!!opening||loading} open={(target,group)=>void open(target,group)} onExplore={region?undefined:()=>onGroup(group.id)} topicCount={availableTopics.filter(topic=>topic.parentId===group.id).length}/>)}</div>
      {region&&!groups.length&&!loading&&<p className="empty-library">No detailed topics are available for this source selection.<button onClick={()=>onGroup(null)}>Back to anatomy groups</button></p>}
      {!dataset&&!groups.length&&!loading&&<div className="home-empty"><h2>{targets.length?'Open a source package':'Build your first local atlas'}</h2><p>{targets.length?'Your ready packages are listed below. Each opens in its own source space.':'Choose a dataset from the library, review its source terms, then open its download and construction tools.'}</p><div className="button-row">{targets.map(target=><button key={target.key} disabled={!!opening} onClick={()=>void open(target)}>{target.title}</button>)}</div></div>}
      {dataset&&!family&&!groups.length&&(displayed.length?<div className="dataset-summary">{displayed.map(target=><button key={target.key} disabled={!!opening||loading} onClick={()=>void open(target)}>Open source package</button>)}</div>:<p className="empty-library">Open the source data tools to acquire its files and build a local atlas.</p>)}
      <p className="home-evidence-note">Atlases retain their original definitions and coordinates.</p>
    </section>
    <aside className="dataset-sidebar" aria-label="Dataset deployment">
      <div className="manager-heading"><h2>Datasets</h2>{workspace&&<button disabled={loading||!!opening} onClick={()=>setReload(value=>value+1)}>Refresh</button>}</div>
      <label className="dataset-search">Find a dataset<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Name or source ID"/></label>
      <label className="check-control"><input type="checkbox" checked={readyOnly} onChange={event=>setReadyOnly(event.target.checked)}/>Ready atlases only</label>
      <p className="small muted" role="status">{filteredFamilies.length} of {families.length} datasets</p>
      {workspace&&!snapshot&&loading&&<small>Checking local deployment…</small>}
      {!filteredFamilies.length&&!loading&&<p>No datasets match these filters.<button onClick={()=>{setQuery('');setReadyOnly(false)}}>Clear filters</button></p>}
      {filteredFamilies.map(item=>{
        const ready=item.members.filter(source=>readyDatasets.has(source.id)).length
        return <button className="dataset-row" key={item.id} aria-pressed={family?.id===item.id||parentFamily?.id===item.id} onClick={()=>onDataset(familySelection(item.id))}><span>{item.title}</span><small className={ready?'ready-state':''}>{ready?`${ready} ready ${ready===1?'configuration':'configurations'}`:'Not yet built'}</small></button>
      })}
      <p className="small muted">Select a dataset to browse its cases, regions and available source representations.</p>
    </aside>
  </main>
}
