import { useEffect, useRef, useState } from 'react'
import { saveBrowserContent } from './browserStorage'
import { download } from './scene'
import { modelNotebook, readModelNotebook } from './modelScene'
import type { Lesson } from './types'
import type { ModelNotebook, ModelScene, SurfaceManifest } from './modelTypes'

export interface ModelNotebookDraft { book: ModelNotebook; dirty: boolean; activeId: string | null }
interface Props {
  manifest: SurfaceManifest; lessons: Lesson[]; ready: boolean; storageKey: string;
  drafts: Map<string, ModelNotebookDraft>; startPresenting?: boolean;
  capture: () => Promise<ModelScene>; restore: (scene: ModelScene) => void;
  onPresentationChange?: (presenting:boolean) => void;
}

export function ModelTeachingNotebook({manifest,lessons,ready,storageKey,drafts,startPresenting=false,capture,restore,onPresentationChange}:Props) {
  const [draft,setDraft]=useState<ModelNotebookDraft>(()=>drafts.get(storageKey)??{
    book:modelNotebook(manifest),dirty:false,activeId:null})
  const [presenting,setPresenting]=useState(startPresenting),[busy,setBusy]=useState(false)
  useEffect(()=>{onPresentationChange?.(presenting)},[presenting,onPresentationChange])
  const [prompt,setPrompt]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('')
  const [removed,setRemoved]=useState<{entry:ModelNotebook['scenes'][number];index:number}|null>(null)
  const upload=useRef<HTMLInputElement>(null)
  const {book,dirty,activeId}=draft,activeIndex=book.scenes.findIndex(entry=>entry.id===activeId),active=book.scenes[activeIndex]
  function remember(value:ModelNotebookDraft){drafts.set(storageKey,value);setDraft(value)}
  function edit(value:ModelNotebook,selection=activeId){remember({book:{...value,updated_utc:new Date().toISOString()},dirty:true,activeId:selection});setError('');setMessage('')}
  function open(entry:ModelNotebook['scenes'][number]){restore(entry.scene);remember({...draft,activeId:entry.id});setMessage(`Opened view ${book.scenes.indexOf(entry)+1}: ${entry.title}`)}
  function editEntry(value:Partial<ModelNotebook['scenes'][number]>){edit({...book,scenes:book.scenes.map(entry=>entry.id===activeId?{...entry,...value}:entry)})}
  async function captureView(replace=false){
    setBusy(true);setError('')
    try{
      const scene=await capture()
      if(replace&&active)editEntry({scene})
      else if(book.scenes.length<50){const entry={id:crypto.randomUUID(),title:manifest.structures.find(item=>item.id===scene.state.selected)?.name??'Model observation',prompt,scene};edit({...book,scenes:[...book.scenes,entry]},entry.id);setPrompt('')}
    }catch(error){setError(String(error))}finally{setBusy(false)}
  }
  function move(direction:number){const destination=activeIndex+direction;if(activeIndex<0||destination<0||destination>=book.scenes.length)return;const scenes=[...book.scenes];[scenes[activeIndex],scenes[destination]]=[scenes[destination],scenes[activeIndex]];edit({...book,scenes})}
  function remove(){if(!active)return;setRemoved({entry:active,index:activeIndex});const scenes=book.scenes.filter(entry=>entry.id!==active.id);edit({...book,scenes},scenes[Math.min(activeIndex,scenes.length-1)]?.id??null)}
  function undo(){if(!removed||book.scenes.length>=50)return;const scenes=[...book.scenes];scenes.splice(Math.min(removed.index,scenes.length),0,removed.entry);edit({...book,scenes},removed.entry.id);setRemoved(null)}
  function serialize(){const value=JSON.stringify(readModelNotebook(book,manifest,lessons),null,2);if(new TextEncoder().encode(value).length>10*1024**2)throw Error('Split this notebook into files of up to 10 MiB.');return value}
  async function save(){setBusy(true);try{await saveBrowserContent(storageKey,serialize());remember({...draft,dirty:false});setError('');setMessage('Model notebook saved in this browser. Export a file for backup.')}catch(error){setError(`Could not save the notebook. Your work remains open; export a file to retain it. ${String(error)}`)}finally{setBusy(false)}}
  function exportFile(){try{download(serialize(),manifest.package_id+'-model-notebook.json','application/json');setError('');setMessage('Notebook exported with native scenes and source records.')}catch(error){setError(String(error))}}
  async function importFile(file?:File){if(!file)return;try{if(file.size>10*1024**2)throw Error('Choose a notebook of up to 10 MiB.');const value=readModelNotebook(JSON.parse(await file.text()),manifest,lessons);edit(value,value.scenes[0]?.id??null);setPresenting(false);setRemoved(null);setMessage('Notebook imported. Open a view to explore it, then save your working copy.')}catch(error){setError(String(error))}finally{if(upload.current)upload.current.value=''}}
  return <details className="teaching-notebook" aria-label="Model teaching notebook editor" open={startPresenting||undefined}>
    <summary>My model notebook · {book.scenes.length} views{dirty?' · unsaved':''}</summary>
    {presenting&&active?<section className="notebook-presentation" aria-label="Model notebook presentation">
      <h3>{book.title}</h3>{book.author&&<p className="small muted">{book.author}</p>}{book.objective&&<p>{book.objective}</p>}
      <div className="lesson-progress">View {activeIndex+1} of {book.scenes.length}</div><h3>{active.title}</h3><p className="notebook-prompt">{active.prompt||'Explore the recorded source model and its teaching notes.'}</p>
      <div className="button-row"><button disabled={!ready||busy||activeIndex===0} onClick={()=>open(book.scenes[activeIndex-1])}>Previous view</button><button disabled={!ready||busy||activeIndex===book.scenes.length-1} onClick={()=>open(book.scenes[activeIndex+1])}>Next view</button></div>
      <button disabled={!ready||busy} onClick={()=>open(active)}>Return to recorded view</button><button onClick={()=>setPresenting(false)}>Edit notebook</button>
    </section>:<button disabled={!ready||busy||!book.scenes.length} onClick={()=>{open(active??book.scenes[0]);setPresenting(true)}}>Present notebook</button>}
    <div hidden={presenting}>
      <label>Notebook title<input aria-label="Model notebook title" maxLength={200} value={book.title} disabled={busy} onChange={event=>edit({...book,title:event.target.value})}/></label>
      <label>Author<input aria-label="Model notebook author" maxLength={200} value={book.author??''} disabled={busy} onChange={event=>edit({...book,author:event.target.value})}/></label>
      <label>Learning objective<textarea aria-label="Model notebook objective" maxLength={2000} rows={3} value={book.objective??''} disabled={busy} onChange={event=>edit({...book,objective:event.target.value})}/></label>
      <textarea aria-label="Model notebook prompt" maxLength={4000} rows={3} value={prompt} disabled={busy} placeholder="Prompt for the current view…" onChange={event=>setPrompt(event.target.value)}/>
      <button disabled={!ready||busy||book.scenes.length>=50} onClick={()=>void captureView()}>Add current view</button>
      <ol className="notebook-scenes" aria-label="Model notebook views">{book.scenes.map((entry,index)=><li key={entry.id}><button aria-label={`Open model notebook view ${index+1}: ${entry.title}`} aria-pressed={entry.id===activeId} disabled={!ready||busy} onClick={()=>open(entry)}>{index+1}. {entry.title}</button></li>)}</ol>
      {active&&<section className="notebook-entry" aria-label="Selected model notebook view">
        <label>View title<input aria-label="Selected model view title" maxLength={200} value={active.title} disabled={busy} onChange={event=>editEntry({title:event.target.value})}/></label>
        <label>Discussion prompt<textarea aria-label="Model discussion prompt" rows={3} maxLength={4000} value={active.prompt} disabled={busy} onChange={event=>editEntry({prompt:event.target.value})}/></label>
        <button disabled={!ready||busy} onClick={()=>void captureView(true)}>Update view from current model</button>
        <div className="button-row"><button disabled={busy||activeIndex===0} onClick={()=>move(-1)}>Move earlier</button><button disabled={busy||activeIndex===book.scenes.length-1} onClick={()=>move(1)}>Move later</button><button disabled={busy} onClick={remove}>Remove view</button></div>
      </section>}
      {removed&&<button disabled={busy||book.scenes.length>=50} onClick={undo}>Undo view removal</button>}
    </div>
    <div className="notebook-files"><button disabled={busy} onClick={save}>Save notebook</button><button disabled={busy} onClick={exportFile}>Export notebook</button><button disabled={busy} onClick={()=>upload.current?.click()}>Import notebook</button></div>
    <input ref={upload} aria-label="Import model notebook file" type="file" hidden accept=".json,application/json" onChange={event=>void importFile(event.target.files?.[0])}/>
    {!presenting&&<p className="small muted">Up to 50 views tied to this source model version. Save your working copy and export it with source records.</p>}
    {message&&<p role="status" className="notebook-message">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </details>
}
