import type { Lesson } from './types'

export interface StudyBinding {package_id:string;package_version:string;build_signature:string;space_id:string}
export interface StudyResponse {lesson_id:string;step:number;structure_id:string;answer:string;rating:'saved'|'review'|'understood';updated_utc:string}
export interface StudyRecord extends StudyBinding {schema_version:'1.0';kind:'neuroimage-study-record';responses:StudyResponse[]}
export const studyKey=(binding:StudyBinding)=>'neuroimage:study:'+JSON.stringify(binding)
export const emptyStudyRecord=(binding:StudyBinding):StudyRecord=>({...binding,schema_version:'1.0',kind:'neuroimage-study-record',responses:[]})

export function readStudyRecord(value:unknown,binding:StudyBinding,lessons:Lesson[]):StudyRecord {
  const record=value as StudyRecord
  if(!record||record.kind!=='neuroimage-study-record'||record.schema_version!=='1.0')throw Error('Choose a NeuroImage study record.')
  if(Object.entries(binding).some(([key,value])=>record[key as keyof StudyBinding]!==value))throw Error('This study record belongs to a different source package or space.')
  if(!Array.isArray(record.responses)||record.responses.length>10000)throw Error('The study record has too many responses.')
  const keys=new Set<string>()
  for(const response of record.responses){
    const lesson=lessons.find(item=>item.id===response?.lesson_id)
    if(!response||!lesson||!Number.isInteger(response.step)||response.step<0||!lesson.steps[response.step]||typeof response.structure_id!=='string'||lesson.steps[response.step].structure_id!==response.structure_id)throw Error('A saved response does not match an available lesson step.')
    if(typeof response.answer!=='string'||response.answer.length>2000||!['saved','review','understood'].includes(response.rating)||typeof response.updated_utc!=='string'||!Number.isFinite(Date.parse(response.updated_utc)))throw Error('A saved response is invalid.')
    const key=JSON.stringify([response.lesson_id,response.step]);if(keys.has(key))throw Error('A lesson step has duplicate responses.');keys.add(key)
  }
  return {...emptyStudyRecord(binding),responses:record.responses.map(({lesson_id,step,structure_id,answer,rating,updated_utc})=>({lesson_id,step,structure_id,answer,rating,updated_utc}))}
}

export function recordResponse(record:StudyRecord,response:StudyResponse):StudyRecord {
  return {...record,responses:[...record.responses.filter(item=>item.lesson_id!==response.lesson_id||item.step!==response.step),response]}
}
