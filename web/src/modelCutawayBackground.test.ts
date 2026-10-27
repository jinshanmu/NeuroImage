import { expect, it, vi } from 'vitest'
import type { NVMesh } from '@niivue/niivue'
import { ModelViewer } from './modelViewer'
import { initialModelView } from './modelScene'
import type { ModelView, SurfaceManifest } from './modelTypes'
import type { Vec3 } from './types'
import { reserveBrainBackground } from './atlasBackground'

it('cuts native background meshes enabled after Cut, then removes them from clipping when background is off',async()=>{
  vi.stubGlobal('window',{devicePixelRatio:1})
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
  const manifest={structures:['subject','context'].map(id=>({id,source_name:id,name:id,color:[10,20,30],
    target_native_mm:[1,2,5],bounds_native_mm:[[0,0,0],[10,10,10]]}))} as unknown as SurfaceManifest
  const canvas={addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as HTMLCanvasElement
  const viewer=new ModelViewer(canvas,manifest,'/native/',()=>{},()=>{})
  try{
    viewer.nv.gl={} as WebGL2RenderingContext
    vi.spyOn(viewer.nv,'drawScene').mockImplementation(()=>{})
    const meshes=(viewer as unknown as {meshes:Map<string,NVMesh>}).meshes
    for(const id of ['subject','context']){
      const mesh={id:id+'-mesh',visible:true,opacity:1,rgba255:new Uint8Array([10,20,30,255]),
        pts:new Float32Array([0,0,0,10,0,0,0,10,0]),tris:new Uint32Array([0,1,2]),
        setProperty:vi.fn()} as unknown as NVMesh
      meshes.set(id,mesh)
    }
    const contextMesh=meshes.get('context')!,points=contextMesh.pts,triangles=contextMesh.tris
    const state={...initialModelView(manifest),visible:['subject'],surfaceContext:{enabled:false,opacity:.25,structure_ids:['context']},
      surfaceCutaway:{axis:2 as const,side:1 as const,position_mm:5,structures:['subject'],followCursor:true}}
    const targets=viewer.nv.cutawayMeshIds
    await viewer.apply(state)
    expect([...targets]).toEqual(['subject-mesh'])
    const background={...state,surfaceContext:{...state.surfaceContext,enabled:true}}
    await viewer.apply(background)
    expect([...targets]).toEqual(['subject-mesh','context-mesh'])
    expect(viewer.nv.cutawayMeshIds).toBe(targets)
    expect(viewer.nv.surfaceCutaway?.structures).toEqual(['subject'])
    expect(contextMesh.visible).toBe(true)
    expect(contextMesh.pts).toBe(points);expect(contextMesh.tris).toBe(triangles)
    await viewer.apply(state)
    expect([...targets]).toEqual(['subject-mesh'])
    expect(contextMesh.visible).toBe(false)
    await viewer.apply({...background,surfaceCutaway:undefined})
    expect([...targets]).toEqual([])
    expect(contextMesh.visible).toBe(true)
  }finally{
    viewer.dispose()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

it('retains the native model MVP, pivot and manual view when background opacity crosses zero and context geometry loads',async()=>{
  vi.stubGlobal('window',{devicePixelRatio:1})
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
  const manifest={structures:[
    {id:'subject',name:'Subject',source_name:'Subject',color:[10,20,30],mesh_file:'subject.gii',target_native_mm:[1,2,5],bounds_native_mm:[[0,0,0],[10,10,10]]},
    {id:'context',name:'Context',source_name:'Context',color:[10,20,30],mesh_file:'context.gii',target_native_mm:[-20,-15,-10],bounds_native_mm:[[-60,-40,-50],[20,30,20]]},
  ]} as unknown as SurfaceManifest
  const canvas={addEventListener:vi.fn(),removeEventListener:vi.fn()} as unknown as HTMLCanvasElement
  const viewer=new ModelViewer(canvas,manifest,'/native/',()=>{},()=>{})
  try{
    viewer.nv.gl={canvas:{width:400,height:400}} as WebGL2RenderingContext
    vi.spyOn(viewer.nv,'drawScene').mockImplementation(()=>{})
    const internal=viewer as unknown as {meshes:Map<string,NVMesh>;renderedBounds:Map<string,[Vec3,Vec3]>}
    const mesh=(id:string)=>({id,visible:true,opacity:1,rgba255:new Uint8Array([10,20,30,255]),
      pts:new Float32Array([0,0,0,10,0,0,0,10,0]),tris:new Uint32Array([0,1,2]),setProperty:vi.fn()} as unknown as NVMesh)
    internal.meshes.set('subject',mesh('subject'))
    const state=reserveBrainBackground({...initialModelView(manifest),visible:['subject']},['subject','context'])
    const projection=()=>({matrix:Array.from(viewer.nv.calculateMvpMatrix(null,[0,0,400,400],viewer.nv.scene.renderAzimuth,viewer.nv.scene.renderElevation)[0]),
      pivot:[...viewer.nv.pivot3D],radius:viewer.nv.furthestFromPivot,scale:viewer.nv.scene.volScaleMultiplier,bounds:viewer.nv.modelBounds})
    for(const settings of [{camera:[110,15,.65] as ModelView['camera'],focus_native_mm:null},
      {camera:[35,-12,2.7] as ModelView['camera'],focus_native_mm:null},
      {camera:[145,30,3.2] as ModelView['camera'],focus_native_mm:[5,-7,3] as Vec3}]){
      const view=(opacity:number):ModelView=>({...state,...settings,surfaceContext:{...state.surfaceContext!,enabled:opacity>0,opacity}})
      await viewer.apply(view(0))
      const original=projection()
      expect(original.matrix.every(Number.isFinite)).toBe(true)
      expect(original.bounds).toEqual([[-60,-40,-50],[20,30,20]])
      // A lazy context mesh can have tighter measured bounds than its source
      // reference. Loading that geometry must not move the established frame.
      internal.meshes.set('context',mesh('context'))
      internal.renderedBounds.set('context',[[-55,-35,-45],[15,25,15]])
      for(const opacity of [.05,.6,0]){
        const next=view(opacity)
        await viewer.apply(next)
        expect(projection()).toEqual(original)
        expect(viewer.nv.focus).toEqual(settings.focus_native_mm)
        expect(viewer.snapshot(next).camera).toEqual(settings.camera)
        expect(internal.meshes.get('context')!.visible).toBe(opacity>0)
      }
    }
  }finally{
    viewer.dispose();vi.restoreAllMocks();vi.unstubAllGlobals()
  }
})
