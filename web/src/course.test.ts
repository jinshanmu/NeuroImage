import { expect, it } from 'vitest'
import { appendCourseContent, newCourse, readCourse } from './course'

const source={id:'fixture',title:'Generated fixture',version:'1',url:'https://example.org/fixture',citation:'Synthetic test input',license_name:'CC0',license_url:'https://creativecommons.org/publicdomain/zero/1.0/',license_file:'licenses/fixture.txt'}
function scene(model:boolean) {
  return {schema_version:'1.0',kind:'neuroimage-scene',title:'Synthetic view',saved_utc:'2026-10-13T00:00:00Z',package_id:model?'model':'image',package_version:'v1',build_signature:'a'.repeat(64),space_id:model?'native-xyz':'native-ras',
    state:model?{kind:'source-model-view',coordinate_system:'SOURCE_XYZ',position_native_mm:[2,4,1600],selected:'model-object'}:{position:[-18,12,22],selected:'image-label'},
    provenance:{sources:[source],processing:{signature:'a'.repeat(64)},anatomical_review:'not_performed'}}
}
it('preserves independently bound image and model scenes through a portable course',()=>{
  const first=scene(false),second=scene(true)
  let course=appendCourseContent(newCourse(),first)
  course=appendCourseContent(course,{kind:'neuroimage-teaching-notebook',scenes:[{title:'Model view',prompt:'Inspect source XYZ',scene:second}]})
  const saved=readCourse(JSON.parse(JSON.stringify(course)))
  expect(saved.entries.map(entry=>entry.scene.space_id)).toEqual(['native-ras','native-xyz'])
  expect(saved.entries.map(entry=>entry.scene.state)).toEqual([first.state,second.state])
  first.state.selected='changed after capture'
  expect(saved.entries[0].scene.state.selected).toBe('image-label')
  expect(saved.entries[1].scene.provenance.sources[0]).toEqual(source)
})
it('rejects damaged bindings, missing attribution and duplicate view identities',()=>{
  const course=appendCourseContent(newCourse(),scene(false))
  expect(()=>readCourse({...course,entries:[course.entries[0],course.entries[0]]})).toThrow('uniquely')
  for(const field of ['space_id','build_signature','provenance']) {
    const bad=structuredClone(course) as unknown as {entries:Array<{scene:Record<string,unknown>}>}
    delete bad.entries[0].scene[field]
    expect(()=>readCourse(bad)).toThrow('attribution')
  }
  expect(()=>readCourse({...course,id:'../another-file'})).toThrow('identifier')
})
it('enforces a bounded course while keeping original source definitions',()=>{
  const entry={title:'Synthetic image',prompt:'Inspect the source',scene:scene(false)}
  const course=appendCourseContent(newCourse(),{kind:'neuroimage-teaching-notebook',scenes:Array.from({length:100},()=>entry)})
  expect(new Set(course.entries.map(value=>value.id)).size).toBe(100)
  expect(()=>appendCourseContent(course,scene(true))).toThrow('100')
})
