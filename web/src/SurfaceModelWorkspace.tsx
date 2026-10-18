import { LessonEvidence } from './LessonEvidence'
import { StudyRecord } from './LearningProgress'
import { SelectField } from './SelectField'
import { StructureVisibilityActions } from './StructureVisibilityActions'
import { ModelTeachingNotebook } from './ModelTeachingNotebook'
import { readBrowserContent, saveBrowserContent } from './browserStorage'
import type { ModelNotebookDraft } from './ModelTeachingNotebook'
import { EvidenceTopics } from './EvidenceTopics'
import { useEffect, useRef, useState } from 'react'
import type { ModelViewer } from './modelViewer'
import { initialModelView, modelScene, readModelScene, modelNotebook, readModelNotebook } from './modelScene'
import { exportModelImage } from './modelExport'
import { download } from './scene'
import type { AtlasEntry, Lesson, Vec3 } from './types'
import type { ModelSurface, ModelView, SurfaceManifest } from './modelTypes'
import type { AnatomyScope } from './anatomyNavigation'

export function SurfaceModelWorkspace({atlas,memory,notebooks,viewKey,scope,startupContent}: {
  atlas:AtlasEntry;memory:Map<string,ModelView>;notebooks:Map<string,ModelNotebookDraft>;viewKey:string;scope?:AnatomyScope;startupContent?:unknown
}) {
  const [manifest,setManifest]=useState<SurfaceManifest|null>(null),[lessons,setLessons]=useState<Lesson[]>([])
  const [state,setState]=useState<ModelView|null>(null)
  const [loadFailed,setLoadFailed]=useState(false)
  const [ready,setReady]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('Opening independent model…')
  const [drawer,setDrawer]=useState<'library'|'tools'|null>(null),[tab,setTab]=useState<'notes'|'lessons'|'sources'>('notes')
  const [query,setQuery]=useState(''),[category,setCategory]=useState(''),[groupOnly,setGroupOnly]=useState(!!scope?.structure_ids.length)
  const [presenting,setPresenting]=useState(false)
  const [annotation,setAnnotation]=useState(''),[exporting,setExporting]=useState(false),[saved,setSaved]=useState(false)
  const canvas=useRef<HTMLCanvasElement>(null),viewer=useRef<ModelViewer|null>(null),stateRef=useRef<ModelView|null>(null)
  useEffect(()=>{
    if(!drawer||!matchMedia('(max-width:1100px)').matches)return
    canvas.current?.closest('.model-workspace')?.querySelector(drawer==='library'?'.model-library':'.model-tools')?.scrollIntoView({block:'start'})
  },[drawer])
  const sceneUpload=useRef<HTMLInputElement>(null)
  const storageKey='neuroimage:model:'+viewKey,bookKey='neuroimage:model-notebook:'+viewKey
  const patch=(value:Partial<ModelView>)=>setState(previous=>previous?{...previous,...value}:previous)
  useEffect(()=>{let cancelled=false
    async function load(){
      const response=await fetch(atlas.manifest_url);if(!response.ok)throw Error('Could not open the native model manifest.')
      const m:SurfaceManifest=await response.json()
      if(m.schema_version!=='1.7'||m.representation!=='surface-model'||m.space.coordinate_system!=='SOURCE_XYZ'||m.volumes.length)throw Error('Expected an independent native XYZ surface model.')
      const lessonResponse=await fetch(atlas.base_url+m.lessons_file);if(!lessonResponse.ok)throw Error('Could not open source model lessons.')
      const l:Lesson[]=(await lessonResponse.json()).lessons
      let initial=memory.get(viewKey)??initialModelView(m), notebook=modelNotebook(m)
      if(!memory.has(viewKey)&&scope?.structure_ids.length&&!scope.structure_ids.includes(initial.selected??'')) {
        const matches=m.structures.filter(item=>scope.structure_ids.includes(item.id))
        if(matches.length)initial={...initial,selected:matches[0].id,position_native_mm:[...matches[0].target_native_mm],visible:matches.slice(0,12).map(item=>item.id)}
      }
      try{const draft=await readBrowserContent(bookKey);if(draft)notebook=readModelNotebook(JSON.parse(draft),m,l)}catch(error){if(!cancelled)setError(`The saved notebook could not be opened. Its stored copy has been retained. ${String(error)}`)}
      const remembered=notebooks.get(bookKey)
      if(remembered)notebook=remembered.book
      if(startupContent&&(startupContent as {kind?:string}).kind==='neuroimage-teaching-notebook'){setDrawer('tools');setTab('lessons')}
      if(startupContent&&!memory.has(viewKey)) {
        if((startupContent as {kind?:string}).kind==='neuroimage-teaching-notebook'){notebook=readModelNotebook(startupContent,m,l);initial=notebook.scenes[0]?.scene.state??initial;setDrawer('tools');setTab('lessons')}
        else initial=readModelScene(startupContent,m,l).state
      }
      if(cancelled)return
      setManifest(m);setLessons(l);setState(initial);stateRef.current=initial
      if(!remembered)notebooks.set(bookKey,{book:notebook,dirty:!!startupContent,activeId:notebook.scenes[0]?.id??null})
      try{const saved=!!(await readBrowserContent(storageKey));if(!cancelled)setSaved(saved)}catch{ /* Scene files work without browser storage. */ }
    }
    void load().catch(error=>{if(!cancelled){setLoadFailed(true);setStatus('Source loading failed');setError(String(error))}})
    return()=>{cancelled=true}
  },[atlas,viewKey,memory,notebooks,scope,startupContent,storageKey,bookKey])
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
  const structures=manifest?.structures.filter(item=>(!groupOnly||!scope||scope.structure_ids.includes(item.id))&&(!category||item.category===category)&&`${item.name} ${item.id} ${item.source_name}`.toLowerCase().includes(query.toLowerCase()))??[]
  const lesson=lessons.find(item=>item.id===state?.lesson_id),step=state?.lesson_step??0
  function choose(item:ModelSurface){if(state)patch({selected:item.id,position_native_mm:[...item.target_native_mm],visible:[...new Set([...state.visible,item.id])]})}
  function focusSelected(){if(!selected||!manifest||!state)return
    const bounds=(item:ModelSurface)=>viewer.current?.bounds(item.id)??item.bounds_native_mm
    const shown=manifest.structures.filter(item=>state.visible.includes(item.id)),width=Math.max(...[0,1,2].map(axis=>Math.max(...shown.map(item=>bounds(item)[1][axis]))-Math.min(...shown.map(item=>bounds(item)[0][axis])))),selectedBounds=bounds(selected),region=Math.max(...selectedBounds[1].map((v,i)=>v-selectedBounds[0][i]),1)
    patch({focus_native_mm:selectedBounds[0].map((value,axis)=>(value+selectedBounds[1][axis])/2) as Vec3,camera:[state.camera[0],state.camera[1],Math.max(1.4,Math.min(12,width/region))]})
  }
  function lessonStep(item:Lesson,index:number){const target=manifest!.structures.find(value=>value.id===item.steps[index].structure_id)!;patch({lesson_id:item.id,lesson_step:index,selected:target.id,position_native_mm:[...target.target_native_mm],visible:[...item.structure_ids],focus_native_mm:null,camera:[110,15,.65],lesson_answer:'',lesson_revealed:false})}
  async function settled(){const v=viewer.current;if(!v||!stateRef.current)throw Error('The model viewer is not ready.');await v.apply(stateRef.current);if(viewer.current!==v)throw Error('The model changed while saving.');return {viewer:v,state:v.snapshot(stateRef.current!)}}
  async function saveScene(){try{const current=await settled();await saveBrowserContent(storageKey,JSON.stringify(modelScene(manifest!,current.state)));setSaved(true);setStatus('Model scene saved in this browser')}catch(error){setError(`Could not save the scene. Export a scene file to retain your work. ${String(error)}`)}}
  async function restoreScene(){try{setState(readModelScene(JSON.parse(await readBrowserContent(storageKey)??'null'),manifest!,lessons).state);setStatus('Source-bound model scene restored')}catch(error){setError(String(error))}}
  async function sceneFile(){try{const current=await settled();download(JSON.stringify(modelScene(manifest!,current.state),null,2),manifest!.package_id+'-model-scene.json','application/json')}catch(error){setError(String(error))}}
  async function importFile(file:File|undefined){if(!file)return;try{if(file.size>10*1024**2)throw Error('Choose a scene of up to 10 MiB.');setState(readModelScene(JSON.parse(await file.text()),manifest!,lessons).state);setStatus('Source-bound scene restored')}catch(error){setError(String(error))}finally{if(sceneUpload.current)sceneUpload.current.value=''}}
  async function imageExport(){setExporting(true);try{const current=await settled();await exportModelImage(current.viewer.capture(),manifest!,current.state,atlas.base_url);setStatus('Model image, scene and source attribution exported')}catch(error){setError(String(error))}finally{setExporting(false)}}
  return <section className={'model-workspace '+(drawer?'showing-'+drawer:'')} aria-label="Independent source model viewer">
    {drawer==='library'&&<aside className="model-library"><div className="panel-title"><span>Source objects · {manifest?.structures.length??0}</span><button onClick={()=>setDrawer(null)}>Close</button></div>
      <input type="search" aria-label="Search model objects" placeholder="Search source objects…" value={query} onChange={event=>setQuery(event.target.value)}/>
      {scope?.structure_ids.length&&<label className="check-control"><input type="checkbox" checked={groupOnly} onChange={event=>setGroupOnly(event.target.checked)}/>{scope.title} only</label>}
      <SelectField aria-label="Model object category" value={category} onChange={event=>setCategory(event.target.value)}><option value="">All categories</option>{[...new Set(manifest?.structures.map(item=>item.category))].map(value=><option key={value}>{value}</option>)}</SelectField>
      <StructureVisibilityActions structures={structures} visible={state?.visible??[]} disabled={!ready} onChange={visible=>patch({visible})}/>
      <div className="structure-list">{structures.map(item=><div className={'structure-row '+(item.id===state?.selected?'selected':'')} key={item.id}><input type="checkbox" aria-label={'Show '+item.name} checked={state?.visible.includes(item.id)??false} disabled={!ready} onChange={event=>state&&patch({visible:event.target.checked?[...state.visible,item.id]:state.visible.filter(id=>id!==item.id)})}/><button disabled={!ready} onClick={()=>choose(item)}><span className="structure-color" style={{background:`rgb(${item.color.join(',')})`}}/><span>{item.name}<small>{item.laterality} · source label</small></span></button></div>)}</div>
    </aside>}
    <div className="model-view-column"><div className="workspace-heading"><div><div className="eyebrow">{scope?.title??'INDEPENDENT ANATOMICAL MODEL'}</div><h1>{manifest?.title??'Opening source model'}</h1></div></div>
      <div className="compact-toolbar"><button aria-expanded={drawer==='library'} onClick={()=>setDrawer(drawer==='library'?null:'library')}>Structure library</button><span className="compact-selection">{selected?.name??'Select a source object'}</span><button aria-expanded={drawer==='tools'} onClick={()=>setDrawer(drawer==='tools'?null:'tools')}>Learning tools</button></div>
      {error&&<div className="error" role="alert">{error}<button onClick={()=>setError('')}>Dismiss</button></div>}
      <div className="view-toolbar"><button disabled={!ready} onClick={()=>state&&patch({focus_native_mm:null,camera:[state.camera[0],state.camera[1],.65]})}>Full model view</button><button disabled={!ready||!selected} onClick={focusSelected}>Focus selected</button><button disabled={!ready||!selected} onClick={()=>selected&&patch({visible:[selected.id],focus_native_mm:null,camera:[110,15,.65]})}>Isolate selected</button>{manifest?.structures.some(item=>item.category==='Brainstem model context')&&<button disabled={!ready} onClick={()=>manifest&&patch({visible:manifest.structures.filter(item=>item.category==='Brainstem model context').map(item=>item.id).concat(state?.visible??[]) .filter((id,i,all)=>all.indexOf(id)===i)})}>Add brainstem context</button>}<label>3D opacity<input aria-label="Model opacity" type="range" min="0" max="1" step=".05" value={state?.opacity??1} onChange={event=>patch({opacity:Number(event.target.value)})}/></label></div>
      <div className="model-coordinate-bar"><label className="check-control"><input type="checkbox" checked={state?.highlightSelected??false} onChange={event=>patch({highlightSelected:event.target.checked})}/>Highlight selected</label><span>Source XYZ (mm): {state?.position_native_mm.map(value=>value.toFixed(2)).join(' · ')}</span><span>{state?.visible.length??0} visible objects</span></div>
      <div className="model-canvas-shell"><canvas ref={canvas} aria-label="Independent native source model"/></div>
      <div className="model-status" role="status">{status}{loadFailed&&<button onClick={()=>window.location.reload()}>Reload viewer</button>}<span>Drag to orbit · Scroll to zoom · Double-click a visible surface to locate</span></div>
      <div className="scene-toolbar"><button disabled={!ready} onClick={()=>void saveScene()}>Save scene</button><button disabled={!ready||!saved} onClick={restoreScene}>Restore saved</button><button disabled={!ready} onClick={()=>void sceneFile()}>Export scene</button><button disabled={!ready} onClick={()=>sceneUpload.current?.click()}>Import scene</button><button className="primary" disabled={!ready||exporting} onClick={()=>void imageExport()}>{exporting?'Preparing export…':'Export teaching image'}</button><input ref={sceneUpload} aria-label="Import model scene file" type="file" accept=".json" hidden onChange={event=>void importFile(event.target.files?.[0])}/></div>
    </div>
    {drawer==='tools'&&<aside className="model-tools"><div className="panel-title"><span>Study tools</span><button onClick={()=>setDrawer(null)}>Close</button></div><nav className="model-tool-tabs">{(['notes','lessons','sources'] as const).map(value=><button aria-pressed={tab===value} onClick={()=>setTab(value)} key={value}>{value==='notes'?'Inspect':value==='lessons'?'Learn':'Sources'}</button>)}</nav>
      {tab==='notes'&&state&&<><h2>{selected?.name??'Model observation'}</h2>{selected&&<><p className="small muted">{selected.laterality} · {selected.category}</p><label>Selected opacity<input aria-label="Selected model opacity" type="range" min="0" max="1" step=".05" value={state.surfaceOpacity[selected.id]??1} onChange={event=>patch({surfaceOpacity:{...state.surfaceOpacity,[selected.id]:Number(event.target.value)}})}/></label><details><summary>Source geometry</summary><p>{selected.evidence}</p><p>{selected.geometry.vertex_count.toLocaleString()} source vertices · {selected.geometry.triangle_count.toLocaleString()} triangles</p><p>{selected.geometry.method}</p>{selected.source_notes.map((note,i)=><p key={i}>{note}</p>)}</details></>}
      <h3>Teaching notes</h3><textarea aria-label="Model teaching notes" rows={4} maxLength={10000} value={state.note} onChange={event=>patch({note:event.target.value})}/>
      <h3>Location markers</h3><textarea aria-label="New model marker" rows={2} maxLength={2000} value={annotation} onChange={event=>setAnnotation(event.target.value)}/><button disabled={!ready||!annotation.trim()||state.annotations.length>=200} onClick={()=>{patch({annotations:[...state.annotations,{id:crypto.randomUUID(),text:annotation.trim(),position_native_mm:[...state.position_native_mm],structure_id:state.selected}]});setAnnotation('')}}>Add marker at cursor</button><p className="small muted">Markers project through the model. Source annotations retain the author's location and source record; added markers record your observations.</p>
      {state.annotations.length>0&&<label className="check-control"><input type="checkbox" checked={state.showMarkers} onChange={event=>patch({showMarkers:event.target.checked})}/>Show markers</label>}{state.annotations.map((item,i)=><div className="annotation" key={item.id}><button onClick={()=>patch({position_native_mm:[...item.position_native_mm],selected:item.structure_id,focus_native_mm:[...item.position_native_mm]})}>{i+1}. {item.text}</button><button aria-label={'Remove model marker '+(i+1)} onClick={()=>patch({annotations:state.annotations.filter(value=>value.id!==item.id)})}>×</button></div>)}
      <details className="model-cutaway"><summary>Native XYZ cutaway</summary><p>Display clipping reveals the interior view of selected original source surfaces.</p><button disabled={!selected} onClick={()=>selected&&patch({surfaceCutaway:{axis:2,side:1,position_mm:state.position_native_mm[2],structures:[selected.id]}})}>Cut selected at cursor</button>{state.surfaceCutaway&&<><label>Axis<SelectField aria-label="Model cutaway axis" value={state.surfaceCutaway.axis} onChange={event=>patch({surfaceCutaway:{...state.surfaceCutaway!,axis:Number(event.target.value) as 0|1|2,position_mm:state.position_native_mm[Number(event.target.value)]}})}>{['X','Y','Z'].map((axis,i)=><option value={i} key={axis}>{axis}</option>)}</SelectField></label><label>Native position (mm)<input aria-label="Model cutaway position" type="number" step=".5" value={state.surfaceCutaway.position_mm} onChange={event=>{const value=Number(event.target.value);if(Number.isFinite(value))patch({surfaceCutaway:{...state.surfaceCutaway!,position_mm:value}})}}/></label><button onClick={()=>patch({surfaceCutaway:{...state.surfaceCutaway!,side:state.surfaceCutaway!.side===1?-1:1}})}>Reverse cutaway</button><button onClick={()=>patch({surfaceCutaway:undefined})}>Remove cutaway</button></>}</details></>}
      {tab==='lessons'&&state&&<><div hidden={presenting}><h2>Lessons</h2><SelectField aria-label="Model lesson" value={state.lesson_id??''} onChange={event=>{const value=lessons.find(item=>item.id===event.target.value);if(value)lessonStep(value,0)}}><option value="">Choose a lesson…</option>{lessons.map(item=><option value={item.id} key={item.id}>{item.title}</option>)}</SelectField>{lesson&&<><p>{lesson.objective}</p><p>{lesson.instruction}</p><h3>Step {step+1} of {lesson.steps.length}</h3><p>{lesson.steps[step].prompt}</p><div className="button-row"><button disabled={!step} onClick={()=>lessonStep(lesson,step-1)}>Previous</button><button disabled={step===lesson.steps.length-1} onClick={()=>lessonStep(lesson,step+1)}>Next structure</button></div><p>{lesson.steps[step].question}</p><textarea aria-label="Model lesson response" rows={3} maxLength={2000} value={state.lesson_answer} onChange={event=>patch({lesson_answer:event.target.value})}/><button onClick={()=>patch({lesson_revealed:!state.lesson_revealed})}>{state.lesson_revealed?'Hide answer':'Reveal answer'}</button>{state.lesson_revealed&&<div className="source-answer"><strong>{manifest?.structures.find(item=>item.id===lesson.steps[step].structure_id)?.name}</strong>{lesson.steps[step].answer&&<p>{lesson.steps[step].answer}</p>}</div>}{manifest&&<StudyRecord binding={{package_id:manifest.package_id,package_version:manifest.package_version,build_signature:manifest.build.signature,space_id:manifest.space.id}} lessons={lessons} lesson={lesson} step={step} answer={state.lesson_answer} onRestore={answer=>patch({lesson_answer:answer})} onStep={index=>lessonStep(lesson,index)}/>}<LessonEvidence lesson={lesson}/></>}
      {manifest&&<EvidenceTopics source={manifest.dataset_id}/>}</div>{manifest&&<ModelTeachingNotebook manifest={manifest} lessons={lessons} ready={ready} storageKey={bookKey} drafts={notebooks} onPresentationChange={setPresenting} startPresenting={!!startupContent&&(startupContent as {kind?:string}).kind==='neuroimage-teaching-notebook'} capture={async()=>{const current=await settled();return modelScene(manifest,current.state)}} restore={scene=>{setState(structuredClone(scene.state));setStatus('Recorded model view restored')}}/>}</>}
      {tab==='sources'&&manifest&&<><h2>Source and coordinates</h2><p>{manifest.space.correspondence}</p><p>{manifest.space.unit_basis}</p><p className="small muted">Package {manifest.package_version} · Independent native XYZ in millimeters</p>{manifest.validation.warnings.filter(item=>!/expert review|anatomical review/i.test(item)).map((item,i)=><p className="evidence" key={i}>{item}</p>)}{manifest.sources.map(source=><section key={source.id}><h3>{source.title}</h3><p>{source.citation}</p><a href={source.url} target="_blank" rel="noreferrer">Official source</a><p>{source.version}</p><a href={atlas.base_url+source.license_file} target="_blank" rel="noreferrer">{source.license_name} · local license and attribution</a></section>)}</>}
    </aside>}
  </section>
}
