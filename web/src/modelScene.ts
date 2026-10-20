import { processingRecord } from './provenance'
import { validateCutaway } from './cutaway'
import type { ModelScene, ModelView, SurfaceManifest } from './modelTypes'
import type { Vec3 } from './types'
import { validSourceAnnotation } from './sourceAnnotation'
import { scopedStructures, validSurfaceContext } from './atlasBackground'
import type { AnatomyScope } from './anatomyNavigation'

const vec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(x=>typeof x==='number' && Number.isFinite(x))
const text = (value: unknown, maximum: number): value is string => typeof value==='string' && value.length<=maximum
export function initialModelView(manifest: SurfaceManifest, scope?: AnatomyScope): ModelView {
  const structures=scopedStructures(manifest.structures,scope)
  const first = structures.find(item=>item.source_name==='Basilar artery') ?? structures[0] ?? manifest.structures[0]
  return {kind:'source-model-view',coordinate_system:'SOURCE_XYZ',selected:structures.length?first.id:null,visible:structures.map(item=>item.id),
    position_native_mm:[...first.target_native_mm],camera:[110,15,.65],focus_native_mm:null,opacity:1,surfaceOpacity:{},
    annotations:[],showMarkers:true,highlightSelected:true,note:''}
}
export function modelScene(manifest: SurfaceManifest,state: ModelView,title='Independent model scene'): ModelScene {
  // Accept historical scenes without reactivating their removed lesson state.
  const {lesson_id:_lesson,lesson_step:_step,lesson_answer:_answer,lesson_revealed:_revealed,...view} = state as ModelView & {lesson_id?:unknown;lesson_step?:unknown;lesson_answer?:unknown;lesson_revealed?:unknown}
  return {schema_version:'1.0',kind:'neuroimage-scene',title,saved_utc:new Date().toISOString(),package_id:manifest.package_id,
    package_version:manifest.package_version,build_signature:manifest.build.signature,space_id:manifest.space.id,state:structuredClone(view),
    provenance:{sources:manifest.sources,processing:processingRecord(manifest.build),anatomical_review:manifest.validation.anatomical_review,
      renderer:__NEUROIMAGE_VIEWER__,representation:'surface-model',source_annotations:state.annotations.flatMap(marker=>marker.source_annotation?[structuredClone(marker.source_annotation)]:[])}}
}
export function readModelScene(value: unknown,manifest: SurfaceManifest): ModelScene {
  if(!value || typeof value!=='object')throw Error('Expected an independent model scene.')
  const scene=value as ModelScene, s=scene.state, ids=new Set(manifest.structures.map(item=>item.id))
  if(scene.schema_version!=='1.0'||scene.kind!=='neuroimage-scene'||scene.package_id!==manifest.package_id||scene.package_version!==manifest.package_version||scene.build_signature!==manifest.build.signature||scene.space_id!==manifest.space.id)throw Error('This scene requires its exact original model package and native space.')
  const allowed=new Set(['kind','coordinate_system','selected','visible','position_native_mm','camera','focus_native_mm','opacity','surfaceOpacity','surfaceContext','surfaceCutaway','highlightSelected','annotations','showMarkers','note','lesson_id','lesson_step','lesson_answer','lesson_revealed'])
  if(s&&Object.keys(s).some(key=>!allowed.has(key)))throw Error('The native model scene contains unsupported image or coordinate fields.')
  if(!s||s.kind!=='source-model-view'||s.coordinate_system!=='SOURCE_XYZ'||!Array.isArray(s.visible)||new Set(s.visible).size!==s.visible.length||s.visible.some(id=>!ids.has(id))||(s.selected!==null&&!ids.has(s.selected)))throw Error('The scene contains unknown model objects or an incompatible coordinate representation.')
  if(!vec3(s.position_native_mm)||!vec3(s.camera)||s.camera[2]<.1||s.camera[2]>20||(s.focus_native_mm!==null&&!vec3(s.focus_native_mm))||!Number.isFinite(s.opacity)||s.opacity<0||s.opacity>1)throw Error('Invalid native model position, camera or opacity.')
  if(!s.surfaceOpacity||typeof s.surfaceOpacity!=='object'||Array.isArray(s.surfaceOpacity)||Object.entries(s.surfaceOpacity).some(([id,v])=>!ids.has(id)||!Number.isFinite(v)||v<0||v>1))throw Error('Invalid model opacity settings.')
  if(s.surfaceCutaway!==undefined&&!validateCutaway(s.surfaceCutaway,ids))throw Error('Invalid native XYZ model cutaway.')
  if(s.surfaceContext!==undefined&&!validSurfaceContext(s.surfaceContext,ids))throw Error('Invalid native XYZ background structures.')
  if(s.highlightSelected!==undefined&&typeof s.highlightSelected!=='boolean')throw Error('Invalid model selection highlight.')
  if(!Array.isArray(s.annotations)||s.annotations.length>200||new Set(s.annotations.map(a=>a?.id)).size!==s.annotations.length||s.annotations.some(a=>!a||!text(a.id,100)||!text(a.text,2000)||!vec3(a.position_native_mm)||(a.structure_id!==null&&!ids.has(a.structure_id)))||typeof s.showMarkers!=='boolean'||!text(s.note,10000))throw Error('Invalid source-model annotations.')
  if(s.annotations.some(marker=>marker.source_annotation!==undefined&&!validSourceAnnotation(marker.source_annotation,manifest,marker)))throw Error('A source annotation requires its original input, context and native point.')
  return modelScene(manifest,s,text(scene.title,200)?scene.title:'Restored model scene')
}
