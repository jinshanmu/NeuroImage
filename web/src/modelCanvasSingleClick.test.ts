import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Niivue, type NVMesh } from '@niivue/niivue'
import { ModelViewer } from './modelViewer'
import { initialModelView } from './modelScene'
import { modelRenderKey } from './renderState'
import type { ModelView, SurfaceManifest } from './modelTypes'
import type { Vec3 } from './types'

class Canvas {
  width=200; height=160
  private listeners=new Map<string,Set<(event:MouseEvent)=>void>>()
  getBoundingClientRect(){return {left:10,top:20,width:100,height:80}}
  addEventListener(type:string,callback:(event:MouseEvent)=>void){
    if(!this.listeners.has(type))this.listeners.set(type,new Set())
    this.listeners.get(type)!.add(callback)
  }
  removeEventListener(type:string,callback:(event:MouseEvent)=>void){this.listeners.get(type)?.delete(callback)}
  fire(type:string,x=60,y=60,extra:Partial<MouseEvent>={}){
    const event={type,button:0,clientX:x,clientY:y,shiftKey:false,ctrlKey:false,altKey:false,metaKey:false,...extra} as MouseEvent
    for(const callback of this.listeners.get(type)??[])callback(event)
  }
  has(type:string){return !!this.listeners.get(type)?.size}
}

const viewers:ModelViewer[]=[]
beforeEach(()=>{
  vi.stubGlobal('window',{devicePixelRatio:1})
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
})
afterEach(()=>{viewers.splice(0).forEach(viewer=>viewer.dispose());vi.restoreAllMocks();vi.unstubAllGlobals()})

function fixture(stubPick=true){
  const canvas=new Canvas()
  const manifest={structures:[{id:'subject',name:'Native source',source_name:'Native source',
    target_native_mm:[1800.2,-699.8,2500],bounds_native_mm:[[1800,-700,2500],[1801,-699,2500]]}]} as unknown as SurfaceManifest
  let state=initialModelView(manifest)
  const changed=vi.fn((patch:Partial<ModelView>)=>{state={...state,...patch};internal.current=state})
  const viewer=new ModelViewer(canvas as unknown as HTMLCanvasElement,manifest,'/native/',changed,()=>{})
  viewers.push(viewer)
  const internal=viewer as unknown as {current:ModelView;appliedKey:string;meshes:Map<string,NVMesh>;render(state:ModelView,generation:number):Promise<void>}
  internal.current=state;internal.appliedKey=modelRenderKey(state)
  const points=new Float32Array([1800,-700,2500,1801,-700,2500,1800,-699,2500])
  internal.meshes.set('subject',{pts:points,tris:new Uint32Array([0,1,2]),visible:true,opacity:.5} as NVMesh)
  const render=vi.spyOn(internal,'render').mockResolvedValue()
  const pick=stubPick?vi.spyOn(viewer.nv,'drawScene').mockImplementation(()=>{
    if(!viewer.nv.uiData.mouseDepthPicker)return
    viewer.nv.uiData.mouseDepthPicker=false
    viewer.nv.onNativePick([1800+viewer.nv.mousePos[0]/1000,-700+viewer.nv.mousePos[1]/1000,2500],true)
  }):null
  return {canvas,viewer,state:()=>state,changed,pick,render,points}
}

describe('native model single-click navigation',()=>{
  it('places the native cursor at empty corner pixels on its current view plane, beyond the source model bounds',async()=>{
    const f=fixture(false)
    await f.viewer.apply(f.state())
    const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])
    const gl={VIEWPORT:1,RGBA:2,UNSIGNED_BYTE:3,canvas:{height:160},
      getParameter:vi.fn(()=>[0,0,200,160]),
      readPixels:vi.fn((_x:number,_y:number,_width:number,_height:number,_format:number,_type:number,rgba:Uint8Array)=>rgba.set([6,11,17,255]))}
    Object.defineProperty(f.viewer.nv,'gl',{value:gl})
    for(const [x,y] of [[0,0],[199,0],[0,159],[199,159]]){
      f.viewer.nv.mousePos=[x,y];f.viewer.nv.uiData.mouseDepthPicker=true
      f.viewer.nv.depthPicker([0,0,200,160],identity)
      expect(f.state().position_native_mm[0]).toBeCloseTo((x+.5)/200*2-1,6)
      expect(f.state().position_native_mm[1]).toBeCloseTo((159-y+.5)/160*2-1,6)
      expect(f.state().position_native_mm[2]).toBeCloseTo(2500,6)
      expect(f.state().selected).toBeNull();expect(f.state().visible).toEqual(['subject'])
      expect(f.viewer.nv.cursorPlanePosition).toEqual(f.state().position_native_mm)
      expect(f.viewer.cursorStructureAt(f.state().position_native_mm)).toBeNull()
    }
    expect(gl.readPixels).toHaveBeenCalledTimes(4)
    expect(f.changed.mock.calls.every(([patch])=>!('visible' in patch))).toBe(true)
    expect(f.state().coordinate_system).toBe('SOURCE_XYZ')
  })

  it('does not scan triangles or infer a structure for a fallback point even when that plane crosses source geometry',()=>{
    const f=fixture(false)
    const mesh=(f.viewer as unknown as {meshes:Map<string,NVMesh>}).meshes.get('subject')!
    const vertices=vi.fn(()=>{throw new Error('fallback scanned source triangles')})
    Object.defineProperty(mesh,'pts',{get:vertices})
    const position:Vec3=[1800.2,-699.8,2500]
    f.viewer.nv.onNativePick(position,false)
    expect(vertices).not.toHaveBeenCalled()
    expect(f.state().position_native_mm).toEqual(position)
    expect(f.state().selected).toBeNull();expect(f.state().visible).toEqual(['subject'])
    expect(f.viewer.nv.cursorPlanePosition).toEqual(position)
  })

  it('refreshes the plane anchor for applied and immediate picked native positions and moves the active cut with blank-space navigation',async()=>{
    const f=fixture(false),position:Vec3=[-1700,2800,3600]
    await f.viewer.apply({...f.state(),position_native_mm:position,
      surfaceCutaway:{axis:0,side:1,position_mm:0,structures:['subject'],followCursor:true}})
    expect(f.viewer.nv.cursorPlanePosition).toEqual(position)
    const next:Vec3=[-1800,2801,3600]
    f.viewer.nv.onNativePick(next,false)
    expect(f.viewer.nv.cursorPlanePosition).toEqual(next)
    expect(f.state().position_native_mm).toEqual(next)
    expect(f.state().surfaceCutaway?.position_mm).toBe(next[0])
    expect(f.viewer.nv.surfaceCutaway?.position_mm).toBe(next[0])
    expect(f.state().visible).toEqual(['subject'])
  })

  it('accepts stationary clicks across the whole canvas and maps CSS pixels to framebuffer pixels',async()=>{
    const f=fixture()
    for(const [x,y] of [[15,25],[105,25],[15,95],[105,95]]){
      f.canvas.fire('mousedown',x,y);f.canvas.fire('mouseup',x,y)
      expect(f.viewer.nv.mousePos).toEqual([(x-10)*2,(y-20)*2])
      expect(f.state().position_native_mm).toEqual([1800+(x-10)*.002,-700+(y-20)*.002,2500])
      expect(f.state().visible).toEqual(['subject'])
      expect(f.state().selected).toBe('subject')
      expect(f.viewer.nv.uiData.mouseDepthPicker).toBe(false)
      await f.viewer.apply(f.state())
    }
    expect(f.pick).toHaveBeenCalledTimes(4)
    expect(f.render).not.toHaveBeenCalled()
  })

  it('does not register a double-click action or hide the source after repeated clicks',()=>{
    const f=fixture()
    expect(f.canvas.has('dblclick')).toBe(false)
    for(let detail=1;detail<=2;detail++){
      f.canvas.fire('mousedown',60,60,{detail});f.canvas.fire('mouseup',60,60,{detail})
    }
    f.canvas.fire('dblclick',60,60,{detail:2})
    expect(f.pick).toHaveBeenCalledTimes(2)
    expect(f.state().visible).toEqual(['subject']);expect(f.state().selected).toBe('subject')
  })

  it('blocks the native renderer double-click reset while forwarding ordinary clicks',()=>{
    const f=fixture(false),native=vi.spyOn(Niivue.prototype,'resetBriCon').mockImplementation(()=>{})
    f.viewer.nv.resetBriCon({type:'dblclick'} as MouseEvent)
    expect(native).not.toHaveBeenCalled()
    const click={type:'mouseup'} as MouseEvent
    f.viewer.nv.resetBriCon(click)
    expect(native).toHaveBeenCalledExactlyOnceWith(click)
  })

  it('keeps native points outside an image-coordinate range without assigning RAS or changing source geometry',()=>{
    const f=fixture(),position:Vec3=[1800.3,-699.8,2500]
    f.viewer.nv.onNativePick(position)
    expect(f.state().position_native_mm).toEqual(position)
    expect(f.state().coordinate_system).toBe('SOURCE_XYZ')
    expect(f.state()).not.toHaveProperty('position_ras_mm')
    expect(f.state().visible).toEqual(['subject'])
    expect(f.viewer.nv.volumes).toHaveLength(0)
    expect(f.state().opacity).toBe(.5)
    expect(f.state().camera).toEqual([110,15,.65])
    expect((f.viewer as unknown as {meshes:Map<string,NVMesh>}).meshes.get('subject')!.pts).toBe(f.points)
  })

  it('leaves orbit drags and disposed canvases without a source pick',()=>{
    const f=fixture()
    f.canvas.fire('mousedown',40,40);f.canvas.fire('mousemove',70,40);f.canvas.fire('mouseup',70,40)
    expect(f.pick).not.toHaveBeenCalled();expect(f.changed).not.toHaveBeenCalled()
    f.viewer.dispose()
    f.canvas.fire('mousedown');f.canvas.fire('mouseup')
    expect(f.pick).not.toHaveBeenCalled();expect(f.changed).not.toHaveBeenCalled()
  })
})
