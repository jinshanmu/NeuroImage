import type { Niivue } from '@niivue/niivue'
import { modelRenderKey } from './renderState'
import { NVMesh } from '@niivue/niivue'
import { unProject } from '@niivue/niivue/utils'
import { SourceDepthNiivue } from './depthRenderer'
import { depthSamplePixel, decodeSurfaceDepth } from './picking'
import { removedByCutaway } from './cutaway'
import { pickModelSurface } from './modelSelection'
import { triangleBounds } from './modelBounds'
import type { ModelView, SurfaceManifest } from './modelTypes'
import type { Vec3 } from './types'
import { BACKGROUND_COLOR, contextIds, contextOpacity } from './atlasBackground'
import { loadAssetsInOrder } from './assetLoading'

class NativeModelNiivue extends SourceDepthNiivue {
  modelBounds:[Vec3,Vec3]|null=null
  focus:Vec3|null=null
  onNativePick:(position:Vec3)=>void=()=>{}
  override setPivot3D() {
    if(!this.modelBounds){super.setPivot3D();return}
    const [low,high]=this.modelBounds
    this.extentsMin=[...low];this.extentsMax=[...high]
    this.pivot3D=this.focus?[...this.focus]:low.map((v,i)=>(v+high[i])/2)
    this.furthestFromPivot=Math.max(1,Math.hypot(...high.map((v,i)=>v-low[i]))/2)
  }
  override depthPicker(...args:Parameters<Niivue['depthPicker']>) {
    if(!this.uiData.mouseDepthPicker)return
    this.uiData.mouseDepthPicker=false
    const sample=depthSamplePixel(this.mousePos,this.gl.canvas.height,this.gl.getParameter(this.gl.VIEWPORT))
    if(!sample)return
    const rgba=new Uint8Array(4)
    this.gl.readPixels(sample.x,sample.y,1,1,this.gl.RGBA,this.gl.UNSIGNED_BYTE,rgba)
    const depth=decodeSurfaceDepth(rgba)
    if(depth===null)return
    const point=Array.from(unProject(sample.fx,sample.fy,depth,args[1])).slice(0,3) as Vec3
    if(point.every(Number.isFinite))this.onNativePick(point)
  }
  override sliceScroll3D(change=0) {
    if(change)this.setScale(Math.max(.1,Math.min(20,this.scene.volScaleMultiplier*(change>0?1.1:.9))))
  }
}

export class ModelViewer {
  readonly nv:NativeModelNiivue
  private meshes=new Map<string,NVMesh>()
  private renderedBounds=new Map<string,[Vec3,Vec3]>()
  private current:ModelView|null=null
  private generation=0
  private task:Promise<void>|null=null
  private appliedKey=''
  private disposed=false
  private attached=false
  private released=false
  private syncing=false
  private loading=new AbortController()
  private resize:ResizeObserver
  constructor(private canvas:HTMLCanvasElement,private manifest:SurfaceManifest,private base:string,
    private changed:(patch:Partial<ModelView>)=>void,private status:(message:string)=>void) {
    this.nv=new NativeModelNiivue({backColor:[.025,.045,.066,1],fontColor:[.74,.8,.86,1],
      isOrientCube:false,isOrientationTextVisible:false,show3Dcrosshair:false,isRuler:false,isColorbar:false,
      isDepthPickMesh:true,dragAndDropEnabled:false,loadingText:'',logLevel:'error'})
    const bounds=new Map(manifest.structures.map(item=>[item.id,item.bounds_native_mm]))
    this.nv.onNativePick=position=>{
      if(!this.current||this.disposed||this.syncing)return
      const selected=pickModelSurface(position,this.meshes,bounds,this.current.selected,id=>this.current!.visible.includes(id)&&!removedByCutaway(this.current!.surfaceCutaway,id,position))
      if(selected)this.changed({selected,position_native_mm:position})
    }
    this.nv.onAzimuthElevationChange=(a,e)=>this.emit({camera:[a,e,this.nv.scene.volScaleMultiplier]})
    this.nv.onZoom3DChange=z=>this.emit({camera:[this.nv.scene.renderAzimuth,this.nv.scene.renderElevation,z]})
    this.resize=new ResizeObserver(()=>{if(!this.disposed&&this.nv.canvas)this.nv.resizeListener()})
  }
  private emit(patch:Partial<ModelView>) {
    if(!this.syncing&&!this.disposed&&this.current&&Object.entries(patch).some(([key,value])=>JSON.stringify(value)!==JSON.stringify(this.current![key as keyof ModelView])))this.changed(patch)
  }
  async initialize(state:ModelView) {
    await this.nv.attachToCanvas(this.canvas);this.attached=true
    if(this.disposed){this.release();return}
    this.nv.setSliceType(this.nv.sliceTypeRender)
    this.resize.observe(this.canvas.parentElement!)
    await this.apply(state)
  }
  apply(state:ModelView):Promise<void> {
    if(this.disposed)return Promise.resolve()
    this.current=state
    if(!this.task&&this.appliedKey===modelRenderKey(state))return Promise.resolve()
    this.generation++
    if(!this.task)this.task=this.drain().finally(()=>{this.task=null;if(this.disposed)this.release()})
    return this.task
  }
  private async drain() {
    let completed=-1
    while(!this.disposed&&completed!==this.generation) {
      const generation=this.generation,state=this.current!
      await this.render(state,generation);completed=generation
      if(!this.disposed&&generation===this.generation)this.appliedKey=modelRenderKey(state)
    }
  }
  private async render(state:ModelView,generation:number) {
    const nv=this.nv, context=new Set(contextIds(state)), visible=new Set([...state.visible,...context])
    for(const [id,mesh] of this.meshes){mesh.visible=visible.has(id);mesh.opacity=contextOpacity(state,id,state.opacity*(state.surfaceOpacity[id]??1))}
    nv.deferMeshUpdates=true
    try {
      const missing=[...visible].filter(id=>!this.meshes.has(id)).map(id=>this.manifest.structures.find(item=>item.id===id)!)
      await loadAssetsInOrder(missing,structure=>this.base+structure.mesh_file,async(structure,buffer)=>{
        const id=structure.id
        this.status('Loading '+structure.name)
        const mesh=await nv.addMeshFromUrl({url:this.base+structure.mesh_file,buffer,name:structure.source_name+'.gii',rgba255:[...(context.has(id)?BACKGROUND_COLOR:structure.color),255],visible:false,opacity:1})
        if(this.disposed)return
        this.meshes.set(id,mesh)
        const bounds=mesh.tris?triangleBounds(mesh.pts,mesh.tris):null
        if(bounds)this.renderedBounds.set(id,bounds)
        mesh.visible=this.current!.visible.includes(id)||contextIds(this.current!).includes(id);mesh.opacity=contextOpacity(this.current!,id,this.current!.opacity*(this.current!.surfaceOpacity[id]??1))
      },this.loading.signal,()=>!this.disposed&&generation===this.generation)
      if(this.disposed||generation!==this.generation)return
      for(const [id,mesh] of this.meshes)if(this.meshes.size>32&&!visible.has(id)){nv.removeMesh(mesh);this.meshes.delete(id);this.renderedBounds.delete(id)}
    } finally {nv.deferMeshUpdates=false}
    if(this.disposed||generation!==this.generation)return
    for(const [id,mesh] of this.meshes) {
      const source=this.manifest.structures.find(item=>item.id===id)!
      const color=context.has(id)?[...BACKGROUND_COLOR,255]:state.highlightSelected&&id===state.selected?[90,240,214,255]:[...source.color,255]
      if(color.some((value,axis)=>mesh.rgba255[axis]!==value))mesh.setProperty('rgba255',new Uint8Array(color),nv.gl)
    }
    const displayed=this.manifest.structures.filter(item=>visible.has(item.id))
    const geometry=displayed.length?displayed:this.manifest.structures
    nv.modelBounds=[ [0,1,2].map(axis=>Math.min(...geometry.map(item=>this.bounds(item.id)![0][axis]))) as Vec3,
      [0,1,2].map(axis=>Math.max(...geometry.map(item=>this.bounds(item.id)![1][axis]))) as Vec3 ]
    this.syncing=true
    try {
      nv.focus=state.focus_native_mm
      // Mesh loading updates the renderer pivot before this view's bounds exist.
      // Recompute it after applying visible source bounds and the recorded focus.
      nv.setPivot3D()
      nv.scene.renderAzimuth=state.camera[0];nv.scene.renderElevation=state.camera[1];nv.scene.volScaleMultiplier=state.camera[2]
      nv.surfaceCutaway=state.surfaceCutaway
      nv.cutawayMeshIds=new Set([...this.meshes].filter(([id])=>state.surfaceCutaway?.structures.includes(id)).map(([,mesh])=>mesh.id))
      // The inherited 3D marker projector accepts numeric world coordinates.
      // Its historical field name does not assign RAS axes: only native XYZ is
      // stored, exported or shown here, and there are no 2D image slices.
      nv.markers=state.annotations.map(item=>({...item,position_ras_mm:item.position_native_mm}))
      nv.showMarkers=state.showMarkers
      nv.drawScene()
    } finally{this.syncing=false}
    this.status('Ready · independent source model')
  }
  snapshot(state:ModelView):ModelView {
    return {...state,camera:[this.nv.scene.renderAzimuth,this.nv.scene.renderElevation,this.nv.scene.volScaleMultiplier]}
  }
  bounds(id:string):[Vec3,Vec3]|undefined {return this.renderedBounds.get(id)??this.manifest.structures.find(item=>item.id===id)?.bounds_native_mm}
  capture(){this.nv.drawScene();return this.canvas.toDataURL('image/png')}
  private release(){if(!this.attached||this.released)return;this.released=true;this.nv.cleanup();this.nv.gl.getExtension('WEBGL_lose_context')?.loseContext();this.meshes.clear()}
  dispose(){this.disposed=true;this.loading.abort();this.generation++;this.resize.disconnect();if(!this.task)this.release()}
}
