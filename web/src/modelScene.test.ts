import { expect, it } from 'vitest'
import { initialModelView, modelScene, readModelScene, modelNotebook, readModelNotebook } from './modelScene'
import type { NativeSourceAnnotation, SurfaceManifest } from './modelTypes'

const manifest:SurfaceManifest={schema_version:'1.7',representation:'surface-model',package_id:'fixture',dataset_id:'fixture',title:'Synthetic source model',package_version:'v1',
  space:{id:'native-xyz',name:'Synthetic XYZ',coordinate_system:'SOURCE_XYZ',units:'mm',reference:'Generated geometry',correspondence:'No image correspondence',axis_status:'source_axes_not_anatomically_verified',unit_basis:'Synthetic millimeter fixture'},
  volumes:[],sources:[],assets:[],lessons_file:'lessons.json',build:{signature:'a'.repeat(64),software_version:'test'},validation:{engineering_status:'passed',anatomical_review:'not_performed',warnings:[]},
  structures:[{kind:'model-surface',id:'object-1',name:'Synthetic object',source_name:'Synthetic',category:'Fixture',laterality:'unspecified',color:[10,20,30],mesh_file:'fixture.gii',
    center_native_mm:[10,20,1600],target_native_mm:[11,21,1601],bounds_native_mm:[[0,0,1500],[20,30,1620]],evidence:'Synthetic test, not anatomy',source_notes:[],review_status:'not_reviewed',
    geometry:{source_input:'fixture',source_object:'Synthetic',source_type:'MESH',source_geometry_file:'fixture.npz',provenance_file:'fixture.json',vertex_count:3,triangle_count:1,target_vertex_index:0,transform_to_native_mm:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],method:'Synthetic test'}}]}

it('opens every source model and preserves an explicitly saved subset',()=>{
  const source:SurfaceManifest={...manifest,structures:Array.from({length:16},(_,i)=>({...manifest.structures[0],id:`object-${i}`}))}
  const state=initialModelView(source)
  expect(state.visible).toEqual(source.structures.map(item=>item.id))
  expect(readModelScene(modelScene(source,{...state,visible:['object-4']}),source).state.visible).toEqual(['object-4'])
  expect(readModelScene(modelScene(source,{...state,visible:[]}),source).state.visible).toEqual([])
})

it.each(['cranial-nerves','detail-arterial-ring'])('opens every model in %s and restores independent brain context',id=>{
  const source:SurfaceManifest={...manifest,structures:Array.from({length:24},(_,i)=>({...manifest.structures[0],id:`object-${i}`}))}
  const scope={id,title:'Source anatomy',structure_ids:source.structures.slice(4,22).map(s=>s.id)}
  const state=initialModelView(source,scope)
  expect(state.visible).toEqual(scope.structure_ids)
  expect(state.selected).toBe('object-4')
  state.surfaceContext={enabled:true,opacity:.2,structure_ids:['object-0','object-1']}
  expect(readModelScene(modelScene(source,state),source).state).toEqual(state)
  expect(initialModelView(source,{...scope,id:'general-anatomy'}).visible).toHaveLength(24)
  expect(()=>readModelScene(modelScene(source,{...state,surfaceContext:{enabled:true,opacity:.2,structure_ids:['missing']}}),source)).toThrow('background')
})

it('round-trips a source XYZ view with camera, clipping, markers and notes',()=>{
  const state=initialModelView(manifest)
  state.camera=[85,23,2.5];state.focus_native_mm=[12,17,1598];state.opacity=.7;state.surfaceOpacity={'object-1':.5}
  state.surfaceCutaway={axis:2,side:-1,position_mm:1580,structures:['object-1']}
  state.annotations=[{id:'note-1',text:'Synthetic marker',position_native_mm:[12,20,1587],structure_id:'object-1'}];state.note='Preserve the native source definition.'
  const scene=modelScene(manifest,state)
  expect(readModelScene(JSON.parse(JSON.stringify(scene)),manifest).state).toEqual(state)
  expect(JSON.stringify(scene.state)).not.toMatch(/position_ras|background|imageContext/)
  const book=modelNotebook(manifest);book.scenes=[{id:'view-1',title:'Test view',prompt:'Observe the synthetic object.',scene}]
  expect(readModelNotebook(book,manifest).scenes[0].scene.state).toEqual(state)
})

it('retains selection highlighting while keeping legacy source colors unchanged',()=>{
  const state=initialModelView(manifest)
  expect(readModelScene(modelScene(manifest,state),manifest).state.highlightSelected).toBe(true)
  delete state.highlightSelected
  expect(readModelScene(modelScene(manifest,state),manifest).state.highlightSelected).toBeUndefined()
  expect(()=>readModelScene(modelScene(manifest,{...state,highlightSelected:'yes'} as never),manifest)).toThrow('selection highlight')
})

it('rejects another model version, invented RAS assignment and unknown or malformed objects',()=>{
  const scene=modelScene(manifest,initialModelView(manifest))
  expect(()=>readModelScene({...scene,package_version:'v2'},manifest)).toThrow('exact original')
  for(const change of [{coordinate_system:'RAS'},{visible:['unknown']},{position_native_mm:[0,1,NaN]},{surfaceOpacity:{unknown:.4}},{background:'pretend-mri'}])
    expect(()=>readModelScene({...scene,state:{...scene.state,...change}},manifest)).toThrow()
  expect(()=>readModelNotebook({...modelNotebook(manifest),scenes:[null]},manifest)).toThrow('Invalid model notebook view')
})

it('preserves original source annotation evidence through scene and notebook recapture',()=>{
  const source=structuredClone(manifest)
  source.build.inputs=[{id:'fixture',sha256:'b'.repeat(64)}]
  source.build.recipe={adapter:'blender-source-surfaces',mesh_geometry_stage:'author-viewport'}
  source.structures[0].geometry.source_stage='author-viewport'
  const record:NativeSourceAnnotation={signature:'c'.repeat(64),source_sha256:'b'.repeat(64),coordinate_system:'SOURCE_XYZ',units:'mm',source_stage:'author-viewport',
    spec:{id:'synthetic-tip',mapping:'blender-hooked-label-tip-v1',source_input:'fixture',source_object:'Synthetic label.j',source_vertex_index:1,context_structure_id:'object-1',reference:'Generated test annotation'},
    embedded_script_execution:false,context_object:'Synthetic',context_transform_to_native_mm:source.structures[0].geometry.transform_to_native_mm,
    source_vertices:[[.001,.002,.003],[.004,.005,.006]],transform_to_native_mm:[[0,-1000,0,500],[1000,0,0,-200],[0,0,1000,1600],[0,0,0,1]],
    points_native_mm:[[498,-199,1603],[495,-196,1606]],position_native_mm:[495,-196,1606],edge_indices:[[0,1]],polygon_count:0,hook_vertex_indices:[1],method:'Generated fixture'}
  const state=initialModelView(source)
  state.annotations=[{id:'source-tip',text:'Original author marker',position_native_mm:[495,-196,1606],structure_id:'object-1',source_annotation:record}]
  const scene=readModelScene(JSON.parse(JSON.stringify(modelScene(source,state))),source)
  expect(scene.state.annotations[0].source_annotation).toEqual(record)
  expect(scene.provenance.source_annotations).toEqual([record])
  const book=modelNotebook(source);book.scenes=[{id:'one',title:'Source marker',prompt:'Inspect the original annotation.',scene}]
  expect(readModelNotebook(book,source).scenes[0].scene.provenance.source_annotations).toEqual([record])
  for(const change of [{source_sha256:'a'.repeat(64)},{context_object:'Other'},{source_stage:'base'},{hook_vertex_indices:[0]},
    {position_native_mm:[0,0,0]},{points_native_mm:[[498,-199,1603],[495,-196,1607]]},{context_transform_to_native_mm:null}]){
    const bad=structuredClone(scene);Object.assign(bad.state.annotations[0].source_annotation!,change)
    expect(()=>readModelScene(bad,source)).toThrow('original input, context and native point')
  }
  const moved=structuredClone(scene);moved.state.annotations[0].position_native_mm[0]+=1
  expect(()=>readModelScene(moved,source)).toThrow('native point')
})
