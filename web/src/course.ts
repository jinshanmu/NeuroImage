import type { ModelScene } from './modelTypes'
import { readBrowserContent } from './browserStorage'
import type { SceneFile } from './types'

export type CourseScene = SceneFile | ModelScene
export interface CourseEntry { id:string; title:string; prompt:string; scene:CourseScene }
export interface TeachingCourse {
  schema_version:'1.0';kind:'neuroimage-teaching-course';id:string;title:string;author:string;objective:string;
  created_utc:string;updated_utc:string;entries:CourseEntry[];
}
export interface CourseDraft {course:TeachingCourse;revision:string|null;dirty:boolean}
export interface CourseLocation {id:string;status:string;title?:string;representation?:string;space_name?:string;detail?:string}
export interface SavedCourse {course:TeachingCourse;revision:string;position:number;locations:CourseLocation[]}
export const COURSE_DRAFT_KEY='neuroimage:course-editor-draft:v1'
const fields=['package_id','package_version','build_signature','space_id'] as const
const text=(value:unknown,max:number,required=false):value is string=>typeof value==='string'&&value.length<=max&&(!required||!!value.trim())

export function newCourse():TeachingCourse {
  const now=new Date().toISOString()
  return {schema_version:'1.0',kind:'neuroimage-teaching-course',id:crypto.randomUUID(),title:'My anatomy course',author:'',objective:'',created_utc:now,updated_utc:now,entries:[]}
}
export function readCourse(value:unknown):TeachingCourse {
  if(!value||typeof value!=='object')throw Error('Choose a NeuroImage course file.')
  const course=value as TeachingCourse
  if(course.schema_version!=='1.0'||course.kind!=='neuroimage-teaching-course'||!text(course.id,36,true)||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(course.id))throw Error('Choose a course with its original format and identifier.')
  if(!text(course.title,200,true)||!text(course.author,200)||!text(course.objective,4000)||!text(course.created_utc,64,true)||!text(course.updated_utc,64,true))throw Error('Check the course title, author, objective and saved dates.')
  if(!Array.isArray(course.entries)||course.entries.length>100||new Set(course.entries.map(entry=>entry?.id)).size!==course.entries.length)throw Error('A course contains up to 100 uniquely identified views.')
  for(const entry of course.entries) {
    const scene=entry?.scene
    if(!entry||!text(entry.id,100,true)||!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(entry.id)||!text(entry.title,200,true)||!text(entry.prompt,4000)||!scene||scene.kind!=='neuroimage-scene'||scene.schema_version!=='1.0'||!scene.state||fields.some(field=>!text(scene[field],256,true))||!scene.provenance?.sources?.length||!scene.provenance.processing)throw Error('Each course view retains its source scene, attribution and processing records.')
  }
  if(new TextEncoder().encode(JSON.stringify(course)).length>10*1024**2)throw Error('Split the course into files of up to 10 MiB.')
  return structuredClone(course)
}
export function appendCourseContent(course:TeachingCourse, content:unknown):TeachingCourse {
  if(!content||typeof content!=='object')throw Error('Choose a saved scene or notebook.')
  const value=content as {kind:string;title?:string;scenes?:Array<{title:string;prompt:string;scene:CourseScene}>}
  const scenes=value.kind==='neuroimage-scene'?[{title:value.title??'Source observation',prompt:'',scene:content as CourseScene}]:value.kind==='neuroimage-teaching-notebook'?value.scenes:undefined
  if(!scenes)throw Error('Add a source scene or notebook to this course.')
  return readCourse({...course,updated_utc:new Date().toISOString(),entries:[...course.entries,...scenes.map(entry=>({id:crypto.randomUUID(),title:entry.title,prompt:entry.prompt,scene:structuredClone(entry.scene)}))]})
}
export async function restoreCourseDraft():Promise<CourseDraft|null> {
  const raw=await readBrowserContent(COURSE_DRAFT_KEY)
  if(raw===null)return null
  const value=JSON.parse(raw)
  if(value&&typeof value.dirty==='boolean'&&(value.revision===null||typeof value.revision==='string'))return {...value,course:readCourse(value.course)}
  throw Error('The saved course draft could not be opened. Its stored copy has been retained.')
}
