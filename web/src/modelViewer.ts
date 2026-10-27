import type { Niivue } from '@niivue/niivue'
import { modelAssetKey, modelRenderKey } from './renderState'
import { NVMesh } from '@niivue/niivue'
import { unProject } from '@niivue/niivue/utils'
import { SourceDepthNiivue } from './depthRenderer'
import { depthSamplePixel, decodeSurfaceDepth } from './picking'
import { cursorCutaway, removedByCutaway } from './cutaway'
import { pickModelSurface } from './modelSelection'
import { triangleBounds } from './modelBounds'
import type { ModelSurface, ModelView, SurfaceManifest } from './modelTypes'
import type { Vec3 } from './types'
import { BACKGROUND_COLOR, contextIds, contextOpacity } from './atlasBackground'
import { loadAssetsInOrder } from './assetLoading'
import { RenderAssets } from './renderAssets'
import { addPreparedMesh } from './meshLoading'
import { pickCanvas3D, SliceClickGesture } from './canvasSelection'
import { CursorReadout } from './cursorReadout'
import { cursorPlanePoint } from './cursorPlane'

class NativeModelNiivue extends SourceDepthNiivue {
  modelBounds:[Vec3,Vec3]|null=null
  focus:Vec3|null=null
  cursorPlanePosition:Vec3=[0,0,0]
  onNativePick:(position:Vec3,surfaceHit?:boolean)=>void=()=>{}
  override resetBriCon(...args:Parameters<Niivue['resetBriCon']>) {
    if(args[0]?.type==='dblclick')return
    super.resetBriCon(...args)
  }
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
    if(depth===null){
      const position=cursorPlanePoint(sample.fx,sample.fy,this.cursorPlanePosition,args[1])
      if(position)this.onNativePick(position,false)
      return
    }
    const point=Array.from(unProject(sample.fx,sample.fy,depth,args[1])).slice(0,3) as Vec3
    if(point.every(Number.isFinite))this.onNativePick(point,true)
  }
  override sliceScroll3D(change=0) {
    if(change)this.setScale(Math.max(.1,Math.min(20,this.scene.volScaleMultiplier*(change>0?1.1:.9))))
  }
}

const cursorModelView=(state:ModelView):ModelView=>{
  const surfaceCutaway=cursorCutaway(state.surfaceCutaway,state.position_native_mm)
  return surfaceCutaway===state.surfaceCutaway?state:{...state,surfaceCutaway}
}

export class ModelViewer {
  readonly nv:NativeModelNiivue
  private meshes=new Map<string,NVMesh>()
  private renderedBounds=new Map<string,[Vec3,Vec3]>()
  private current:ModelView|null=null
  private nativeUpdate:ModelView|null=null
  private generation=0
  private assetGeneration=0
  private requestedAssetKey=''
  private requestedKey=''
  private task:Promise<void>|null=null
  private appliedKey=''
  private disposed=false
  private attached=false
  private released=false
  private syncing=false
  private clickGesture=new SliceClickGesture()
  private cursorReadout=new CursorReadout()
  private loading=new AbortController()
  private resources:RenderAssets
  private resize:ResizeObserver
  constructor(private canvas:HTMLCanvasElement,private manifest:SurfaceManifest,private base:string,
    private changed:(patch:Partial<ModelView>)=>void,private status:(message:string)=>void) {
    this.resources=new RenderAssets(base)
    this.nv=new NativeModelNiivue({backColor:[.025,.045,.066,1],fontColor:[.74,.8,.86,1],
      isOrientCube:false,isOrientationTextVisible:false,show3Dcrosshair:false,isRuler:false,isColorbar:false,
      isDepthPickMesh:true,dragAndDropEnabled:false,loadingText:'',logLevel:'error'})
    const bounds=new Map(manifest.structures.map(item=>[item.id,item.bounds_native_mm]))
    this.nv.onNativePick=(position,surfaceHit=true)=>{
      if(!this.current||this.disposed||this.syncing)return
      const sampledCutaway=this.nv.surfaceCutaway
      const selected=surfaceHit?pickModelSurface(position,this.meshes,bounds,this.current.selected,id=>this.current!.visible.includes(id)&&!removedByCutaway(sampledCutaway,id,position)):null
      this.setCursorStructure(position,selected)
      // The unprojected point is native SOURCE_XYZ. The recursive 3D pass
      // follows immediately, before React can echo the new display cursor.
      this.nv.surfaceCutaway=cursorCutaway((this.nativeUpdate??this.current).surfaceCutaway,position)
      this.emit({selected,position_native_mm:position},true)
    }
    this.nv.onAzimuthElevationChange=(a,e)=>this.emit({camera:[a,e,this.nv.scene.volScaleMultiplier]},true)
    this.nv.onZoom3DChange=z=>this.emit({camera:[this.nv.scene.renderAzimuth,this.nv.scene.renderElevation,z]},true)
    this.resize=new ResizeObserver(()=>{if(!this.disposed&&this.nv.canvas)this.nv.resizeListener()})
    canvas.addEventListener('mousedown',this.pointer,true)
    canvas.addEventListener('mousemove',this.pointer,true)
    canvas.addEventListener('mouseup',this.releasePointer)
    canvas.addEventListener('mouseleave',this.cancelClick)
    canvas.addEventListener('blur',this.cancelClick)
    canvas.addEventListener('wheel',this.cancelClick,true)
    canvas.addEventListener('touchstart',this.cancelClick,true)
  }
  private pointer=(event:MouseEvent)=>{
    if(event.type==='mousedown')this.clickGesture.begin(event,this.current?.visible??[],!!this.current&&!this.disposed)
    else this.clickGesture.move(event)
  }
  private releasePointer=(event:MouseEvent)=>{
    if(this.clickGesture.finish(event)!==null&&this.current&&!this.disposed)pickCanvas3D(this.nv,this.canvas,event)
  }
  private cancelClick=()=>this.clickGesture.cancel()
  private emit(patch:Partial<ModelView>,native=false) {
    if(this.syncing||this.disposed||!this.current)return
    const baseline=this.nativeUpdate??this.current
    const cut='surfaceCutaway' in patch?patch.surfaceCutaway:baseline.surfaceCutaway
    const surfaceCutaway=cursorCutaway(cut,patch.position_native_mm??baseline.position_native_mm)
    if(surfaceCutaway!==cut)patch={...patch,surfaceCutaway}
    if(!Object.entries(patch).some(([key,value])=>JSON.stringify(value)!==JSON.stringify(baseline[key as keyof ModelView])))return
    const renderedCurrent=this.nativeUpdate!==null||this.appliedKey===modelRenderKey(this.current)
    const recolor=baseline.highlightSelected&&'selected' in patch&&patch.selected!==baseline.selected
    this.nativeUpdate=native&&!this.task&&renderedCurrent&&!recolor?{...baseline,...patch}:null
    this.changed(patch)
  }
  async initialize(state:ModelView) {
    await Promise.all([
      this.nv.attachToCanvas(this.canvas).then(()=>{this.attached=true;if(this.disposed)this.release()}),
      this.resources.load(this.manifest.assets,this.loading.signal),
    ])
    if(this.disposed){this.release();return}
    this.nv.setSliceType(this.nv.sliceTypeRender)
    this.resize.observe(this.canvas.parentElement!)
    await this.apply(state)
  }
  apply(state:ModelView):Promise<void> {
    if(this.disposed)return Promise.resolve()
    state=cursorModelView(state)
    this.current=state
    this.nv.cursorPlanePosition=[...state.position_native_mm]
    const key=modelRenderKey(state),native=this.nativeUpdate
    this.nativeUpdate=null
    if(!this.task&&native&&modelRenderKey(native)===key){this.appliedKey=key;return Promise.resolve()}
    if(!this.task&&this.appliedKey===key)return Promise.resolve()
    if(this.task&&this.requestedKey===key)return this.task
    const assets=modelAssetKey(state)
    if(assets!==this.requestedAssetKey){this.requestedAssetKey=assets;this.assetGeneration++}
    this.requestedKey=key
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
    const nv=this.nv,assetGeneration=this.assetGeneration,context=new Set(contextIds(state)),visible=new Set([...state.visible,...context])
    for(const [id,mesh] of this.meshes){mesh.visible=visible.has(id);mesh.opacity=contextOpacity(state,id,state.opacity*(state.surfaceOpacity[id]??1))}
    nv.deferMeshUpdates=true
    try {
      const missing=[...visible].filter(id=>!this.meshes.has(id)).map(id=>this.manifest.structures.find(item=>item.id===id)!)
      await loadAssetsInOrder(missing,structure=>this.resources.url(structure.mesh_file),async(structure,buffer)=>{
        const id=structure.id
        this.status('Loading '+structure.name)
        const color=[...(context.has(id)?BACKGROUND_COLOR:structure.color),255]
        const mesh=this.resources.isPreparedMesh(structure.mesh_file)
          ? addPreparedMesh(nv,buffer,structure.source_name,color,1)
          : await nv.addMeshFromUrl({url:this.resources.url(structure.mesh_file),buffer,name:structure.source_name+'.gii',rgba255:color,visible:false,opacity:1})
        if(this.disposed)return
        this.meshes.set(id,mesh)
        const bounds=mesh.tris?triangleBounds(mesh.pts,mesh.tris):null
        if(bounds)this.renderedBounds.set(id,bounds)
        mesh.visible=this.current!.visible.includes(id)||contextIds(this.current!).includes(id);mesh.opacity=contextOpacity(this.current!,id,this.current!.opacity*(this.current!.surfaceOpacity[id]??1))
      },this.loading.signal,()=>!this.disposed&&assetGeneration===this.assetGeneration)
      if(this.disposed||generation!==this.generation)return
      for(const [id,mesh] of this.meshes)if(this.meshes.size>32&&!visible.has(id)){nv.removeMesh(mesh);this.meshes.delete(id);this.renderedBounds.delete(id)}
    } finally {nv.deferMeshUpdates=false}
    if(this.disposed||generation!==this.generation)return
    for(const [id,mesh] of this.meshes) {
      const source=this.manifest.structures.find(item=>item.id===id)!
      const color=context.has(id)?[...BACKGROUND_COLOR,255]:state.highlightSelected&&id===state.selected?[90,240,214,255]:[...source.color,255]
      if(color.some((value,axis)=>mesh.rgba255[axis]!==value))mesh.setProperty('rgba255',new Uint8Array(color),nv.gl)
    }
    const reserved=new Set(state.surfaceContext?.structure_ids??[]),frame=new Set([...state.visible,...reserved])
    const displayed=this.manifest.structures.filter(item=>frame.has(item.id))
    const geometry=displayed.length?displayed:this.manifest.structures
    // Reserved context uses its declared source bounds even before its mesh is
    // loaded. Switching it on must not refine bounds and move the camera.
    const bounds=(item:ModelSurface)=>reserved.has(item.id)?item.bounds_native_mm:this.bounds(item.id)!
    nv.modelBounds=[ [0,1,2].map(axis=>Math.min(...geometry.map(item=>bounds(item)[0][axis]))) as Vec3,
      [0,1,2].map(axis=>Math.max(...geometry.map(item=>bounds(item)[1][axis]))) as Vec3 ]
    this.syncing=true
    try {
      nv.focus=state.focus_native_mm
      // Mesh loading updates the renderer pivot before this view's bounds exist.
      // Recompute it after applying visible source bounds and the recorded focus.
      nv.setPivot3D()
      nv.scene.renderAzimuth=state.camera[0];nv.scene.renderElevation=state.camera[1];nv.scene.volScaleMultiplier=state.camera[2]
      nv.surfaceCutaway=cursorCutaway(state.surfaceCutaway,state.position_native_mm)
      const cutIds=[...this.meshes].filter(([id])=>state.surfaceCutaway&&(state.surfaceCutaway.structures.includes(id)||context.has(id))).map(([,mesh])=>mesh.id)
      if(cutIds.length!==nv.cutawayMeshIds.size||cutIds.some(id=>!nv.cutawayMeshIds.has(id))){nv.cutawayMeshIds.clear();for(const id of cutIds)nv.cutawayMeshIds.add(id)}
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
    return {...cursorModelView(state),camera:[this.nv.scene.renderAzimuth,this.nv.scene.renderElevation,this.nv.scene.volScaleMultiplier]}
  }
  setCursorStructure(position:Vec3,structureId:string|null):void{this.nv.cursorPlanePosition=[...position];this.cursorReadout.remember(position,structureId)}
  cursorStructureAt(position:Vec3):string|null{
    if(this.disposed)return null
    const known=this.cursorReadout.at(position)
    if(known)return known.structureId
    return this.current&&position.every((value,axis)=>Math.abs(value-this.current!.position_native_mm[axis])<1e-4)?this.current.selected:null
  }
  bounds(id:string):[Vec3,Vec3]|undefined {return this.renderedBounds.get(id)??this.manifest.structures.find(item=>item.id===id)?.bounds_native_mm}
  capture(){this.nv.drawScene();return this.canvas.toDataURL('image/png')}
  private release(){if(!this.attached||this.released)return;this.released=true;this.nv.cleanup();this.nv.gl.getExtension('WEBGL_lose_context')?.loseContext();this.meshes.clear()}
  dispose(){this.disposed=true;this.cursorReadout.clear();this.loading.abort();this.generation++;this.resize.disconnect();this.clickGesture.cancel();this.canvas.removeEventListener('mousedown',this.pointer,true);this.canvas.removeEventListener('mousemove',this.pointer,true);this.canvas.removeEventListener('mouseup',this.releasePointer);this.canvas.removeEventListener('mouseleave',this.cancelClick);this.canvas.removeEventListener('blur',this.cancelClick);this.canvas.removeEventListener('wheel',this.cancelClick,true);this.canvas.removeEventListener('touchstart',this.cancelClick,true);if(!this.task)this.release()}
}
