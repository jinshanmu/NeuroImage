import { SelectField } from './SelectField'
import { useEffect, useRef, useState } from 'react'
import { removeBrowserContent, saveBrowserContent } from './browserStorage'
import { CourseManager } from './CourseManager'
import { CoursePlanPanel } from './CoursePlanPanel'
import { appendCourseContent, COURSE_DRAFT_KEY, newCourse, restoreCourseDraft } from './course'
import type { CourseDraft } from './course'
import { workspacePost } from './workspaceApi'

export interface TeachingLibraryRecord {
  key:string;kind:'neuroimage-scene'|'neuroimage-teaching-notebook';title:string;author:string;objective:string;views:number;
  dataset_id:string;source_title?:string;representation?:string;space_name?:string;status:string;detail?:string;relative_path:string;
  binding:{package_id:string;package_version:string;build_signature:string;space_id:string};
}

export function TeachingLibrary({onOpen,onPresentCourse,requestedCourse}:{onOpen:(key:string)=>Promise<void>;onPresentCourse:(id:string)=>Promise<void>;requestedCourse?:string}) {
  const [records,setRecords]=useState<TeachingLibraryRecord[]>([]),[query,setQuery]=useState(''),[dataset,setDataset]=useState('')
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('')
  const [revision,setRevision]=useState(0),upload=useRef<HTMLInputElement>(null)
  const [page,setPage]=useState(0),pageSize=12
  const [courseDraft,setCourseDraft]=useState<CourseDraft|null>(null),[draftLoading,setDraftLoading]=useState(true)
  const draftWrites=useRef<Promise<void>>(Promise.resolve())
  useEffect(()=>{let cancelled=false;void restoreCourseDraft().then(value=>{if(!cancelled)setCourseDraft(value)}).catch(error=>{if(!cancelled)setError(`Your saved draft has been retained. ${String(error)}`)}).finally(()=>{if(!cancelled)setDraftLoading(false)});return()=>{cancelled=true}},[])
  function rememberCourse(value:CourseDraft|null){setCourseDraft(value);const content=value?JSON.stringify(value):null;draftWrites.current=draftWrites.current.catch(()=>{}).then(()=>content===null?removeBrowserContent(COURSE_DRAFT_KEY):saveBrowserContent(COURSE_DRAFT_KEY,content)).catch(()=>{setMessage('Your course is open. Save it on the data drive or export a file to retain this draft.')})}
  async function addToCourse(key:string){setBusy(key);setError('');try{const response=await fetch('/api/workspace/teaching/'+encodeURIComponent(key)),value=await response.json();if(!response.ok)throw Error(value.error);const draft=courseDraft??{course:newCourse(),revision:null,dirty:true};rememberCourse({...draft,course:appendCourseContent(draft.course,value.content),dirty:true});setMessage('Source views added to the course. Arrange them in the course organizer and save your course.')}catch(error){setError(String(error))}finally{setBusy('')}}
  useEffect(()=>{const controller=new AbortController();setLoading(true)
    fetch('/api/workspace/teaching'+(revision?'?refresh=1':''),{signal:controller.signal}).then(async response=>{const value=await response.json();if(!response.ok)throw Error(value.error);setRecords(value.records)}).catch(error=>{if(!controller.signal.aborted)setError(String(error))}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[revision])
  const filtered=records.filter(item=>(!dataset||item.dataset_id===dataset)&&`${item.title} ${item.author} ${item.objective} ${item.dataset_id}`.toLowerCase().includes(query.toLowerCase()))
  useEffect(()=>setPage(0),[query,dataset,revision])
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/pageSize)-1)),first=currentPage*pageSize
  const displayed=filtered.slice(first,first+pageSize)
  async function open(key:string){setBusy(key);setError('');try{await onOpen(key)}catch(error){setError(String(error))}finally{setBusy('')}}
  async function importFile(file?:File){if(!file)return;setBusy('import');setError('')
    try{if(file.size>10*1024**2)throw Error('Choose a scene or notebook of up to 10 MiB.');const content=JSON.parse(await file.text())
      const result=await workspacePost<{status:string}>('/api/workspace/teaching',content)
      setMessage(result.status==='reused'?'This exact teaching file is already in your local library.':'Teaching file added with its exact source binding.');setRevision(value=>value+1)
    }catch(error){setError(String(error))}finally{setBusy('');if(upload.current)upload.current.value=''}
  }
  return <main className="teaching-library" aria-label="Local teaching library">
    <div className="manager-heading"><div><h1>Teaching library</h1><p>Courses, notebooks and saved views.</p></div><div className="button-row"><button disabled={!!busy} onClick={()=>upload.current?.click()}>Import teaching file</button><button disabled={!!busy||loading} onClick={()=>setRevision(value=>value+1)}>Refresh</button></div></div>
    <input ref={upload} type="file" accept=".json,application/json" aria-label="Import teaching file" hidden onChange={event=>void importFile(event.target.files?.[0])}/>
    <CoursePlanPanel onPresent={onPresentCourse} onPrepared={()=>setRevision(value=>value+1)}/>
    {draftLoading?<p role="status">Opening your course draft…</p>:<CourseManager draft={courseDraft} onDraft={rememberCourse} onPresent={onPresentCourse} requestedId={requestedCourse} refreshKey={revision}/>}
    <div className="teaching-library-filters"><label>Find a notebook or scene<input type="search" aria-label="Search teaching library" maxLength={200} value={query} placeholder="Topic, source or author…" onChange={event=>setQuery(event.target.value)}/></label><label>Source<SelectField aria-label="Teaching library source" value={dataset} onChange={event=>setDataset(event.target.value)}><option value="">All sources</option>{[...new Set(records.map(item=>item.dataset_id))].sort().map(id=><option value={id} key={id}>{id}</option>)}</SelectField></label></div>
    {error&&<p className="error" role="alert">{error}<button onClick={()=>setError('')}>Dismiss</button></p>}{message&&<p role="status">{message}</p>}
    {loading?<p role="status">Opening your local teaching collection…</p>:<p className="small muted">{filtered.length?`${first+1}–${first+displayed.length} of ${filtered.length} teaching files`:'0 teaching files'}</p>}
    {filtered.length>pageSize&&<nav className="button-row" aria-label="Teaching file pages"><button disabled={!currentPage||!!busy} onClick={()=>setPage(currentPage-1)}>Previous files</button><span>Page {currentPage+1} of {Math.ceil(filtered.length/pageSize)}</span><button disabled={first+pageSize>=filtered.length||!!busy} onClick={()=>setPage(currentPage+1)}>Next files</button></nav>}
    {!loading&&!filtered.length&&<p className="empty-library">Prepare a notebook in your source atlas tools, or add a scene or notebook file from your computer.</p>}
    <div className="teaching-library-grid">{displayed.map(item=><article className="teaching-card" key={item.key} aria-label={item.title}>
      <div className="eyebrow">{item.kind==='neuroimage-scene'?'SAVED SCENE':`${item.views} RECORDED VIEWS`} · {item.representation==='surface-model'?'3D MODEL':'IMAGE ATLAS'}</div><h2>{item.title}</h2>{item.author&&<p className="small muted">{item.author}</p>}{item.objective&&<p>{item.objective}</p>}
      <p className="teaching-source">{item.source_title??item.dataset_id}<small>{item.space_name??item.binding.space_id} · {item.binding.package_version}</small></p>
      {item.status==='ready'?<div className="button-row"><button className="primary" disabled={!!busy} onClick={()=>void open(item.key)}>{busy===item.key?'Opening source…':item.kind==='neuroimage-scene'?'Open scene':'Open notebook'}</button><a href={'/?teaching-content='+encodeURIComponent(item.key)} target="_blank" rel="noreferrer">Open in a new page</a></div>:<details><summary>Restore the original source package</summary><p>{item.detail}</p></details>}
      {item.status==='ready'&&<button disabled={!!busy||draftLoading} onClick={()=>void addToCourse(item.key)}>Add to course</button>}
      <details><summary>Saved file and source identity</summary><code>{item.relative_path}</code><p>{item.binding.package_id} · {item.binding.package_version}</p></details>
    </article>)}</div>
  </main>
}
