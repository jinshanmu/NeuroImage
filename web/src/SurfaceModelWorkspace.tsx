import { SelectField } from './SelectField'
import { StructureVisibilityActions } from './StructureVisibilityActions'
import { BackgroundControls } from './BackgroundControls'
import { brainBackgroundIds } from './atlasBackground'
import { readBrowserContent, saveBrowserContent } from './browserStorage'
import { useEffect, useRef, useState } from 'react'
import type { ModelViewer } from './modelViewer'
import { initialModelView, modelScene, readModelScene } from './modelScene'
import { exportModelImage } from './modelExport'
import { download } from './scene'
import type { AtlasEntry, Vec3 } from './types'
import type { ModelSurface, ModelView, SurfaceManifest } from './modelTypes'
import type { AnatomyScope } from './anatomyNavigation'

export function SurfaceModelWorkspace({atlas,memory,viewKey,scope,startupContent}: {
  atlas:AtlasEntry;memory:Map<string,ModelView>;viewKey:string;scope?:AnatomyScope;startupContent?:unknown
}) {
  const [manifest,setManifest]=useState<SurfaceManifest|null>(null)
  const [state,setState]=useState<ModelView|null>(null)
  const [loadFailed,setLoadFailed]=useState(false)
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('Opening independent model…')
  const [drawer,setDrawer]=useState<'library'|null>(null)
  const [query,setQuery]=useState(''),[category,setCategory]=useState(''),[groupOnly,setGroupOnly]=useState(!!scope?.structure_ids.length)
  const [saved,setSaved]=useState(false),[exporting,setExporting]=useState(false)
  const canvas=useRef<HTMLCanvasElement>(null),viewer=useRef<ModelViewer|null>(null),stateRef=useRef<ModelView|null>(null)
  useEffect(()=>{
    if(!drawer||!matchMedia('(max-width:1100px)').matches)return
    canvas.current?.closest('.model-workspace')?.querySelector('.model-library')?.scrollIntoView({block:'start'})
  },[drawer])
  const sceneUpload=useRef<HTMLInputElement>(null)
  const storageKey='neuroimage:model:'+viewKey
  const patch=(value:Partial<ModelView>)=>setState(previous=>previous?{...previous,...value}:previous)
  useEffect(()=>{let cancelled=false
    async function load(){
      const response=await fetch(atlas.manifest_url);if(!response.ok)throw Error('Could not open the native model manifest.')
      const m:SurfaceManifest=await response.json()
      if(m.schema_version!=='1.7'||m.representation!=='surface-model'||m.space.coordinate_system!=='SOURCE_XYZ'||m.volumes.length)throw Error('Expected an independent native XYZ surface model.')
      let initial=memory.get(viewKey)??initialModelView(m,scope)
      if(startupContent&&!memory.has(viewKey)) initial=readModelScene(startupContent,m).state
      if(cancelled)return
      setManifest(m);setState(initial);stateRef.current=initial
      try{const saved=!!(await readBrowserContent(storageKey));if(!cancelled)setSaved(saved)}catch{ /* Scene files work without browser storage. */ }
    }
    void load().catch(error=>{if(!cancelled){setLoadFailed(true);setStatus('Source loading failed');setError(String(error))}})
    return()=>{cancelled=true}
  },[atlas,viewKey,memory,scope,startupContent,storageKey])
  useEffect(()=>{
    if(!manifest||!canvas.current||!stateRef.current)return
    let mounted=true
    let v:ModelViewer|undefined
    void import('./modelViewer').then(async({ModelViewer})=>{
    if(!mounted||!canvas.current||!stateRef.current)return
    v=new ModelViewer(canvas.current,manifest,atlas.base_url,change=>mounted&&patch(change),message=>mounted&&setStatus(message))
    viewer.current=v
    await v.initialize(stateRef.current)
    if(mounted)setReady(true)
    }).catch(error=>{if(mounted){setLoadFailed(true);setStatus('Viewer loading failed');setError(String(error))}})
    return()=>{mounted=false;v?.dispose();viewer.current=null}
  },[manifest,atlas.base_url])
  useEffect(()=>{stateRef.current=state;if(state){memory.set(viewKey,state);if(ready)void viewer.current?.apply(state).catch(error=>setError(String(error)))}},[state,ready,memory,viewKey])
  const selected=manifest?.structures.find(item=>item.id===state?.selected)
  const backgroundIds=brainBackgroundIds(manifest?.structures??[],atlas.coverage)
  const structures=manifest?.structures.filter(item=>(!groupOnly||!scope||scope.structure_ids.includes(item.id))&&(!category||item.category===category)&&`${item.name} ${item.id} ${item.source_name}`.toLowerCase().includes(query.toLowerCase()))??[]
  function choose(item:ModelSurface){if(state)patch({selected:item.id,position_native_mm:[...item.target_native_mm],visible:[...new Set([...state.visible,item.id])]})}
  function focusSelected(){if(!selected||!manifest||!state)return
    const bounds=(item:ModelSurface)=>viewer.current?.bounds(item.id)??item.bounds_native_mm
    const shown=manifest.structures.filter(item=>state.visible.includes(item.id)),width=Math.max(...[0,1,2].map(axis=>Math.max(...shown.map(item=>bounds(item)[1][axis]))-Math.min(...shown.map(item=>bounds(item)[0][axis])))),selectedBounds=bounds(selected),region=Math.max(...selectedBounds[1].map((v,i)=>v-selectedBounds[0][i]),1)
    patch({focus_native_mm:selectedBounds[0].map((value,axis)=>(value+selectedBounds[1][axis])/2) as Vec3,camera:[state.camera[0],state.camera[1],Math.max(1.4,Math.min(12,width/region))]})
  }
  async function settled(){const v=viewer.current;if(!v||!stateRef.current)throw Error('The model viewer is not ready.');await v.apply(stateRef.current);if(viewer.current!==v)throw Error('The model changed while saving.');return {viewer:v,state:v.snapshot(stateRef.current!)}}
  async function saveScene(){try{const current=await settled();await saveBrowserContent(storageKey,JSON.stringify(modelScene(manifest!,current.state)));setSaved(true);setStatus('Model scene saved in this browser')}catch(error){setError(`Could not save the scene. Export a scene file to retain your work. ${String(error)}`)}}
  async function restoreScene(){try{setState(readModelScene(JSON.parse(await readBrowserContent(storageKey)??'null'),manifest!).state);setStatus('Source-bound model scene restored')}catch(error){setError(String(error))}}
  async function sceneFile(){try{const current=await settled();download(JSON.stringify(modelScene(manifest!,current.state),null,2),manifest!.package_id+'-model-scene.json','application/json')}catch(error){setError(String(error))}}
  async function importFile(file:File|undefined){if(!file)return;try{if(file.size>10*1024**2)throw Error('Choose a scene of up to 10 MiB.');setState(readModelScene(JSON.parse(await file.text()),manifest!).state);setStatus('Source-bound scene restored')}catch(error){setError(String(error))}finally{if(sceneUpload.current)sceneUpload.current.value=''}}
  async function imageExport(){setExporting(true);try{const current=await settled();await exportModelImage(current.viewer.capture(),manifest!,current.state,atlas.base_url);setStatus('Model image, scene and source attribution exported')}catch(error){setError(String(error))}finally{setExporting(false)}}
  return <section className={'model-workspace '+(drawer?'showing-'+drawer:'')} aria-label="Independent source model viewer">
    {drawer==='library'&&<aside className="model-library"><div className="panel-title"><span>Source objects · {manifest?.structures.length??0}</span><button onClick={()=>setDrawer(null)}>Close</button></div>
      <input type="search" aria-label="Search model objects" placeholder="Search source objects…" value={query} onChange={event=>setQuery(event.target.value)}/>
      {scope?.structure_ids.length&&<label className="check-control"><input type="checkbox" checked={groupOnly} onChange={event=>setGroupOnly(event.target.checked)}/>{scope.title} only</label>}
      <SelectField aria-label="Model object category" value={category} onChange={event=>setCategory(event.target.value)}><option value="">All categories</option>{[...new Set(manifest?.structures.map(item=>item.category))].map(value=><option key={value}>{value}</option>)}</SelectField>
      <StructureVisibilityActions structures={structures} visible={state?.visible??[]} disabled={!ready} onChange={visible=>patch({visible})}/>
      <div className="structure-list">{structures.map(item=><div className={'structure-row '+(item.id===state?.selected?'selected':'')} key={item.id}><input type="checkbox" aria-label={'Show '+item.name} checked={state?.visible.includes(item.id)??false} disabled={!ready} onChange={event=>state&&patch({visible:event.target.checked?[...state.visible,item.id]:state.visible.filter(id=>id!==item.id)})}/><button disabled={!ready} onClick={()=>choose(item)}><span className="structure-color" style={{background:`rgb(${item.color.join(',')})`}}/><span>{item.name}<small>{item.laterality} · source label</small></span></button></div>)}</div>
    </aside>}
    <div className="model-view-column"><div className="workspace-heading"><div><div className="eyebrow">{scope?.title??'INDEPENDENT ANATOMICAL MODEL'}</div><h1>{manifest?.title??atlas.title}</h1></div></div>
      <div className="compact-toolbar"><button aria-expanded={drawer==='library'} onClick={()=>setDrawer(drawer==='library'?null:'library')}>Structure library</button><span className="compact-selection">{selected?.name??'Select a source object'}</span></div>
      {error&&<div className="error" role="alert">{error}<button onClick={()=>setError('')}>Dismiss</button></div>}
      <div className="view-toolbar"><button disabled={!ready} onClick={()=>state&&patch({focus_native_mm:null,camera:[state.camera[0],state.camera[1],.65]})}>Full model view</button><button disabled={!ready||!selected} onClick={focusSelected}>Focus selected</button><button disabled={!ready||!selected} onClick={()=>selected&&patch({visible:[selected.id],focus_native_mm:null,camera:[110,15,.65]})}>Isolate selected</button>{manifest?.structures.some(item=>item.category==='Brainstem model context')&&<button disabled={!ready} onClick={()=>manifest&&patch({visible:manifest.structures.filter(item=>item.category==='Brainstem model context').map(item=>item.id).concat(state?.visible??[]) .filter((id,i,all)=>all.indexOf(id)===i)})}>Add brainstem context</button>}<label>3D opacity<input aria-label="Model opacity" type="range" min="0" max="1" step=".05" value={state?.opacity??1} onChange={event=>patch({opacity:Number(event.target.value)})}/></label></div>
      <div className="model-coordinate-bar"><label className="check-control"><input type="checkbox" checked={state?.highlightSelected??false} onChange={event=>patch({highlightSelected:event.target.checked})}/>Highlight selected</label><span>Source XYZ (mm): {state?.position_native_mm.map(value=>value.toFixed(2)).join(' · ')}</span><span>{state?.visible.length??0} visible objects</span></div>
      <div className="model-canvas-shell" aria-busy={!ready&&!loadFailed}><canvas ref={canvas} aria-label="Independent native source model"/>{!ready&&!loadFailed&&<div className="atlas-loading" role="status">Loading</div>}</div>
      {scope&&scope.id!=='general-anatomy'&&state&&<BackgroundControls title="Whole-brain background" disabled={!ready}
        model={backgroundIds.length||state.surfaceContext?{enabled:!!state.surfaceContext?.enabled,opacity:state.surfaceContext?.opacity??.15,
          toggle:enabled=>patch({surfaceContext:{enabled,opacity:state.surfaceContext?.opacity??.15,structure_ids:state.surfaceContext?.structure_ids??backgroundIds},focus_native_mm:null,camera:[state.camera[0],state.camera[1],.65]}),
          adjust:opacity=>patch({surfaceContext:{enabled:true,opacity,structure_ids:state.surfaceContext?.structure_ids??backgroundIds}})}:undefined}
        unavailable={!backgroundIds.length&&!state.surfaceContext?'Whole-brain context is unavailable in this source.':undefined}/>}
      <div className="model-status" role="status">{ready||loadFailed?status:''}{loadFailed&&<button onClick={()=>window.location.reload()}>Reload viewer</button>}<span>Drag to orbit · Scroll to zoom · Double-click a visible surface to locate</span></div>
      {state&&<details className="model-display-details"><summary>Selected object and surface display</summary><h2>{selected?.name??'Model observation'}</h2>{selected&&<><p className="small muted">{selected.laterality} · {selected.category}</p><label>Selected opacity<input aria-label="Selected model opacity" type="range" min="0" max="1" step=".05" value={state.surfaceOpacity[selected.id]??1} onChange={event=>patch({surfaceOpacity:{...state.surfaceOpacity,[selected.id]:Number(event.target.value)}})}/></label><details><summary>Source geometry</summary><p>{selected.evidence}</p><p>{selected.geometry.vertex_count.toLocaleString()} source vertices · {selected.geometry.triangle_count.toLocaleString()} triangles</p><p>{selected.geometry.method}</p>{selected.source_notes.map((note,i)=><p key={i}>{note}</p>)}</details></>}
      <details className="model-cutaway"><summary>Native XYZ cutaway</summary><p>Display clipping reveals the interior view of selected original source surfaces.</p><button disabled={!selected} onClick={()=>selected&&patch({surfaceCutaway:{axis:2,side:1,position_mm:state.position_native_mm[2],structures:[selected.id]}})}>Cut selected at cursor</button>{state.surfaceCutaway&&<><label>Axis<SelectField aria-label="Model cutaway axis" value={state.surfaceCutaway.axis} onChange={event=>patch({surfaceCutaway:{...state.surfaceCutaway!,axis:Number(event.target.value) as 0|1|2,position_mm:state.position_native_mm[Number(event.target.value)]}})}>{['X','Y','Z'].map((axis,i)=><option value={i} key={axis}>{axis}</option>)}</SelectField></label><label>Native position (mm)<input aria-label="Model cutaway position" type="number" step=".5" value={state.surfaceCutaway.position_mm} onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value))patch({surfaceCutaway:{...state.surfaceCutaway!,position_mm:value}})}}/></label><button onClick={()=>patch({surfaceCutaway:{...state.surfaceCutaway!,side:state.surfaceCutaway!.side===1?-1:1}})}>Reverse cutaway</button><button onClick={()=>patch({surfaceCutaway:undefined})}>Remove cutaway</button></>}</details></details>}
      {manifest&&<details className="source-details"><summary>Sources and coordinates</summary><p>{manifest.space.correspondence}</p><p>{manifest.space.unit_basis}</p><p className="small muted">Package {manifest.package_version} · Independent native XYZ in millimeters</p>{manifest.validation.warnings.filter(item=>!/expert review|anatomical review/i.test(item)).map((item,i)=><p className="evidence" key={i}>{item}</p>)}{manifest.sources.map(source=><section key={source.id}><h3>{source.title}</h3><p>{source.citation}</p><a href={source.url} target="_blank" rel="noreferrer">Official source</a><p>{source.version}</p><a href={atlas.base_url+source.license_file} target="_blank" rel="noreferrer">{source.license_name} · local license and attribution</a></section>)}</details>}
      <div className="scene-toolbar"><button disabled={!ready} onClick={()=>void saveScene()}>Save scene</button><button disabled={!ready||!saved} onClick={restoreScene}>Restore saved</button><button disabled={!ready} onClick={()=>void sceneFile()}>Export scene</button><button disabled={!ready} onClick={()=>sceneUpload.current?.click()}>Import scene</button><button className="primary" disabled={!ready||exporting} onClick={()=>void imageExport()}>{exporting?'Preparing export…':'Export image'}</button><input ref={sceneUpload} aria-label="Import model scene file" type="file" accept=".json" hidden onChange={event=>void importFile(event.target.files?.[0])}/></div>
    </div>
  </section>
}
