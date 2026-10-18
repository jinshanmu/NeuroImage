import { describe,expect,it } from 'vitest'
import { emptyStudyRecord, readStudyRecord, recordResponse } from './studyRecord'
import type { Lesson } from './types'
const binding={package_id:'source',package_version:'version',build_signature:'signature',space_id:'native'}
const lessons=[{id:'lesson',steps:[{structure_id:'left'},{structure_id:'right'}]}] as Lesson[]
const first={lesson_id:'lesson',step:0,structure_id:'left',answer:'My source observation',rating:'review' as const,updated_utc:'2026-10-18T00:00:00Z'}
describe('source-bound study records',()=>{
  it('retains other steps and replaces one saved response',()=>{
    let record=recordResponse(emptyStudyRecord(binding),first)
    record=recordResponse(record,{...first,step:1,structure_id:'right'})
    record=recordResponse(record,{...first,answer:'Revised observation',rating:'understood'})
    const imported=readStudyRecord(JSON.parse(JSON.stringify(record)),binding,lessons)
    expect(imported.responses).toHaveLength(2)
    expect(imported.responses.find(item=>item.step===0)?.answer).toBe('Revised observation')
    expect(imported.responses.find(item=>item.step===1)?.structure_id).toBe('right')
  })
  it('rejects mismatched sources, changed lesson targets and duplicate steps',()=>{
    const record=recordResponse(emptyStudyRecord(binding),first)
    expect(()=>readStudyRecord(record,{...binding,space_id:'another'},lessons)).toThrow('different source')
    expect(()=>readStudyRecord({...record,responses:[{...first,structure_id:'right'}]},binding,lessons)).toThrow('lesson step')
    expect(()=>readStudyRecord({...record,responses:[first,first]},binding,lessons)).toThrow('duplicate')
    expect(()=>readStudyRecord({...record,responses:[{...first,answer:'x'.repeat(2001)}]},binding,lessons)).toThrow('invalid')
    expect(()=>readStudyRecord({...record,responses:[{...first,step:99,structure_id:undefined}]},binding,lessons)).toThrow('lesson step')
  })
})
