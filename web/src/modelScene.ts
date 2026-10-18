import { processingRecord } from './provenance'
import { validateCutaway } from './cutaway'
import type { ModelNotebook, ModelScene, ModelView, SurfaceManifest } from './modelTypes'
import type { Lesson, Vec3 } from './types'
import { validSourceAnnotation } from './sourceAnnotation'

const vec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(x=>typeof x==='number' && Number.isFinite(x))
const text = (value: unknown, maximum: number): value is string => typeof value==='string' && value.length<=maximum
export function initialModelView(manifest: SurfaceManifest): ModelView {
  const first = manifest.structures.find(item=>item.source_name==='Basilar artery') ?? manifest.structures[0]
  const visible = manifest.structures.filter(item=>['Basilar artery','Posterior cerebral artery.l','Posterior cerebral artery.r','Pons.l','Pons.r','Midbrain.l','Midbrain.r'].includes(item.source_name)).map(item=>item.id)
  return {kind:'source-model-view',coordinate_system:'SOURCE_XYZ',selected:first.id,visible:[...new Set([...visible,first.id])],
    position_native_mm:[...first.target_native_mm],camera:[110,15,.65],focus_native_mm:null,opacity:1,surfaceOpacity:{},
    annotations:[],showMarkers:true,highlightSelected:true,note:'',lesson_id:null,lesson_step:0,lesson_answer:'',lesson_revealed:false}
}
export function modelScene(manifest: SurfaceManifest,state: ModelView,title='Independent model teaching scene'): ModelScene {
  return {schema_version:'1.0',kind:'neuroimage-scene',title,saved_utc:new Date().toISOString(),package_id:manifest.package_id,
    package_version:manifest.package_version,build_signature:manifest.build.signature,space_id:manifest.space.id,state:structuredClone(state),
    provenance:{sources:manifest.sources,processing:processingRecord(manifest.build),anatomical_review:manifest.validation.anatomical_review,
      renderer:__NEUROIMAGE_VIEWER__,representation:'surface-model',source_annotations:state.annotations.flatMap(marker=>marker.source_annotation?[structuredClone(marker.source_annotation)]:[])}}
}
export function readModelScene(value: unknown,manifest: SurfaceManifest,lessons: Lesson[]=[]): ModelScene {
  if(!value || typeof value!=='object')throw Error('Expected an independent model scene.')
  const scene=value as ModelScene, s=scene.state, ids=new Set(manifest.structures.map(item=>item.id))
  if(scene.schema_version!=='1.0'||scene.kind!=='neuroimage-scene'||scene.package_id!==manifest.package_id||scene.package_version!==manifest.package_version||scene.build_signature!==manifest.build.signature||scene.space_id!==manifest.space.id)throw Error('This scene requires its exact original model package and native space.')
  const allowed=new Set(['kind','coordinate_system','selected','visible','position_native_mm','camera','focus_native_mm','opacity','surfaceOpacity','surfaceCutaway','highlightSelected','annotations','showMarkers','note','lesson_id','lesson_step','lesson_answer','lesson_revealed'])
  if(s&&Object.keys(s).some(key=>!allowed.has(key)))throw Error('The native model scene contains unsupported image or coordinate fields.')
  if(!s||s.kind!=='source-model-view'||s.coordinate_system!=='SOURCE_XYZ'||!Array.isArray(s.visible)||new Set(s.visible).size!==s.visible.length||s.visible.some(id=>!ids.has(id))||(s.selected!==null&&!ids.has(s.selected)))throw Error('The scene contains unknown model objects or an incompatible coordinate representation.')
  if(!vec3(s.position_native_mm)||!vec3(s.camera)||s.camera[2]<.1||s.camera[2]>20||(s.focus_native_mm!==null&&!vec3(s.focus_native_mm))||!Number.isFinite(s.opacity)||s.opacity<0||s.opacity>1)throw Error('Invalid native model position, camera or opacity.')
  if(!s.surfaceOpacity||typeof s.surfaceOpacity!=='object'||Array.isArray(s.surfaceOpacity)||Object.entries(s.surfaceOpacity).some(([id,v])=>!ids.has(id)||!Number.isFinite(v)||v<0||v>1))throw Error('Invalid model opacity settings.')
  if(s.surfaceCutaway!==undefined&&!validateCutaway(s.surfaceCutaway,ids))throw Error('Invalid native XYZ model cutaway.')
  if(s.highlightSelected!==undefined&&typeof s.highlightSelected!=='boolean')throw Error('Invalid model selection highlight.')
  if(!Array.isArray(s.annotations)||s.annotations.length>200||new Set(s.annotations.map(a=>a?.id)).size!==s.annotations.length||s.annotations.some(a=>!a||!text(a.id,100)||!text(a.text,2000)||!vec3(a.position_native_mm)||(a.structure_id!==null&&!ids.has(a.structure_id)))||typeof s.showMarkers!=='boolean'||!text(s.note,10000))throw Error('Invalid source-model teaching annotations.')
  if(s.annotations.some(marker=>marker.source_annotation!==undefined&&!validSourceAnnotation(marker.source_annotation,manifest,marker)))throw Error('A source annotation requires its original input, context and native point.')
  const lesson=lessons.find(lesson=>lesson.id===s.lesson_id)
  if(!text(s.lesson_answer,2000)||typeof s.lesson_revealed!=='boolean'||!Number.isInteger(s.lesson_step)||s.lesson_step<0||(s.lesson_id!==null&&(!lesson||s.lesson_step>=lesson.steps.length)))throw Error('The saved model lesson is unavailable.')
  return modelScene(manifest,s,text(scene.title,200)?scene.title:'Restored model scene')
}
export function modelNotebook(manifest: SurfaceManifest,title='Independent model notebook'): ModelNotebook {
  const now=new Date().toISOString()
  return {schema_version:'1.0',kind:'neuroimage-teaching-notebook',title,created_utc:now,updated_utc:now,package_id:manifest.package_id,
    package_version:manifest.package_version,build_signature:manifest.build.signature,space_id:manifest.space.id,scenes:[]}
}
export function readModelNotebook(value: unknown,manifest: SurfaceManifest,lessons: Lesson[]=[]): ModelNotebook {
  if(!value||typeof value!=='object')throw Error('Expected a source model notebook.')
  const book=value as ModelNotebook, expected=modelNotebook(manifest)
  for(const field of ['schema_version','kind','package_id','package_version','build_signature','space_id'] as const)if(book[field]!==expected[field])throw Error('This notebook requires its exact independent source model.')
  if(!text(book.title,200)||!Array.isArray(book.scenes)||book.scenes.length>50||new Set(book.scenes.map(s=>s?.id)).size!==book.scenes.length)throw Error('Invalid model notebook inventory.')
  if((book.author!==undefined&&!text(book.author,200))||(book.objective!==undefined&&!text(book.objective,2000)))throw Error('Invalid model notebook author or objective.')
  const scenes=book.scenes.map(entry=>{
    if(!entry||!text(entry.id,100)||!text(entry.title,200)||!text(entry.prompt,4000))throw Error('Invalid model notebook view.')
    return {...entry,scene:readModelScene(entry.scene,manifest,lessons)}
  })
  return {...book,scenes}
}
