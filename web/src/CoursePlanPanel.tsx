import { SelectField } from './SelectField'
import { useEffect, useState } from 'react'
import { workspacePost } from './workspaceApi'

interface CoursePlan {id:string;title:string;objective:string;views:number;requirements:{dataset_id:string;curricula:string[]}[]}
interface Package {key?:string;dataset_id:string;package_version?:string;title?:string;space_name?:string;status:string;compatible_curricula?:string[]}
interface Catalog {course_plans:CoursePlan[];packages:Package[];sources:{id:string;title:string}[];active_job:string|null}
interface Job {id:string;status:string;detail:string;request:{action:string;course_plan?:string;package_keys?:Record<string,string>};events:{event:string;curriculum?:string;completed?:number;total?:number}[];result?:{course_id?:string;views?:number;source_count?:number;status?:string}}
const DRAFT_KEY='neuroimage:course-plan-preparation:v1'
function remembered():{plan:string;packages:Record<string,string>;job:string}{try{const value=JSON.parse(localStorage.getItem(DRAFT_KEY)??'{}');return {plan:typeof value.plan==='string'?value.plan:'',packages:value.packages&&typeof value.packages==='object'?value.packages:{},job:/^[a-f0-9]{32}$/.test(value.job??'')?value.job:''}}catch{return {plan:'',packages:{},job:''}}}

export function CoursePlanPanel({onPresent,onPrepared}:{onPresent:(id:string)=>Promise<void>;onPrepared:()=>void}) {
  const [saved]=useState(remembered),[catalog,setCatalog]=useState<Catalog|null>(null),[planId,setPlanId]=useState(saved.plan)
  const [choices,setChoices]=useState<Record<string,string>>(saved.packages),[jobId,setJobId]=useState(saved.job),[job,setJob]=useState<Job|null>(null)
  const [loading,setLoading]=useState(true),[pending,setPending]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0)
  useEffect(()=>{const controller=new AbortController();setLoading(true);void fetch('/api/workspace',{signal:controller.signal}).then(async response=>{
    const value=await response.json();if(!response.ok)throw Error(value.error);const order=['intracranial-foundations','regional-source-comparisons','white-matter-pathways','vascular-source-observation','cranial-nerve-context','cisternal-spatial-observation','skull-base-context'];value.course_plans.sort((a:CoursePlan,b:CoursePlan)=>order.indexOf(a.id)-order.indexOf(b.id));setCatalog(value);setPlanId(current=>value.course_plans.some((plan:CoursePlan)=>plan.id===current)?current:value.course_plans[0]?.id??'');if(value.active_job)setJobId(value.active_job)
  }).catch(error=>{if(!controller.signal.aborted)setError(String(error))}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[revision])
  useEffect(()=>{try{localStorage.setItem(DRAFT_KEY,JSON.stringify({plan:planId,packages:choices,job:jobId}))}catch{/* Explicit saved courses remain on the data drive. */}},[planId,choices,jobId])
  useEffect(()=>{if(!jobId)return;let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController()
    async function poll(){try{const response=await fetch('/api/workspace/jobs/'+jobId,{signal:controller.signal}),value:Job&{error?:string}=await response.json();if(!response.ok)throw Error(value.error);if(cancelled)return;setJob(value)
      if(['running','stopping'].includes(value.status))timer=setTimeout(poll,1800);else{setCatalog(current=>current?.active_job===jobId?{...current,active_job:null}:current);if(value.status==='complete'&&value.result?.course_id)onPrepared()}
    }catch(error){if(!cancelled)setError(String(error))}}
    void poll();return()=>{cancelled=true;controller.abort();if(timer)clearTimeout(timer)}
  },[jobId])
  const plan=catalog?.course_plans.find(item=>item.id===planId)
  const available=(dataset:string,curricula:string[])=>catalog?.packages.filter(item=>item.status==='available'&&item.key&&item.dataset_id===dataset&&curricula.every(name=>item.compatible_curricula?.includes(name)))??[]
  const selected:Record<string,string>={}
  for(const requirement of plan?.requirements??[]){const options=available(requirement.dataset_id,requirement.curricula);selected[requirement.dataset_id]=options.some(item=>item.key===choices[requirement.dataset_id])?choices[requirement.dataset_id]:options.length===1?options[0].key!:''}
  const running=!!catalog?.active_job||!!job&&['running','stopping'].includes(job.status),busy=pending||running||loading
  async function prepare(){if(!plan)return;setPending(true);setError('');try{const request={action:'prepare-course',course_plan:plan.id,package_keys:selected};const value=await workspacePost<{id:string;status:string}>('/api/workspace/jobs',request);setJob({...value,request,detail:'Starting source course preparation',events:[]});setJobId(value.id);setChoices(selected)}catch(error){setError(String(error))}finally{setPending(false)}}
  async function stop(){if(!job)return;setPending(true);setError('');try{const value=await workspacePost<{id:string;status:string}>('/api/workspace/jobs/'+job.id+'/cancel',{});setJob({...job,status:value.status})}catch(error){setError(String(error))}finally{setPending(false)}}
  async function present(){if(!job?.result?.course_id)return;setPending(true);setError('');try{await onPresent(job.result.course_id)}catch(error){setError(String(error))}finally{setPending(false)}}
  const progress=job?.events.filter(event=>event.event==='course-notebook-ready').at(-1)
  return <section className="course-plan-panel" aria-label="Prepare a source course">
    <div className="manager-heading"><div><h2>Start from a course plan</h2><p>Choose a topic and your local source versions. Prepare its recorded views, then open the course for teaching.</p></div><button disabled={busy} onClick={()=>setRevision(value=>value+1)}>Refresh source choices</button></div>
    {loading?<p role="status">Loading course plans and source choices…</p>:<>
      <label>Course plan<SelectField aria-label="Course plan" value={planId} disabled={busy} onChange={event=>setPlanId(event.target.value)}>{catalog?.course_plans.map(item=><option key={item.id} value={item.id}>{item.title} · {item.views} views</option>)}</SelectField></label>
      {plan&&<><p>{plan.objective}</p><div className="course-source-choices">{plan.requirements.map(requirement=>{const options=available(requirement.dataset_id,requirement.curricula),title=catalog?.sources.find(item=>item.id===requirement.dataset_id)?.title??requirement.dataset_id;return <label key={requirement.dataset_id}>{title}<SelectField aria-label={'Course source '+requirement.dataset_id} value={selected[requirement.dataset_id]} disabled={busy||!options.length} onChange={event=>setChoices(current=>({...current,[requirement.dataset_id]:event.target.value}))}><option value="">{options.length?'Choose a local source version…':'Build this source atlas in Library & build'}</option>{options.map(item=><option key={item.key} value={item.key}>{item.space_name} · {item.package_version}</option>)}</SelectField></label>})}</div>
      <div className="button-row"><button className="primary" disabled={busy||!Object.values(selected).every(Boolean)} onClick={()=>void prepare()}>Prepare course</button><small>Each source keeps its original coordinates, source definitions and attribution.</small></div></>}
    </>}
    {job&&<div className="course-preparation-status" role="status"><strong>{job.status==='complete'&&job.result?.course_id?'Course ready':job.status==='running'?'Preparing source views':job.status}</strong><p>{progress?`${progress.completed} of ${progress.total} source notebooks ready. `:''}{job.status==='complete'&&job.result?.course_id?`${job.result.views} views · ${job.result.source_count} sources · Saved on the data drive.`:job.detail}</p>
      {job.status==='complete'&&job.result?.course_id&&<button disabled={pending} onClick={()=>void present()}>Open prepared course</button>}
      {running&&job.request.action==='prepare-course'?<button disabled={pending||job.status==='stopping'} onClick={()=>void stop()}>Stop course preparation</button>:null}
      <details><summary>Preparation and recovery</summary><p>Repeat the same plan and source choices to reuse completed notebooks. Source scenes retain their exact package versions. Make a course copy in the organizer to adapt a prepared sequence.</p><code>{job.id}</code></details>
    </div>}
    {error&&<p className="error" role="alert">{error}<button onClick={()=>setError('')}>Dismiss</button></p>}
  </section>
}
