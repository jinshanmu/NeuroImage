import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NVImage } from '@niivue/niivue'
import { AtlasViewer } from './viewer'
import type { LabelVolumeResources } from './labelVolumeResources'
import type { Manifest, ViewState } from './types'

const viewers:AtlasViewer[]=[]
beforeEach(()=>{
  vi.stubGlobal('window',{devicePixelRatio:1})
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})
})
afterEach(()=>{viewers.splice(0).forEach(viewer=>viewer.dispose());vi.restoreAllMocks();vi.unstubAllGlobals()})

function source(name:string):NVImage {
  const image=Object.assign(Object.create(NVImage.prototype) as NVImage,{id:name,name,opacity:1,
    img:name==='labels'?new Uint16Array([0,10,30,10,30,0,10,30]):new Float32Array(8).fill(80),
    hdr:{datatypeCode:16,numBitsPerVoxel:32,intent_code:0},toRAS:[1],dimsRAS:[3,2,2,2],
    frac2mm:new Float32Array([2,0,0,0,0,2,0,0,0,0,2,0,0,0,0,1]),cal_min:0,cal_max:100})
  image.setColormapLabel=vi.fn()
  image.mm2vox=vi.fn((position:number[])=>Float32Array.from(position))
  image.getValue=vi.fn(()=>1)
  return image
}

function fixture(){
  const manifest={representation:'mri-labels',structures:[10,30].map((label_value,index)=>({id:'region-'+index,label_value,name:'Region '+index,
    source_name:'Region '+index,mesh_file:'unused-'+index+'.gii',color:[80,100,120],bounds_ras_mm:[[0,0,0],[2,2,2]],target_ras_mm:[.5,.5,.5]})),
    volumes:['t1','t2','labels'].map(id=>({id,name:id,kind:id==='labels'?'labels':'image',file:id+'.nii',shape:[2,2,2],voxel_size_mm:[1,1,1],cal_min:0,cal_max:100})),assets:[]} as unknown as Manifest
  let state:ViewState={selected:'region-0',visible:['region-0','region-1'],position:[.5,.5,.5],background:'t1',overlay:'labels',labelOpacity:.5,meshOpacity:.5,
    radiological:true,layout:'quad',camera:[110,15,.8],pan:[0,0,0,1],imageContext:false,window:[0,100],annotations:[],note:''}
  const canvas={addEventListener(){},removeEventListener(){}} as unknown as HTMLCanvasElement
  const viewer=new AtlasViewer(canvas,manifest,'/source/',patch=>{state={...state,...patch}},()=>{})
  viewers.push(viewer)
  const nv=viewer.nv,frames:string[][]=[],commits:string[]=[]
  nv.gl={} as WebGL2RenderingContext
  vi.spyOn(nv,'drawScene').mockImplementation(()=>{if(!nv.holdSceneDraw)frames.push(nv.volumes.map(image=>image.name!))})
  vi.spyOn(nv,'closePAQD').mockImplementation(()=>{})
  vi.spyOn(nv,'updateGLVolume').mockImplementation(()=>{nv.drawScene()})
  vi.spyOn(nv,'refreshColormaps').mockImplementation(()=>{})
  vi.spyOn(nv,'refreshLayers').mockImplementation(()=>{})
  vi.spyOn(nv,'mm2frac').mockImplementation(point=>new Float32Array([point[0]/2,point[1]/2,point[2]/2]))
  vi.spyOn(nv,'frac2mm').mockImplementation(point=>new Float32Array([point[0]*2,point[1]*2,point[2]*2,1]))
  const add=vi.spyOn(nv,'addVolume').mockImplementation(image=>{
    expect(nv.holdSceneDraw).toBe(true)
    commits.push(image.name!);nv.volumes.push(image);nv.back=nv.volumes[0];nv.overlays=nv.volumes.slice(1)
    nv.drawScene() // Native insertion must not draw a partial source stack.
  })
  const internals=viewer as unknown as {labelVolumes:LabelVolumeResources;labelIds:LabelVolumeResources;contextVolumes:LabelVolumeResources}
  for(const resources of [internals.labelVolumes,internals.labelIds,internals.contextVolumes])vi.spyOn(resources,'get').mockReturnValue({} as WebGLTexture)
  const decode=vi.spyOn(NVImage,'loadFromUrl').mockImplementation(async options=>source(options!.name!.startsWith('labels')?'labels':options!.name!.split('.')[0]))
  const fetch=vi.fn(()=>{throw Error('Categorical surfaces must not be fetched')})
  vi.stubGlobal('fetch',fetch)
  const meshes=vi.spyOn(nv,'addMeshFromUrl')
  const apply=(next:ViewState)=>{state=next;return viewer.apply(next)}
  return{viewer,nv,decode,fetch,meshes,add,frames,commits,apply,state:()=>state}
}

describe('complete source contrast transactions',()=>{
  it('loads no categorical meshes and decodes/compacts the current labels once across contrast roundtrips',async()=>{
    const f=fixture()
    await f.apply(f.state())
    const label=f.nv.volumes[1],samples=label.img
    expect(Array.from(samples!)).toEqual([0,1,2,1,2,0,1,2])
    for(const background of ['t2','t1','t2'])await f.apply({...f.state(),background})
    expect(f.decode.mock.calls.map(([options])=>options!.url)).toEqual(['/source/t1.nii','/source/labels.nii','/source/t2.nii','/source/t1.nii','/source/t2.nii'])
    expect(f.nv.volumes[1]).toBe(label)
    expect(label.img).toBe(samples)
    expect(Array.from(samples!)).toEqual([0,1,2,1,2,0,1,2])
    expect(f.nv.document.getImageOptions(label)?.url).toBe('/source/labels.nii')
    expect(f.nv.mediaUrlMap.get(label)).toBe('/source/labels.nii')
    expect(f.fetch).not.toHaveBeenCalled();expect(f.meshes).not.toHaveBeenCalled()
    expect(f.frames).toEqual([['t1','labels'],['t2','labels'],['t1','labels'],['t2','labels']])
  })

  it('keeps the previous stack interactive during preparation and commits the latest cursor, orbit, opacity and Cutaway together',async()=>{
    const f=fixture();await f.apply(f.state())
    const original=[...f.nv.volumes],commits=f.add.mock.calls.length
    let finish!:(image:NVImage)=>void
    f.decode.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    const pending=f.apply({...f.state(),background:'t2'})
    expect(f.nv.volumes).toEqual(original)
    expect(f.nv.holdSceneDraw).toBe(false)
    f.nv.scene.renderAzimuth=67;f.nv.scene.renderElevation=-17;f.nv.onAzimuthElevationChange(67,-17)
    f.nv.onLocationChange({mm:[.7,.6,.5],axCorSag:0,values:[{value:0},{value:1}]})
    const latest={...f.state(),meshOpacity:.35,zoom3D:2.5,surfaceCutaway:{axis:0 as const,side:1 as const,position_mm:.7,structures:['region-0'],followCursor:true}}
    f.apply(latest)
    f.nv.drawScene()
    expect(f.frames.at(-1)).toEqual(['t1','labels'])
    expect(f.add.mock.calls.length).toBe(commits)
    finish(source('t2'));await pending
    expect(f.state().position).toEqual([.7,.6,.5])
    expect(f.nv.scene.renderAzimuth).toBe(67);expect(f.nv.scene.renderElevation).toBe(-17)
    expect(f.nv.anatomyVolumeOpacity).toBe(.35);expect(f.nv.relativeZoom).toBe(2.5)
    expect(f.nv.surfaceCutaway?.position_mm).toBe(.7)
    expect(f.nv.volumes.map(image=>image.name)).toEqual(['t2','labels'])
    expect(f.frames.every(frame=>frame.length===2)).toBe(true)
  })

  it('does not commit an obsolete contrast after reset and leaves the current valid source usable after a failed decode',async()=>{
    const f=fixture();await f.apply(f.state())
    const initial=f.state(),original=[...f.nv.volumes],count=f.add.mock.calls.length
    let finish!:(image:NVImage)=>void
    f.decode.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
    const pending=f.apply({...initial,background:'t2'})
    f.apply(initial);finish(source('t2'));await pending
    expect(f.nv.volumes).toEqual(original);expect(f.add.mock.calls.length).toBe(count)
    f.decode.mockRejectedValueOnce(Error('source read failed'))
    await expect(f.apply({...initial,background:'t2'})).rejects.toThrow('source read failed')
    expect(f.nv.volumes).toEqual(original);expect(f.nv.holdSceneDraw).toBe(false)
    f.nv.drawScene();expect(f.frames.at(-1)).toEqual(['t1','labels'])
    await f.apply({...initial,background:'t2'})
    expect(f.nv.volumes.map(image=>image.name)).toEqual(['t2','labels'])
    expect(f.decode.mock.calls.filter(([options])=>String(options!.url).includes('labels'))).toHaveLength(1)
  })
})
