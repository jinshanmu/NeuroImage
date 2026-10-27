import { SelectField } from './SelectField'
import { FrameRange } from './FrameRange'
import { StructureVisibilityActions } from './StructureVisibilityActions'
import { LibrarySectionSelect } from './LibrarySectionSelect'
import { BACKGROUND_STRUCTURES, CURRENT_GROUP, librarySectionStructures } from './librarySections'
import { BackgroundControls } from './BackgroundControls'
import { brainBackgroundIds, reserveBrainBackground } from './atlasBackground'
import { cursorCutaway, cutawayAtCursor } from './cutaway'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelViewer } from './modelViewer'
import { ViewerLifecycle } from './viewerLifecycle'
import { initialModelView, readModelScene } from './modelScene'
import type { AtlasEntry, Vec3 } from './types'
import type { ModelSurface, ModelView, SurfaceManifest } from './modelTypes'
import type { AnatomyScope } from './anatomyNavigation'

export function SurfaceModelWorkspace({atlas,memory,viewKey,scope,startupContent}: {
  atlas:AtlasEntry;memory:Map<string,ModelView>;viewKey:string;scope?:AnatomyScope;startupContent?:unknown
}) {
  const [manifest,setManifest]=useState<SurfaceManifest|null>(null)
  const [state,setState]=useState<ModelView|null>(null)
  const [loadFailed,setLoadFailed]=useState(false)
  const [readySource,setReadySource]=useState<{manifest:SurfaceManifest;base:string}|null>(null),[error,setError]=useState(''),[status,setStatus]=useState('Opening independent model…')
  const ready=!!manifest&&readySource?.manifest===manifest&&readySource.base===atlas.base_url
  const [drawer,setDrawer]=useState<'library'|null>(null)
  const [query,setQuery]=useState(''),[category,setCategory]=useState(CURRENT_GROUP)
  const canvas=useRef<HTMLCanvasElement>(null),viewer=useRef<ModelViewer|null>(null),stateRef=useRef<ModelView|null>(null)
  const lifecycle=useRef<ViewerLifecycle<ModelView>|null>(null)
  const scopeKey=useMemo(()=>JSON.stringify(scope??null),[scope])
  const coverageKey=useMemo(()=>JSON.stringify(atlas.coverage??[]),[atlas.coverage])
  const patch=(value:Partial<ModelView>)=>setState(previous=>{
    if(!previous)return previous
    const next={...previous,...value},surfaceCutaway=cursorCutaway(next.surfaceCutaway,next.position_native_mm)
    return surfaceCutaway===next.surfaceCutaway?next:{...next,surfaceCutaway}
  })
  useEffect(()=>{
    const controller=new AbortController()
    setReadySource(null);setLoadFailed(false);setError('');setStatus('Opening independent model…')
    async function load(){
      const response=await fetch(atlas.manifest_url,{signal:controller.signal});if(!response.ok)throw Error('Could not open the native model manifest.')
      const m:SurfaceManifest=await response.json()
      if(m.schema_version!=='1.7'||m.representation!=='surface-model'||m.space.coordinate_system!=='SOURCE_XYZ'||m.volumes.length)throw Error('Expected an independent native XYZ surface model.')
      if(controller.signal.aborted)return
      let initial=memory.get(viewKey)??initialModelView(m,scope)
      if(startupContent&&!memory.has(viewKey)) initial=readModelScene(startupContent,m).state
      initial=reserveBrainBackground(initial,brainBackgroundIds(m.structures,atlas.coverage))
      const cut=cursorCutaway(initial.surfaceCutaway,initial.position_native_mm)
      if(cut!==initial.surfaceCutaway)initial={...initial,surfaceCutaway:cut}
      setManifest(m);setState(initial);stateRef.current=initial
    }
    void load().catch(error=>{if(!controller.signal.aborted){setLoadFailed(true);setStatus('Source loading failed');setError(String(error))}})
    return()=>controller.abort()
  },[atlas.manifest_url,viewKey,memory,scopeKey,coverageKey,startupContent])
  useEffect(()=>{
    if(!manifest||!canvas.current||!stateRef.current)return
    let mounted=true
    let v:ModelViewer|undefined
    let session:ViewerLifecycle<ModelView>|undefined
    setReadySource(null)
    void import('./modelViewer').then(async({ModelViewer})=>{
    if(!mounted||!canvas.current||!stateRef.current)return
    v=new ModelViewer(canvas.current,manifest,atlas.base_url,change=>mounted&&patch(change),message=>mounted&&setStatus(message))
    viewer.current=v
    session=new ViewerLifecycle(v)
    lifecycle.current=session
    const initialized=await session.initialize(stateRef.current)
    if(mounted&&initialized)setReadySource({manifest,base:atlas.base_url})
    }).catch(error=>{if(mounted){setLoadFailed(true);setStatus('Viewer loading failed');setError(String(error))}})
    return()=>{
      mounted=false;session?.dispose()
      if(lifecycle.current===session)lifecycle.current=null
      if(viewer.current===v)viewer.current=null
    }
  },[manifest,atlas.base_url])
  useEffect(()=>{
    stateRef.current=state
    if(state){
      memory.set(viewKey,state)
      const session=lifecycle.current
      if(session)void session.apply(state).catch(error=>{if(session.active&&lifecycle.current===session)setError(String(error))})
    }
  },[state,ready,memory,viewKey])
  const selected=manifest?.structures.find(item=>item.id===state?.selected)
  const cursorStructure=manifest?.structures.find(item=>item.id===(state&&ready?viewer.current?.cursorStructureAt(state.position_native_mm):state?.selected))
  const backgroundIds=brainBackgroundIds(manifest?.structures??[],atlas.coverage)
  const libraryBackgroundIds=manifest?.structures.map(item=>item.id)??[]
  const libraryGroup=librarySectionStructures(manifest?.structures??[],scope,[],CURRENT_GROUP)
  const libraryGroupIds=new Set(libraryGroup.map(item=>item.id))
  const libraryGroupName=scope?.title??manifest?.title??atlas.title
  const libraryTargets=librarySectionStructures(manifest?.structures??[],scope,libraryBackgroundIds,category)
  const structures=[...libraryGroup,...(manifest?.structures.filter(item=>!libraryGroupIds.has(item.id))??[])]
    .filter(item=>`${item.name} ${item.id} ${item.source_name}`.toLowerCase().includes(query.toLowerCase()))
  const hasLibraryBackground=librarySectionStructures(manifest?.structures??[],scope,libraryBackgroundIds,BACKGROUND_STRUCTURES).length>0
  function choose(item:ModelSurface){if(state){viewer.current?.setCursorStructure(item.target_native_mm,item.id);patch({selected:item.id,position_native_mm:[...item.target_native_mm],visible:[...new Set([...state.visible,item.id])]})}}
  function focusSelected(){if(!selected||!manifest||!state)return
    const bounds=(item:ModelSurface)=>viewer.current?.bounds(item.id)??item.bounds_native_mm
    const shown=manifest.structures.filter(item=>state.visible.includes(item.id)),width=Math.max(...[0,1,2].map(axis=>Math.max(...shown.map(item=>bounds(item)[1][axis]))-Math.min(...shown.map(item=>bounds(item)[0][axis])))),selectedBounds=bounds(selected),region=Math.max(...selectedBounds[1].map((v,i)=>v-selectedBounds[0][i]),1)
    patch({focus_native_mm:selectedBounds[0].map((value,axis)=>(value+selectedBounds[1][axis])/2) as Vec3,camera:[state.camera[0],state.camera[1],Math.max(1.4,Math.min(12,width/region))]})
  }
  function adjustBackground(opacity:number){if(!state)return
    const enabled=opacity>0
    patch({surfaceContext:{enabled,opacity,structure_ids:backgroundIds.length?backgroundIds:state.surfaceContext?.structure_ids??[]}})
  }
  return <section className={'model-workspace '+(drawer?'showing-'+drawer:'')} aria-label="Independent source model viewer">
    {drawer==='library'&&<aside id={viewKey+'-library'} aria-label="Structure library" className="model-library">
      <input type="search" aria-label="Search model objects" placeholder="Search source objects…" value={query} onChange={event=>setQuery(event.target.value)}/>
      <StructureVisibilityActions structures={libraryTargets} sourceStructures={manifest?.structures??[]} visible={state?.visible??[]} disabled={!ready} onChange={visible=>patch({visible})}>
        <LibrarySectionSelect label="Model object category" value={category} onChange={setCategory}
          groupName={libraryGroupName} hasBackground={hasLibraryBackground}/>
      </StructureVisibilityActions>
      <div className="structure-list">{structures.map(item=><div className={'structure-row '+(item.id===state?.selected?'selected':'')} key={item.id}><input type="checkbox" aria-label={'Show '+item.name} checked={state?.visible.includes(item.id)??false} disabled={!ready} onChange={event=>state&&patch({visible:event.target.checked?[...state.visible,item.id]:state.visible.filter(id=>id!==item.id)})}/><button disabled={!ready} onClick={()=>choose(item)} aria-label={item.name} aria-description={libraryGroupIds.has(item.id)?libraryGroupName:'Background'}><span className="structure-color" style={{background:`rgb(${item.color.join(',')})`}}/><span><span className="structure-name">{item.name}</span><small>{libraryGroupIds.has(item.id)?libraryGroupName:'Background'}</small></span></button></div>)}</div>
    </aside>}
    <div className="model-view-column"><div className="workspace-heading"><div><div className="eyebrow">{scope?.title??'INDEPENDENT ANATOMICAL MODEL'}</div><h1>{manifest?.title??atlas.title}</h1></div></div>
      <div className="compact-toolbar"><button className="library-toggle" aria-controls={viewKey+'-library'} aria-expanded={drawer==='library'} onClick={()=>setDrawer(drawer==='library'?null:'library')}>Structure library</button><span className="compact-selection">{cursorStructure?.name??'Select a source object'}</span></div>
      {error&&<div className="error" role="alert">{error}<button onClick={()=>setError('')}>Dismiss</button></div>}
      <div className="view-toolbar"><button disabled={!ready} onClick={()=>state&&patch({focus_native_mm:null,camera:[state.camera[0],state.camera[1],.65]})}>Full model view</button><button disabled={!ready||!selected} onClick={focusSelected}>Focus selected</button><button disabled={!ready||!selected} onClick={()=>selected&&patch({visible:[selected.id],focus_native_mm:null,camera:[110,15,.65]})}>Isolate selected</button>{manifest?.structures.some(item=>item.category==='Brainstem model context')&&<button disabled={!ready} onClick={()=>manifest&&patch({visible:manifest.structures.filter(item=>item.category==='Brainstem model context').map(item=>item.id).concat(state?.visible??[]) .filter((id,i,all)=>all.indexOf(id)===i)})}>Add brainstem context</button>}<label>3D opacity<FrameRange aria-label="Model opacity" min="0" max="1" step=".05" value={state?.opacity??.5} disabled={!ready} onValueChange={value=>patch({opacity:value})}/></label></div>
      <div className="model-coordinate-bar"><label className="check-control"><input type="checkbox" checked={state?.highlightSelected??false} onChange={event=>patch({highlightSelected:event.target.checked})}/>Highlight selected</label><span>Source XYZ (mm): {state?.position_native_mm.map(value=>value.toFixed(2)).join(' · ')}</span><span>{state?.visible.length??0} visible objects</span></div>
      <div className="model-canvas-shell" data-ready={ready?'true':'false'} aria-busy={!ready&&!loadFailed}><canvas ref={canvas} aria-label="Independent native source model"/>{!ready&&!loadFailed&&<div className="atlas-loading" role="status">Loading</div>}</div>
      {scope&&scope.id!=='general-anatomy'&&state&&<BackgroundControls disabled={!ready}
        model={backgroundIds.length||state.surfaceContext?{enabled:!!state.surfaceContext?.enabled,opacity:state.surfaceContext?.opacity??.15,
          adjust:adjustBackground}:undefined}
        unavailable={!backgroundIds.length&&!state.surfaceContext?'3D background is unavailable in this source.':undefined}/>}
      <div className="model-status" role="status">{ready||loadFailed?status:''}{loadFailed&&<button onClick={()=>window.location.reload()}>Reload viewer</button>}<span>Click anywhere to move cursor · Drag to orbit · Scroll to zoom</span></div>
      {state&&<details className="model-display-details"><summary>Selected object and surface display</summary><h2>{selected?.name??'Model observation'}</h2>{selected&&<><p className="small muted">{selected.laterality} · {selected.category}</p><details><summary>Source geometry</summary><p>{selected.evidence}</p><p>{selected.geometry.vertex_count.toLocaleString()} source vertices · {selected.geometry.triangle_count.toLocaleString()} triangles</p><p>{selected.geometry.method}</p>{selected.source_notes.map((note,i)=><p key={i}>{note}</p>)}</details></>}
      <section className="view-toolbar surface-cutaway-controls model-cutaway" aria-label="Native XYZ cutaway">
        <button aria-pressed={Boolean(state.surfaceCutaway)} disabled={!ready||(!state.surfaceCutaway&&!state.visible.length)} onClick={()=>patch({surfaceCutaway:state.surfaceCutaway?undefined:cutawayAtCursor(state.position_native_mm,state.visible)})}>Cutaway</button>
        {state.surfaceCutaway&&<><label>Plane<SelectField aria-label="Model cutaway axis" value={state.surfaceCutaway.axis} disabled={!ready} onChange={event=>{
          const axis=Number(event.target.value) as 0|1|2
          patch({surfaceCutaway:{...state.surfaceCutaway!,axis,position_mm:state.position_native_mm[axis]}})
        }}>{['X','Y','Z'].map((axis,i)=><option value={i} key={axis}>{axis}</option>)}</SelectField></label>
          <button disabled={!ready} onClick={()=>patch({surfaceCutaway:{...state.surfaceCutaway!,side:state.surfaceCutaway!.side===1?-1:1,position_mm:state.position_native_mm[state.surfaceCutaway!.axis]}})}>Reverse cutaway</button></>}
      </section></details>}
    </div>
  </section>
}
