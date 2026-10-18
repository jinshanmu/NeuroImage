import { useEffect, useRef, useState } from 'react'
import { readBrowserContent, saveBrowserContent } from './browserStorage'
import { download } from './scene'
import { emptyStudyRecord, readStudyRecord, recordResponse, studyKey } from './studyRecord'
import type { StudyBinding, StudyRecord as RecordFile, StudyResponse } from './studyRecord'
import type { Lesson } from './types'

export function StudyRecord({binding,lessons,lesson,step,answer,onRestore,onStep}:{binding:StudyBinding;lessons:Lesson[];lesson:Lesson;step:number;answer:string;onRestore:(answer:string)=>void;onStep:(step:number)=>void}) {
  const key=studyKey(binding),upload=useRef<HTMLInputElement>(null)
  const [record,setRecord]=useState<RecordFile>(()=>emptyStudyRecord(binding)),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  useEffect(()=>{let cancelled=false;setLoaded(false);setError('');setRecord(emptyStudyRecord(binding))
    void readBrowserContent(key).then(value=>{if(!cancelled){setRecord(value?readStudyRecord(JSON.parse(value),binding,lessons):emptyStudyRecord(binding));setLoaded(true)}}).catch(error=>{if(!cancelled)setError(`The saved study record could not be opened. Its stored copy is retained. ${String(error)}`)})
    return()=>{cancelled=true}
  },[key,lessons])
  useEffect(()=>{setNotice('')},[lesson.id,step])
  const responses=record.responses.filter(item=>item.lesson_id===lesson.id)
  const current=responses.find(item=>item.step===step),reviews=responses.filter(item=>item.rating==='review').sort((a,b)=>a.step-b.step)
  async function persist(next:RecordFile,message:string){setBusy(true);setError('');try{await saveBrowserContent(key,JSON.stringify(next));setRecord(next);setLoaded(true);setNotice(message)}catch(error){setError(String(error))}finally{setBusy(false)}}
  async function save(rating:StudyResponse['rating']){await persist(recordResponse(record,{lesson_id:lesson.id,step,structure_id:lesson.steps[step].structure_id,answer,rating,updated_utc:new Date().toISOString()}),'Response saved in this browser.')}
  async function importFile(file?:File){if(!file)return;try{if(file.size>10*1024**2)throw Error('Choose a study record of up to 10 MiB.');const imported=readStudyRecord(JSON.parse(await file.text()),binding,lessons)
    // Preserve both sets of steps; for a repeated step retain the newest record.
    let merged=record
    for(const response of imported.responses){const previous=merged.responses.find(item=>item.lesson_id===response.lesson_id&&item.step===response.step);if(!previous||Date.parse(response.updated_utc)>Date.parse(previous.updated_utc))merged=recordResponse(merged,response)}
    await persist(merged,'Study records merged. The most recent response is retained for each step.')
  }catch(error){setError(String(error))}finally{if(upload.current)upload.current.value=''}}
  return <section className="study-record" aria-label="Study record">
    <h3>Study record</h3><p className="small">{responses.length} / {lesson.steps.length} responses saved · {reviews.length} to review</p>
    <div className="button-row"><button disabled={!loaded||busy} onClick={()=>void save('saved')}>Save response</button><button disabled={!loaded||busy} aria-pressed={current?.rating==='review'} onClick={()=>void save('review')}>Review again</button><button disabled={!loaded||busy} aria-pressed={current?.rating==='understood'} onClick={()=>void save('understood')}>Understood</button></div>
    {current&&<button disabled={busy} onClick={()=>{onRestore(current.answer);setNotice('Saved response restored.')}}>Restore response</button>}
    <details><summary>Review and backup</summary>
      {reviews.length>0&&<div className="button-row">{reviews.map(item=><button key={item.step} onClick={()=>onStep(item.step)}>Review step {item.step+1}</button>)}</div>}
      <p className="small muted">These are your own study notes and confidence ratings. Export a record for backup.</p>
      <div className="button-row"><button disabled={!loaded||busy||!record.responses.length} onClick={()=>download(JSON.stringify(record,null,2),binding.package_id+'-study-record.json','application/json')}>Export record</button><button disabled={busy||(!loaded&&!error)} onClick={()=>upload.current?.click()}>Import record</button></div>
      <input ref={upload} hidden type="file" accept=".json,application/json" aria-label="Import study record" onChange={event=>void importFile(event.target.files?.[0])}/>
    </details>
    {notice&&<p className="small" role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}</p>}
  </section>
}
