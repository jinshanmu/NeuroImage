import { describe, expect, it, vi } from 'vitest'
import type { Niivue, NVMesh } from '@niivue/niivue'
import { drawTranslucentSurface, orderedSurfaces, withTranslucentSurfacePass } from './surfaceTransparency'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
type Face = { front: boolean; depth: number; color: number[] }

function mesh(id: string, z: number, opacity = .5, color = [1, 0, 0]): NVMesh {
  return { id, name: id, visible: true, opacity, indexCount: 3,
    extentsMin: [-1, -1, z], extentsMax: [1, 1, z],
    vao: { faces: [{ front: true, depth: (z + 1) / 2, color }] },
    get pts() { throw Error('Transparency must not scan source vertices') },
  } as unknown as NVMesh
}

/** Small rasterizer exercising real blend factors, culling and depth writes. */
class SurfaceGL {
  DEPTH_TEST = 2929; CULL_FACE = 2884; BLEND = 3042
  CURRENT_PROGRAM = 35725; VERTEX_ARRAY_BINDING = 34229; DEPTH_WRITEMASK = 2930; DEPTH_FUNC = 2932; CULL_FACE_MODE = 2885
  BLEND_SRC_RGB = 32969; BLEND_DST_RGB = 32968; BLEND_SRC_ALPHA = 32971; BLEND_DST_ALPHA = 32970
  BLEND_EQUATION_RGB = 32777; BLEND_EQUATION_ALPHA = 34877
  ACTIVE_TEXTURE = 34016; TEXTURE_BINDING_2D = 32873; TEXTURE_2D = 3553; TEXTURE0 = 33984; TEXTURE5 = 33989
  FRONT = 1028; BACK = 1029; FRONT_AND_BACK = 1032; LEQUAL = 515; ALWAYS = 519; GREATER = 516
  SRC_ALPHA = 770; ONE_MINUS_SRC_ALPHA = 771; ONE = 1; ZERO = 0; FUNC_ADD = 32774; FUNC_REVERSE_SUBTRACT = 32779
  TRIANGLES = 4; UNSIGNED_INT = 5125
  enabled = new Set<number>([this.CULL_FACE])
  parameters = new Map<number, unknown>([
    [this.CURRENT_PROGRAM, { name: 'previous-program' }], [this.VERTEX_ARRAY_BINDING, { name: 'previous-vao' }],
    [this.DEPTH_WRITEMASK, true], [this.DEPTH_FUNC, this.GREATER], [this.CULL_FACE_MODE, this.FRONT_AND_BACK],
    [this.BLEND_SRC_RGB, this.ONE], [this.BLEND_DST_RGB, this.ZERO], [this.BLEND_SRC_ALPHA, this.ZERO], [this.BLEND_DST_ALPHA, this.ONE],
    [this.BLEND_EQUATION_RGB, this.FUNC_REVERSE_SUBTRACT], [this.BLEND_EQUATION_ALPHA, this.FUNC_ADD],
    [this.ACTIVE_TEXTURE, this.TEXTURE0 + 3],
  ])
  textures = new Map<number, unknown>([[this.TEXTURE0 + 3, { name: 'previous-active-texture' }], [this.TEXTURE5, { name: 'previous-matcap' }]])
  uniforms = new Map<unknown, unknown>()
  pixel = [0, 0, 0, 1]
  depth = 1
  draws: { cull: unknown; depthMask: unknown; blend: boolean; vao: unknown }[] = []
  getParameter(key: number) { return key === this.TEXTURE_BINDING_2D ? this.textures.get(this.parameters.get(this.ACTIVE_TEXTURE) as number) : this.parameters.get(key) }
  isEnabled(key: number) { return this.enabled.has(key) }
  enable(key: number) { this.enabled.add(key) }
  disable(key: number) { this.enabled.delete(key) }
  useProgram(program: unknown) { this.parameters.set(this.CURRENT_PROGRAM, program) }
  bindVertexArray(vao: unknown) { this.parameters.set(this.VERTEX_ARRAY_BINDING, vao) }
  depthMask(value: boolean) { this.parameters.set(this.DEPTH_WRITEMASK, value) }
  depthFunc(value: number) { this.parameters.set(this.DEPTH_FUNC, value) }
  cullFace(value: number) { this.parameters.set(this.CULL_FACE_MODE, value) }
  blendFuncSeparate(srcRgb: number, dstRgb: number, srcAlpha: number, dstAlpha: number) {
    for (const [key, value] of [[this.BLEND_SRC_RGB, srcRgb], [this.BLEND_DST_RGB, dstRgb], [this.BLEND_SRC_ALPHA, srcAlpha], [this.BLEND_DST_ALPHA, dstAlpha]]) this.parameters.set(key, value)
  }
  blendEquation(value: number) { this.blendEquationSeparate(value, value) }
  blendEquationSeparate(rgb: number, alpha: number) { this.parameters.set(this.BLEND_EQUATION_RGB, rgb); this.parameters.set(this.BLEND_EQUATION_ALPHA, alpha) }
  activeTexture(unit: number) { this.parameters.set(this.ACTIVE_TEXTURE, unit) }
  bindTexture(_kind: number, texture: unknown) { this.textures.set(this.parameters.get(this.ACTIVE_TEXTURE) as number, texture) }
  uniformMatrix4fv(location: unknown, _transpose: boolean, value: ArrayLike<number>) { this.uniforms.set(location, Array.from(value)) }
  uniform1f(location: unknown, value: number) { this.uniforms.set(location, value) }
  uniform1i(location: unknown, value: number) { this.uniforms.set(location, value) }
  uniform4fv(location: unknown, value: ArrayLike<number>) { this.uniforms.set(location, Array.from(value)) }
  state() { return { enabled: [...this.enabled].sort(), parameters: [...this.parameters], textures: [...this.textures] } }
  drawElements() {
    const vao = this.getParameter(this.VERTEX_ARRAY_BINDING) as { faces: Face[] }, cull = this.getParameter(this.CULL_FACE_MODE)
    this.draws.push({ cull, depthMask: this.getParameter(this.DEPTH_WRITEMASK), blend: this.isEnabled(this.BLEND), vao })
    for (const face of vao.faces) {
      if (this.isEnabled(this.CULL_FACE) && (cull === this.FRONT_AND_BACK || cull === (face.front ? this.FRONT : this.BACK))) continue
      if (this.isEnabled(this.DEPTH_TEST) && this.getParameter(this.DEPTH_FUNC) === this.LEQUAL && face.depth > this.depth) continue
      const alpha = this.uniforms.get('opacity') as number, source = [...face.color, alpha]
      const factor = (value: unknown) => value === this.SRC_ALPHA ? alpha : value === this.ONE_MINUS_SRC_ALPHA ? 1 - alpha : value === this.ONE ? 1 : 0
      this.pixel = this.isEnabled(this.BLEND) ? this.pixel.map((old, i) => source[i] * factor(this.getParameter(i === 3 ? this.BLEND_SRC_ALPHA : this.BLEND_SRC_RGB)) + old * factor(this.getParameter(i === 3 ? this.BLEND_DST_ALPHA : this.BLEND_DST_RGB))) : source
      if (this.getParameter(this.DEPTH_WRITEMASK)) this.depth = face.depth
    }
  }
}

function fixture(matcap = false) {
  const gl = new SurfaceGL(), program = { name: 'surface-program' }
  const shader = { program, isMatcap: matcap, uniforms: { mvpMtx: 'matrix', normMtx: 'normal', opacity: 'opacity', matCap: 'matcap-sampler', neuroimageCutPlane: 'cut-plane' }, use: () => gl.useProgram(program) } as unknown as NonNullable<Niivue['meshShaders'][number]['shader']>
  const viewer = { gl: gl as unknown as WebGL2RenderingContext, matCapTexture: { name: 'surface-matcap' } as WebGLTexture }
  const draw = (surface: NVMesh, alpha = 1, depth = true) => drawTranslucentSurface(viewer, surface, shader, identity, identity, surface.opacity * alpha, depth)
  return { gl, viewer, shader, draw }
}

describe('surface ordering without source geometry changes', () => {
  it('renders opaque surfaces first and transparent surfaces far to near independently of load order', () => {
    const front = mesh('front', -.5), back = mesh('back', .5), opaque = mesh('opaque', .9, 1)
    const original = [front, opaque, back]
    expect(orderedSurfaces(original, identity, 1)).toEqual([opaque, back, front])
    expect(orderedSurfaces([...original].reverse(), identity, 1)).toEqual([opaque, back, front])
    expect(original).toEqual([front, opaque, back])
    const rotated = [...identity]; rotated[10] = -1
    expect(orderedSurfaces(original, rotated, 1)).toEqual([opaque, front, back])
  })

  it('uses projected depth, stable source names for ties and effective global opacity', () => {
    const z = mesh('z', .2), a = mesh('a', .2), formerlyOpaque = mesh('opaque', .9, 1)
    expect(orderedSurfaces([z, a], identity, 1)).toEqual([a, z])
    expect(orderedSurfaces([z, formerlyOpaque, a], identity, .5)).toEqual([formerlyOpaque, a, z])
    const perspective = [...identity]; perspective[11] = 1
    expect(orderedSurfaces([mesh('near', -.4), mesh('far', .4)], perspective, 1).map(item => item.id)).toEqual(['far', 'near'])
  })

  it('keeps depth ties stable after the renderer generates new mesh UUIDs', () => {
    const first = mesh('random-z', .2), second = mesh('random-a', .2)
    first.name = 'Source A'; second.name = 'Source B'
    expect(orderedSurfaces([second, first], identity, 1)).toEqual([first, second])
    first.id = 'random-a'; second.id = 'random-z'
    expect(orderedSurfaces([second, first], identity, 1)).toEqual([first, second])
  })

  it('omits hidden, empty and zero-opacity objects including a zero global opacity', () => {
    const hidden = mesh('hidden', 0), zero = mesh('zero', 0, 0), empty = mesh('empty', 0)
    hidden.visible = false; empty.indexCount = 0
    expect(orderedSurfaces([hidden, zero, empty], identity, 1)).toEqual([])
    expect(orderedSurfaces([mesh('one', 0)], identity, 0)).toEqual([])
  })
})

describe('batched transparent surfaces', () => {
  it('uses constant GL queries and shared uniforms for 62 meshes, with one two-sided draw each', () => {
    const { gl, viewer, shader } = fixture(), before = gl.state()
    // Draw instrumentation must not include the rasterizer's own simulated
    // state lookups in the count of production WebGL API calls.
    const draws = vi.spyOn(gl, 'drawElements').mockImplementation(() => {
      expect(gl.enabled.has(gl.CULL_FACE)).toBe(false)
      expect(gl.parameters.get(gl.DEPTH_WRITEMASK)).toBe(false)
    })
    const queries = vi.spyOn(gl, 'getParameter'), capabilities = vi.spyOn(gl, 'isEnabled')
    const matrices = vi.spyOn(gl, 'uniformMatrix4fv'), opacity = vi.spyOn(gl, 'uniform1f'), programs = vi.spyOn(shader, 'use')
    const mvp = new Float32Array(identity), normal = new Float32Array(identity)
    withTranslucentSurfacePass(viewer, mvp, normal, true, draw => {
      for (let i = 0; i < 62; i++) draw(mesh(`parcel-${i}`, 0), shader, .5)
    })
    expect(queries).toHaveBeenCalledTimes(12)
    expect(capabilities).toHaveBeenCalledTimes(3)
    expect(draws).toHaveBeenCalledTimes(62)
    expect(matrices).toHaveBeenCalledTimes(2)
    expect(matrices.mock.calls[0][2]).toBe(mvp)
    expect(matrices.mock.calls[1][2]).toBe(normal)
    expect(opacity).toHaveBeenCalledOnce()
    expect(programs).toHaveBeenCalledOnce()
    expect(gl.state()).toEqual(before)
  })

  it('preserves sorted alpha composition and background opacity in a single pass', () => {
    const { gl, viewer, shader } = fixture()
    const front = mesh('red-front', -.5), back = mesh('blue-back', .5, .5, [0, 0, 1])
    withTranslucentSurfacePass(viewer, identity, identity, true, draw => {
      orderedSurfaces([front, back], identity, 1).forEach(item => draw(item, shader, item.opacity))
    })
    expect(gl.draws).toHaveLength(2)
    expect(gl.pixel).toEqual([.5, 0, .25, 1])
  })

  it('draws both orientations with culling disabled instead of submitting each triangle twice', () => {
    const { gl, viewer, shader } = fixture(), shell = mesh('shell', 0)
    ;(shell.vao as unknown as { faces: Face[] }).faces = [
      { front: false, depth: .6, color: [0, 0, 1] }, { front: true, depth: .4, color: [1, 0, 0] },
    ]
    withTranslucentSurfacePass(viewer, identity, identity, true, draw => draw(shell, shader, .5))
    expect(gl.draws).toHaveLength(1)
    expect(gl.pixel).toEqual([.5, 0, .25, 1])
  })

  it('uploads matrices per material and caches repeated plane and opacity uniforms', () => {
    const { gl, viewer, shader } = fixture()
    const second = { ...shader, program: { name: 'second' }, use: () => gl.useProgram({ name: 'second' }) } as unknown as typeof shader
    const matrices = vi.spyOn(gl, 'uniformMatrix4fv'), planes = vi.spyOn(gl, 'uniform4fv'), opacity = vi.spyOn(gl, 'uniform1f')
    const plane = [1, 0, 0, -2]
    withTranslucentSurfacePass(viewer, identity, identity, true, draw => {
      draw(mesh('one', 0), shader, .5, plane)
      draw(mesh('two', 0), shader, .5, plane)
      draw(mesh('three', 0), second, .5, plane)
      plane[3] = -3
      draw(mesh('four', 0), shader, .25, plane)
    })
    expect(matrices).toHaveBeenCalledTimes(4)
    expect(planes).toHaveBeenCalledTimes(3)
    expect(opacity).toHaveBeenCalledTimes(3)
    expect(gl.uniforms.get('cut-plane')).toEqual([1, 0, 0, -3])
  })

  it.each([false, true])('restores complete state after a batch fails (matcap %s)', matcap => {
    const { gl, viewer, shader } = fixture(matcap), before = gl.state()
    const draws = vi.spyOn(gl, 'drawElements')
    draws.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw Error('Batch failed') })
    expect(() => withTranslucentSurfacePass(viewer, identity, identity, true, draw => {
      draw(mesh('one', 0), shader, .5)
      draw(mesh('two', 0), shader, .5)
    })).toThrow('Batch failed')
    expect(gl.state()).toEqual(before)
    if (matcap) expect(gl.uniforms.get('matcap-sampler')).toBe(5)
  })
})

describe('stable nearest-face transparency fallback', () => {
  it.each([.95, .99, 1])('keeps the nearest front face as opacity %s approaches the opaque endpoint', alpha => {
    const { gl, viewer, shader } = fixture(), surface = mesh('self-overlapping-shell', 0, alpha)
    // A close back face and later far front face must not overwrite the
    // correctly shaded near front face when blending is nearly opaque.
    ;(surface.vao as unknown as { faces: Face[] }).faces = [
      { front: true, depth: .2, color: [1, 0, 0] },
      { front: true, depth: .8, color: [0, 0, 1] },
      { front: false, depth: .1, color: [0, 1, 0] },
    ]
    const before = gl.state()
    withTranslucentSurfacePass(viewer, identity, identity, true, draw => {
      draw(surface, shader, alpha)
    }, { frontOnly: true, writeDepth: true })
    expect(gl.pixel).toEqual([alpha, 0, 0, 1])
    expect(gl.depth).toBe(.2)
    expect(gl.draws).toHaveLength(1)
    expect(gl.draws[0].cull).toBe(gl.BACK)
    expect(gl.draws[0].depthMask).toBe(true)
    expect(gl.state()).toEqual(before)
  })

  it('retains a visible foreground over opaque depth and excludes a nearer back face', () => {
    const { gl, viewer, shader } = fixture(), surface = mesh('surface', 0, .5)
    gl.pixel = [0, 0, 1, 1]; gl.depth = .6
    ;(surface.vao as unknown as { faces: Face[] }).faces = [
      { front: false, depth: .1, color: [0, 1, 0] },
      { front: true, depth: .2, color: [1, 0, 0] },
      { front: true, depth: .8, color: [0, 1, 0] },
    ]
    withTranslucentSurfacePass(viewer, identity, identity, true, draw => {
      draw(surface, shader, .5)
    }, { frontOnly: true, writeDepth: true })
    expect(gl.pixel).toEqual([.5, 0, .5, 1])
    expect(gl.depth).toBe(.2)
  })
})

describe('translucent surface blending and GL isolation', () => {
  it('keeps the red translucent foreground over an opaque blue background regardless of insertion order', () => {
    const front = mesh('red-front', -.5), back = mesh('blue-back', .5, 1, [0, 0, 1])
    for (const source of [[front, back], [back, front]]) {
      const { gl, draw } = fixture()
      for (const surface of orderedSurfaces(source, identity, 1)) {
        if (surface.opacity === 1) { gl.pixel = [0, 0, 1, 1]; gl.depth = .75 }
        else draw(surface)
      }
      expect(gl.pixel).toEqual([.5, 0, .5, 1])
      expect(gl.depth).toBe(.75)
    }
  })

  it('composites transparent objects far to near rather than in insertion order', () => {
    const front = mesh('red-front', -.5), back = mesh('blue-back', .5, .5, [0, 0, 1])
    for (const source of [[front, back], [back, front]]) {
      const { gl, draw } = fixture()
      orderedSurfaces(source, identity, 1).forEach(item => draw(item))
      expect(gl.pixel).toEqual([.5, 0, .25, 1])
    }
  })

  it('draws back faces before front faces and retains an opaque background alpha', () => {
    const { gl, draw } = fixture(), surface = mesh('shell', 0)
    ;(surface.vao as unknown as { faces: Face[] }).faces = [
      { front: true, depth: .4, color: [1, 0, 0] }, { front: false, depth: .6, color: [0, 0, 1] },
    ]
    draw(surface)
    expect(gl.draws.map(call => call.cull)).toEqual([gl.FRONT, gl.BACK])
    expect(gl.draws.every(call => call.blend && call.depthMask === false)).toBe(true)
    expect(gl.pixel).toEqual([.5, 0, .25, 1])
    expect(gl.depth).toBe(1)
  })

  it('combines global and per-object opacity, respecting opaque occluders', () => {
    const { gl, draw } = fixture()
    draw(mesh('faint-red', 0, .5), .5)
    expect(gl.pixel).toEqual([.25, 0, 0, 1])
    gl.pixel = [0, 0, 1, 1]; gl.depth = .1
    draw(mesh('occluded-red', 0))
    expect(gl.pixel).toEqual([0, 0, 1, 1])
  })

  it('uses the final effective alpha exactly once rather than multiplying object opacity again', () => {
    const { gl, viewer, shader } = fixture()
    drawTranslucentSurface(viewer, mesh('surface', 0, .5), shader, identity, identity, .25, true)
    expect(gl.uniforms.get('opacity')).toBe(.25)
    expect(gl.pixel).toEqual([.25, 0, 0, 1])
  })

  it('supports explicit non-depth-tested passes and does not draw zero opacity', () => {
    const { gl, draw } = fixture()
    draw(mesh('zero', 0, 0)); draw(mesh('global-zero', 0), 0)
    expect(gl.draws).toEqual([])
    gl.depth = 0
    draw(mesh('overlay', 0), 1, false)
    expect(gl.pixel).toEqual([.5, 0, 0, 1])
  })

  it.each([false, true])('restores program, VAO, depth, cull, blending and texture state (matcap %s)', matcap => {
    const { gl, draw } = fixture(matcap), before = gl.state()
    draw(mesh('surface', 0))
    expect(gl.state()).toEqual(before)
    expect(gl.uniforms.get('matrix')).toEqual(identity)
    expect(gl.uniforms.get('normal')).toEqual(identity)
    if (matcap) expect(gl.uniforms.get('matcap-sampler')).toBe(5)
  })

  it('restores every touched state and source object when drawing throws', () => {
    const { gl, draw } = fixture(true), surface = mesh('surface', 0), before = gl.state(), vao = surface.vao
    vi.spyOn(gl, 'drawElements').mockImplementationOnce(() => { throw Error('GPU draw failed') })
    expect(() => draw(surface)).toThrow('GPU draw failed')
    expect(gl.state()).toEqual(before)
    expect(surface.vao).toBe(vao)
    expect(surface.opacity).toBe(.5)
  })
})
