import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AtlasViewer } from './viewer'
import type { Manifest, ViewState } from './types'
import type { NVImage } from '@niivue/niivue'

const identity = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1])
beforeEach(() => { vi.stubGlobal('window', { devicePixelRatio: 1 }) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture() {
  const viewer = new AtlasViewer({ addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement,
    { representation: 'mri-labels', structures: [], volumes: [] } as unknown as Manifest, '', () => {}, () => {})
  const nv = viewer.nv
  const readPixels = vi.fn((_x,_y,_w,_h,_f,_t,rgba: Uint8Array) => rgba.set([6,11,17,255]))
  Object.defineProperty(nv, 'gl', { value: { canvas: { height: 200 }, VIEWPORT: 1, RGBA: 2, UNSIGNED_BYTE: 3,
    getParameter: () => [0,0,200,200], readPixels } })
  nv.mousePos = [20,40]
  nv.cursorPlanePosition = [2,3,.2]
  vi.spyOn(nv, 'mm2frac').mockImplementation(point => new Float32Array([point[0]+.5,point[1]+.5,point[2]+.5]))
  nv.uiData.mouseDepthPicker = true
  return { viewer, nv, readPixels }
}

describe('atlas full-space depth fallback', () => {
  it('moves through a blank pixel on the cursor plane and permits fractions outside the original volume', () => {
    const f = fixture()
    f.nv.depthPicker([0,0,200,200],identity)
    expect(f.nv.sourceDepthPick).toBe(true)
    expect(f.nv.sourcePlanePick).toBe(true)
    expect(f.nv.scene.crosshairPos[0]).toBeCloseTo(-.295)
    expect(f.nv.scene.crosshairPos[1]).toBeCloseTo(1.095)
    expect(f.nv.scene.crosshairPos[2]).toBeCloseTo(.7)
  })

  it('still locates empty space when the foreground is invisible without a GPU readback', () => {
    const f = fixture()
    ;(f.nv as unknown as { suppressVolumePick: boolean }).suppressVolumePick = true
    f.nv.depthPicker([0,0,200,200],identity)
    expect(f.readPixels).not.toHaveBeenCalled()
    expect(f.nv.sourceDepthPick).toBe(true)
    expect(f.nv.sourcePlanePick).toBe(true)
    expect(f.nv.scene.crosshairPos[0]).toBeLessThan(0)
  })

  it('accepts a real surface hit outside the source image grid instead of clipping the cursor to its box', () => {
    const f = fixture()
    f.readPixels.mockImplementation((_x,_y,_w,_h,_f,_t,rgba) => rgba.set([128,0,0,0]))
    f.nv.depthPicker([0,0,200,200],identity)
    expect(f.nv.sourceDepthPick).toBe(true)
    expect(f.nv.sourcePlanePick).toBe(false)
    expect(f.nv.scene.crosshairPos[0]).toBeLessThan(0)
    expect(f.nv.scene.crosshairPos[1]).toBeGreaterThan(1)
  })

  it('identifies hidden source labels on the navigation plane without changing which structures are shown', () => {
    const manifest = { representation: 'mri-labels', structures: [{ id:'front',name:'Front' },{ id:'rear',name:'Rear' }],
      volumes: [{ id:'t1',kind:'image' },{ id:'labels',kind:'labels',shape:[10,10,10],voxel_size_mm:[1,1,1] }] } as unknown as Manifest
    let state = { visible:['front'],selected:'front',position:[2,5,5],background:'t1',overlay:'labels',
      labelOpacity:.5,meshOpacity:.5,camera:[110,15,1],pan:[0,0,0,1],window:[0,100],annotations:[],note:'',imageContext:false,radiological:true,layout:'quad' } as ViewState
    const viewer = new AtlasViewer({ addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement,
      manifest,'',patch => { state={...state,...patch} },() => {})
    ;(viewer as unknown as { current:ViewState }).current=state
    viewer.nv.volumes=[{} as NVImage,{ mm2vox:(point:number[])=>point,getValue:()=>2 } as unknown as NVImage]
    viewer.nv.sourceDepthPick=true;viewer.nv.sourcePlanePick=true
    viewer.nv.onLocationChange({ mm:[6,5,5],axCorSag:NaN,values:[{value:0},{value:2}] })
    expect(state.position).toEqual([6,5,5])
    expect(state.selected).toBe('rear')
    expect(state.visible).toEqual(['front'])
    viewer.nv.sourceDepthPick=true;viewer.nv.sourcePlanePick=true
    viewer.nv.onLocationChange({ mm:[20,5,5],axCorSag:NaN,values:[{value:0},{value:0}] })
    expect(state.position).toEqual([20,5,5]);expect(state.selected).toBeNull()
    expect(state.visible).toEqual(['front'])
  })
})
