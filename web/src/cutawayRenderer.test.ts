import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Niivue, type NVMesh } from '@niivue/niivue'
import { CutawayNiivue } from './cutawayRenderer'
import { SurfaceOIT } from './surfaceOIT'

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
const fragment = '#version 300 es\nprecision highp float;\nin vec3 vN;\nout vec4 color;\nvoid main(){vec3 n = normalize(vN);color = vec4(n, 1.0);}'
type Draw = { id: string; kind: 'native' | 'translucent'; opacity: number; source: string; culled?: boolean; depthWrite?: boolean; cullMode?: number }

function mesh(id: string, opacity = 1, z = 0) {
  return { id, name: id, opacity, visible: true, indexCount: 3, meshShaderIndex: 0, offsetPt0: null,
    extentsMin: [-1, -1, z], extentsMax: [1, 1, z], vao: { id },
    pts: new Float32Array([-1, -1, z, 1, -1, z, 0, 1, z]), tris: new Uint32Array([0, 1, 2]),
  } as unknown as NVMesh
}

function fixture(meshes: NVMesh[]) {
  const viewer = new CutawayNiivue(), draws: Draw[] = []
  // Capability/resource behavior is covered by SurfaceOIT's own tests. These
  // pipeline fixtures deliberately select the bounded unsupported fallback.
  vi.spyOn(SurfaceOIT.prototype, 'draw').mockReturnValue(false)
  const constants = 'CURRENT_PROGRAM VERTEX_ARRAY_BINDING DEPTH_TEST CULL_FACE BLEND DEPTH_WRITEMASK DEPTH_FUNC CULL_FACE_MODE BLEND_SRC_RGB BLEND_DST_RGB BLEND_SRC_ALPHA BLEND_DST_ALPHA BLEND_EQUATION_RGB BLEND_EQUATION_ALPHA ACTIVE_TEXTURE TEXTURE_BINDING_2D TEXTURE5 TEXTURE_2D LEQUAL ALWAYS FRONT BACK SRC_ALPHA ONE_MINUS_SRC_ALPHA ONE FUNC_ADD TRIANGLES UNSIGNED_INT SHADER_TYPE FRAGMENT_SHADER'.split(' ')
  const gl = Object.fromEntries(constants.map((name, index) => [name, index + 1])) as Record<string, any>
  const params = new Map<number, any>([[gl.DEPTH_WRITEMASK, true], [gl.DEPTH_FUNC, gl.LEQUAL], [gl.CULL_FACE_MODE, gl.BACK],
    [gl.ACTIVE_TEXTURE, 0], [gl.CURRENT_PROGRAM, null], [gl.VERTEX_ARRAY_BINDING, null]])
  const enabled = new Set<number>(), uniforms = new Map<string, number>()
  gl.getParameter = vi.fn((key: number) => params.get(key) ?? 0)
  gl.isEnabled = vi.fn((key: number) => enabled.has(key))
  gl.enable = vi.fn((key: number) => enabled.add(key)); gl.disable = vi.fn((key: number) => enabled.delete(key))
  gl.useProgram = vi.fn((program: unknown) => params.set(gl.CURRENT_PROGRAM, program))
  gl.bindVertexArray = vi.fn((vao: unknown) => params.set(gl.VERTEX_ARRAY_BINDING, vao))
  gl.depthMask = vi.fn((value: boolean) => params.set(gl.DEPTH_WRITEMASK, value))
  gl.depthFunc = vi.fn((value: number) => params.set(gl.DEPTH_FUNC, value))
  gl.cullFace = vi.fn((value: number) => params.set(gl.CULL_FACE_MODE, value))
  gl.activeTexture = vi.fn((value: number) => params.set(gl.ACTIVE_TEXTURE, value))
  gl.bindTexture = vi.fn((_target: number, value: unknown) => params.set(gl.TEXTURE_BINDING_2D, value))
  gl.blendEquation = vi.fn((value: number) => { params.set(gl.BLEND_EQUATION_RGB, value); params.set(gl.BLEND_EQUATION_ALPHA, value) })
  gl.blendEquationSeparate = vi.fn((rgb: number, alpha: number) => { params.set(gl.BLEND_EQUATION_RGB, rgb); params.set(gl.BLEND_EQUATION_ALPHA, alpha) })
  gl.blendFuncSeparate = vi.fn((src: number, dst: number, srcAlpha: number, dstAlpha: number) => {
    for (const [key, value] of [[gl.BLEND_SRC_RGB, src], [gl.BLEND_DST_RGB, dst], [gl.BLEND_SRC_ALPHA, srcAlpha], [gl.BLEND_DST_ALPHA, dstAlpha]]) params.set(key, value)
  })
  gl.uniformMatrix4fv = vi.fn()
  gl.uniform1f = vi.fn((location: string, value: number) => uniforms.set(location, value))
  gl.uniform4fv = vi.fn()
  gl.getAttachedShaders = vi.fn((program: any) => [program.attachment])
  gl.getShaderParameter = vi.fn(() => gl.FRAGMENT_SHADER)
  gl.getShaderSource = vi.fn((shader: any) => shader.source)
  gl.deleteShader = vi.fn(); gl.deleteProgram = vi.fn()
  gl.drawElements = vi.fn(() => {
    const program = params.get(gl.CURRENT_PROGRAM), vao = params.get(gl.VERTEX_ARRAY_BINDING)
    draws.push({ id: vao.id, kind: 'translucent', opacity: uniforms.get(program.opacity)!, source: program.source,
      culled: enabled.has(gl.CULL_FACE), depthWrite: params.get(gl.DEPTH_WRITEMASK), cullMode: params.get(gl.CULL_FACE_MODE) })
  })
  viewer.gl = gl as WebGL2RenderingContext
  let programId = 0
  const material = (source: string, name: string) => {
    const program = { source, opacity: `opacity-${++programId}`, attachment: { source } }
    return { Name: name, Frag: source, shader: { program,
      uniforms: { opacity: program.opacity, mvpMtx: `matrix-${programId}`, normMtx: `normal-${programId}`, neuroimageCutPlane: `plane-${programId}` },
      use: vi.fn(() => gl.useProgram(program)),
    } } as unknown as ReturnType<Niivue['createCustomMeshShader']>
  }
  const compile = vi.spyOn(viewer, 'createCustomMeshShader').mockImplementation((source, name) => material(source, name ?? 'Custom'))
  viewer.meshShaders = [material(fragment, 'Source')]
  viewer.pickingMeshShader = material('void main(){color=vec4(0.0);}', 'Source depth').shader!
  viewer.meshes = meshes
  viewer.opts.meshXRay = 0
  const native = vi.spyOn(Niivue.prototype, 'drawMesh3D').mockImplementation(function (this: Niivue, _depth, alpha = 1) {
    for (const item of this.meshes) if (item.visible && item.opacity > 0 && item.indexCount! >= 3) {
      draws.push({ id: String(item.id), kind: 'native', opacity: item.opacity * alpha,
        source: this.uiData.mouseDepthPicker ? 'depth-pick' : this.meshShaders[item.meshShaderIndex].Frag })
    }
  })
  return { viewer, gl, draws, compile, native }
}

beforeEach(() => vi.stubGlobal('window', { devicePixelRatio: 1 }))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('surface opacity and cutaway pipeline', () => {
  it('prefers per-pixel transparency after opaque depth, retaining source alpha and cutaway commands', () => {
    const front = mesh('front', .5, -.5), far = mesh('far', .4, .5), opaque = mesh('opaque')
    const original = [front, far, opaque], f = fixture(original), shaders = f.viewer.meshShaders
    f.viewer.surfaceCutaway = { axis: 0, side: 1, position_mm: 4, structures: ['front'] }
    f.viewer.cutawayMeshIds.add(front.id)
    const preferred = vi.spyOn(SurfaceOIT.prototype, 'draw').mockImplementation((commands, matrix, normalMatrix) => {
      expect(f.draws.map(draw => draw.id)).toEqual(['opaque'])
      expect(matrix).toBe(identity); expect(normalMatrix).toBe(identity)
      expect(commands).toHaveLength(2)
      expect(new Set(commands.map(command => command.mesh))).toEqual(new Set([far, front]))
      expect(commands.find(command => command.mesh === far)?.alpha).toBe(.4)
      expect(commands.find(command => command.mesh === front)?.alpha).toBe(.5)
      expect(commands.find(command => command.mesh === front)?.plane).toEqual([1, 0, 0, -4])
      expect(commands.find(command => command.mesh === far)?.plane).toBeUndefined()
      expect(commands.every(command => command.fragment === fragment)).toBe(true)
      return true
    })
    f.viewer.drawMesh3D(true, 1, identity, identity, identity)
    expect(preferred).toHaveBeenCalledOnce()
    expect(f.gl.drawElements).not.toHaveBeenCalled()
    expect(f.compile).not.toHaveBeenCalled()
    expect(f.viewer.meshes).toBe(original); expect(f.viewer.meshShaders).toBe(shaders)
    expect(original.map(item => item.opacity)).toEqual([.5, .4, 1])
    const dispose = vi.spyOn(SurfaceOIT.prototype, 'dispose').mockImplementation(() => {})
    vi.spyOn(Niivue.prototype, 'cleanup').mockImplementation(() => {})
    f.viewer.cleanup()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('retains the bounded nearest-face fallback when per-pixel transparency is unsupported', () => {
    const f = fixture([mesh('surface', .5)])
    const preferred = vi.spyOn(SurfaceOIT.prototype, 'draw').mockReturnValue(false)
    f.viewer.drawMesh3D(true, 1, identity, identity, identity)
    expect(preferred).toHaveBeenCalledOnce()
    expect(f.gl.drawElements).toHaveBeenCalledOnce()
    expect(f.draws[0]).toMatchObject({ id: 'surface', opacity: .5, culled: true, depthWrite: true, cullMode: f.gl.BACK })
  })

  it('restores source collections if a preferred transparency draw unexpectedly fails', () => {
    const originals = [mesh('surface', .5), mesh('opaque')], f = fixture(originals), shaders = f.viewer.meshShaders
    vi.spyOn(SurfaceOIT.prototype, 'draw').mockImplementation(() => { throw Error('Per-pixel draw failed') })
    expect(() => f.viewer.drawMesh3D(true, 1, identity, identity, identity)).toThrow('Per-pixel draw failed')
    expect(f.viewer.meshes).toBe(originals); expect(f.viewer.meshShaders).toBe(shaders)
    expect(originals.map(item => item.opacity)).toEqual([.5, 1])
  })

  it('draws opaque depth first and far-to-near translucent faces regardless of source insertion order', () => {
    const near = mesh('near', .5, -.5), far = mesh('far', .4, .5), opaque = mesh('opaque'), hidden = mesh('zero', 0)
    const originals = [near, hidden, far, opaque], f = fixture(originals), shaders = f.viewer.meshShaders
    const points = near.pts, triangles = near.tris
    f.viewer.drawMesh3D(true, 1, identity, identity, identity)
    expect(f.draws.map(draw => draw.id)).toEqual(['opaque', 'far', 'near'])
    expect(f.draws.map(draw => draw.opacity)).toEqual([1, .4, .5])
    expect(f.draws.filter(draw => draw.kind === 'translucent').map(draw => draw.culled)).toEqual([true, true])
    expect(f.draws.filter(draw => draw.kind === 'translucent').every(draw => draw.depthWrite === true && draw.cullMode === f.gl.BACK)).toBe(true)
    expect(f.viewer.meshes).toBe(originals)
    expect(f.viewer.meshShaders).toBe(shaders)
    expect(near.pts).toBe(points); expect(near.tris).toBe(triangles)
    expect(originals.map(item => item.opacity)).toEqual([.5, 0, .4, 1])
  })

  it('multiplies global and per-structure opacity exactly once', () => {
    const f = fixture([mesh('foreground', .5)])
    f.viewer.drawMesh3D(true, .8, identity, identity, identity)
    expect(f.draws.map(draw => draw.opacity)).toEqual([.4])
  })

  it('keeps original cutaway planes in the stable nearest-face fallback', () => {
    const target = mesh('target', .5), f = fixture([target, mesh('opaque')])
    f.viewer.surfaceCutaway = { axis: 0, side: 1, position_mm: 4, structures: ['target'] }
    f.viewer.cutawayMeshIds.add(target.id)
    f.viewer.drawMesh3D(true, 1, identity, identity, identity)
    expect(f.draws.map(draw => draw.id)).toEqual(['opaque', 'target'])
    const source = f.draws[1].source
    expect(source).toContain('normalize(gl_FrontFacing ? vN : -vN)')
    expect(source).toContain('if (dot(vec4(vP.xyz, 1.0), neuroimageCutPlane) > 0.0) discard;')
    expect(f.gl.uniform4fv.mock.calls.some(([, plane]: [unknown, number[]]) => JSON.stringify(plane) === '[1,0,0,-4]')).toBe(true)
    expect(f.viewer.surfaceCutaway).toEqual({ axis: 0, side: 1, position_mm: 4, structures: ['target'] })
  })

  it('retains opaque packed-depth picking and excludes zero-opacity meshes', () => {
    const visible = mesh('surface', .2), zero = mesh('zero', 0), f = fixture([visible, zero])
    f.viewer.uiData.mouseDepthPicker = true
    f.viewer.drawMesh3D(true, .3, identity, identity, identity)
    expect(f.draws).toEqual([{ id: 'surface', kind: 'native', opacity: 1, source: 'depth-pick' }])
    expect(f.compile).not.toHaveBeenCalled()
    expect(visible.opacity).toBe(.2); expect(zero.opacity).toBe(0)
  })

  it('keeps a clipped translucent surface subject to the same depth-picking plane', () => {
    const target = mesh('target', .3), f = fixture([target])
    f.viewer.surfaceCutaway = { axis: 2, side: -1, position_mm: 8, structures: ['target'] }
    f.viewer.cutawayMeshIds.add(target.id); f.viewer.uiData.mouseDepthPicker = true
    const original = f.viewer.pickingMeshShader
    f.viewer.drawMesh3D(true, .2, identity, identity, identity)
    expect(f.draws).toEqual([{ id: 'target', kind: 'native', opacity: 1, source: 'depth-pick' }])
    expect(f.compile.mock.calls.some(([source]) => source.includes('neuroimageCutPlane') && source.includes('color=vec4(0.0)'))).toBe(true)
    expect(f.viewer.pickingMeshShader).toBe(original)
    expect(target.opacity).toBe(.3)
  })

  it.each([false, true])('retains the native opaque / 2D fallback (2D=%s)', is2D => {
    const f = fixture([mesh('source', is2D ? .5 : 1)])
    f.viewer.drawMesh3D(true, 1, identity, identity, identity, is2D)
    expect(f.native).toHaveBeenCalledOnce()
    expect(f.draws[0].kind).toBe('native')
    expect(f.compile).not.toHaveBeenCalled()
  })

  it('ignores empty translucent meshes without disturbing opaque fallback rendering', () => {
    const empty = mesh('empty', .5), opaque = mesh('opaque')
    empty.indexCount = 0
    const f = fixture([empty, opaque])
    expect(() => f.viewer.drawMesh3D(true, 1, identity, identity, identity)).not.toThrow()
    expect(f.draws).toEqual([{ id: 'opaque', kind: 'native', opacity: 1, source: fragment }])
    expect(f.gl.drawElements).not.toHaveBeenCalled()
    expect(f.compile).not.toHaveBeenCalled()
  })

  it.each([1, 62])('keeps state queries and shared material uploads constant for %s translucent surfaces', count => {
    const sources = Array.from({ length: count }, (_, index) => mesh(`source-${index}`, .5, index / count))
    const f = fixture(sources)
    f.viewer.drawMesh3D(true, 1, identity, identity, identity)
    expect(f.gl.getParameter).toHaveBeenCalledTimes(12)
    expect(f.gl.isEnabled).toHaveBeenCalledTimes(3)
    expect(f.gl.uniformMatrix4fv).toHaveBeenCalledTimes(2)
    expect(f.gl.uniform1f).toHaveBeenCalledOnce()
    expect(f.gl.useProgram).toHaveBeenCalledTimes(2) // one bind and restoration
    expect(f.compile).toHaveBeenCalledOnce()
    expect(f.compile.mock.results[0].value.shader.use).toHaveBeenCalledOnce()
    expect(f.gl.drawElements).toHaveBeenCalledTimes(count)
    expect(f.draws.every(draw => draw.culled === true && draw.depthWrite === true && draw.cullMode === f.gl.BACK)).toBe(true)
    expect(f.draws.map(draw => draw.id)).toEqual([...sources].reverse().map(source => source.id))
    expect(f.viewer.meshes).toBe(sources)

    const rotated = Float32Array.from(identity)
    rotated[10] = -1
    f.viewer.drawMesh3D(true, 1, rotated, identity, identity)
    expect(f.compile).toHaveBeenCalledOnce()
    expect(f.compile.mock.results[0].value.shader.use).toHaveBeenCalledTimes(2)
    expect(f.gl.getParameter).toHaveBeenCalledTimes(24)
    expect(f.gl.isEnabled).toHaveBeenCalledTimes(6)
    expect(f.gl.uniformMatrix4fv).toHaveBeenCalledTimes(4)
    expect(f.gl.useProgram).toHaveBeenCalledTimes(4)
    expect(f.gl.drawElements).toHaveBeenCalledTimes(2 * count)
    expect(f.draws.slice(count).map(draw => draw.id)).toEqual(sources.map(source => source.id))
  })

  it('restores the mesh collection and shader definitions if a transparent draw fails', () => {
    const originals = [mesh('target', .5)], f = fixture(originals), shaders = f.viewer.meshShaders, picking = f.viewer.pickingMeshShader
    f.gl.drawElements.mockImplementationOnce(() => { throw Error('Draw failed') })
    expect(() => f.viewer.drawMesh3D(true, 1, identity, identity, identity)).toThrow('Draw failed')
    expect(f.viewer.meshes).toBe(originals)
    expect(f.viewer.meshShaders).toBe(shaders)
    expect(f.viewer.pickingMeshShader).toBe(picking)
    expect(originals[0].opacity).toBe(.5)
  })

  it('restores original opacities and source shaders if a clipped depth-pick fails', () => {
    const target = mesh('target', .3), f = fixture([target]), shaders = f.viewer.meshShaders, picking = f.viewer.pickingMeshShader
    f.viewer.surfaceCutaway = { axis: 0, side: 1, position_mm: 0, structures: ['target'] }
    f.viewer.cutawayMeshIds.add(target.id); f.viewer.uiData.mouseDepthPicker = true
    f.native.mockImplementationOnce(() => { throw Error('Depth failed') })
    expect(() => f.viewer.drawMesh3D(true, 1, identity, identity, identity)).toThrow('Depth failed')
    expect(target.opacity).toBe(.3)
    expect(f.viewer.meshShaders).toBe(shaders)
    expect(f.viewer.pickingMeshShader).toBe(picking)
  })

  it('reuses and deletes both cutaway and translucent programs on cleanup', () => {
    const target = mesh('target', .5), f = fixture([target])
    f.viewer.surfaceCutaway = { axis: 0, side: 1, position_mm: 0, structures: ['target'] }
    f.viewer.cutawayMeshIds.add(target.id)
    f.viewer.drawMesh3D(true, 1, identity, identity, identity)
    f.viewer.drawMesh3D(true, 1, identity, identity, identity)
    expect(f.compile).toHaveBeenCalledTimes(2)
    vi.spyOn(Niivue.prototype, 'cleanup').mockImplementation(() => {})
    f.viewer.cleanup()
    expect(f.gl.deleteProgram).toHaveBeenCalledTimes(2)
    expect(f.gl.deleteShader).toHaveBeenCalledTimes(2)
  })
})
