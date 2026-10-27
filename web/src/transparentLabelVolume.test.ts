import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Niivue } from '@niivue/niivue'
import { compositeLabelSegments, LABEL_ID_TEXTURE_UNIT, TransparentLabelVolume, transparentLabelFragment } from './transparentLabelVolume'

const nativeSource = readFileSync(new URL('../../node_modules/@niivue/niivue/dist/index.js', import.meta.url), 'utf8')
const nativeDepthArgument = /float\s+frac2ndc\s*\(\s*(vec[234])\s+\w+\s*\)/.exec(nativeSource)?.[1]
if (!nativeDepthArgument) throw new Error('The installed native depth helper declaration is unavailable.')

const prefix = `#version 300 es
precision highp float;
uniform bool isClipCutaway;
vec3 GetBackPosition(vec3 p) { return p; }
void clipSampleRange(vec3 d, vec4 p, vec4 plane, inout vec2 range, inout bool hasClip) {}
bool skipSample(float p, vec2 range) { return p < range.x || p > range.y; }
float frac2ndc(${nativeDepthArgument} p) { return p.z; }
`
const nativeFragment = prefix + 'void main() { fColor = vec4(1.0); }'

describe('transparent categorical ray segments', () => {
  const front = { id: 1, color: [1, 0, 0] }, rear = { id: 2, color: [0, 0, 1] }

  it('reveals the rear structure rather than fading an opaque front hit', () => {
    expect(compositeLabelSegments([front, rear], .5)).toEqual([.5, 0, .25, .75])
    expect(compositeLabelSegments([rear, front], .5)).toEqual([.25, 0, .5, .75])
    expect(compositeLabelSegments([front, rear], 1)).toEqual([1, 0, 0, 1])
    expect(compositeLabelSegments([front, rear], 0)).toEqual([0, 0, 0, 0])
  })

  it('does not saturate opacity simply because the front structure is thick', () => {
    const thick = [...Array.from({ length: 200 }, () => front), ...Array.from({ length: 200 }, () => rear)]
    expect(compositeLabelSegments(thick, .5)).toEqual([.5, 0, .25, .75])
  })

  it('distinguishes source identities even when their display colors match', () => {
    expect(compositeLabelSegments([front, { ...front, id: 2 }], .5)).toEqual([.75, 0, 0, .75])
    expect(compositeLabelSegments([front, front], .5)).toEqual([.5, 0, 0, .5])
  })

  it('supports disconnected entries, inherited per-label opacity and an interior exposed at the cut entry', () => {
    const empty = { id: 0, color: [0, 0, 0] }
    expect(compositeLabelSegments([front, empty, front], .5)).toEqual([.75, 0, 0, .75])
    expect(compositeLabelSegments([{ ...front, alpha: .5 }, rear], .5)).toEqual([.25, 0, .375, .625])
    expect(compositeLabelSegments([rear, rear], .5)).toEqual([0, 0, .5, .5])
  })

  it('retains native physical ray/clip helpers while replacing the opaque main function', () => {
    const fragment = transparentLabelFragment(nativeFragment)
    expect(fragment.startsWith(prefix)).toBe(true)
    expect(fragment).not.toContain('fColor = vec4(1.0)')
    expect(fragment).toContain('label != 0 && label != previousLabel')
    expect(fragment).toContain('(1.0 - accumulated.a) * alpha')
    expect(fragment).toContain('backOpacity * sampleColor.a')
    expect(fragment).toContain('accumulated.rgb / accumulated.a')
    expect(nativeDepthArgument).toBe('vec3')
    expect(fragment).toContain('gl_FragDepth = frac2ndc(position)')
    expect(fragment).not.toContain('frac2ndc(vec4(position')
    expect(fragment).toContain('skipSample(sampleDistance, sampleRange) == isClipCutaway')
    expect(fragment).toContain('rayLength / voxelLength * 0.5')
    expect(fragment).toContain('if (sampleColor.a > 0.0) {\n        ivec3 idBytes')
    expect(fragment).toContain('sampleDistance > sampleEnd')
    expect(fragment).toContain('min(rayLength, sampleRange.y)')
    expect(() => transparentLabelFragment('void main() {}')).toThrow('recognized ray/clip helpers')
  })

  it.each([
    { rayLength: 1, voxelLength: 200, range: [.125, .625] },
    { rayLength: 1.3, voxelLength: 17, range: [.138, .941] },
    { rayLength: .7, voxelLength: 80, range: [-.1, .392] },
    { rayLength: 1, voxelLength: 200, range: [.125, 1.5] },
  ])('retains the exact half-voxel sample lattice when stopping at clip exit: %j', ({ rayLength, voxelLength, range }) => {
    const stepLength = rayLength / voxelLength * .5
    const samples = (stop: number) => {
      const result: number[] = []
      for (let position = Math.max(0, range[0]), index = 0; index < 8192 && position <= stop; position += stepLength, index++) {
        if (position >= range[0] && position <= range[1]) result.push(position)
      }
      return result
    }
    const original = samples(rayLength), optimized = samples(Math.min(rayLength, range[1]))
    expect(optimized).toEqual(original)
    // Stable source IDs, transparent gaps and inherited alpha must produce
    // exactly the same segment accumulation from those retained samples.
    const labels = (points: number[]) => points.map(position => position < .3 ? front : position < .4
      ? { id: 0, color: [0, 0, 0] } : { ...rear, id: 257, alpha: .7 })
    expect(compositeLabelSegments(labels(optimized), .5)).toEqual(compositeLabelSegments(labels(original), .5))
  })
})

function fixture() {
  const attached = new Map<unknown, { type: number; text: string }[]>()
  const compiled: { vertex: string; fragment: string }[] = []
  let active = 1005, program: unknown = null, counter = 0
  const oldIdBinding = { texture: 'prior unit14 binding' }, ids = { texture: 'source label IDs' }
  const bindings = new Map<number, unknown>([[1014, oldIdBinding]])
  const gl = {
    TEXTURE0: 1000, TEXTURE_3D: 30, ACTIVE_TEXTURE: 1, CURRENT_PROGRAM: 2, TEXTURE_BINDING_3D: 3,
    VERTEX_SHADER: 10, FRAGMENT_SHADER: 11, SHADER_TYPE: 12,
    getParameter: vi.fn((key: number) => key === 1 ? active : key === 2 ? program : bindings.get(active)),
    activeTexture: vi.fn((unit: number) => { active = unit }),
    bindTexture: vi.fn((_target: number, texture: unknown) => { bindings.set(active, texture) }),
    useProgram: vi.fn((value: unknown) => { program = value }),
    getAttachedShaders: vi.fn((value: unknown) => attached.get(value) ?? []),
    getShaderParameter: vi.fn((shader: { type: number }) => shader.type),
    getShaderSource: vi.fn((shader: { text: string }) => shader.text),
    getUniformLocation: vi.fn((value: { id: number }, key: string) => `${value.id}:${key}`),
    uniform1i: vi.fn(), uniform1f: vi.fn(), uniform3fv: vi.fn(), deleteShader: vi.fn(), deleteProgram: vi.fn(),
  }
  class Shader {
    program: unknown
    uniforms: Record<string, unknown>
    constructor(_gl: unknown, vertex: string, fragment: string) {
      this.program = { id: ++counter }
      this.uniforms = { neuroimageLabelIds: 'label-ids', backOpacity: 'opacity', texVox: 'voxels', volScale: 'scale' }
      attached.set(this.program, [{ type: 10, text: vertex }, { type: 11, text: fragment }])
      compiled.push({ vertex, fragment })
    }
    use() { gl.useProgram(this.program) }
  }
  const native = new Shader(gl, 'native volume vertex', nativeFragment)
  program = native.program
  const viewer = { gl, renderShader: native, uiData: { mouseDepthPicker: false }, vox: [193, 229, 193], volScale: [1, .8, .9],
    initRenderShader: vi.fn((shader: Shader) => { shader.use() }) } as unknown as Niivue
  return { viewer, gl, native, ids: ids as WebGLTexture, oldIdBinding, compiled, active: () => active, program: () => program, binding: () => bindings.get(1014) }
}

describe('transparent categorical program lifetime and draw scope', () => {
  it('binds source identities and physical voxel scales, reusing the compiled program for opacity changes', () => {
    const f = fixture(), resources = new TransparentLabelVolume(), shaders: unknown[] = []
    const first = resources.draw(f.viewer, f.ids, .5, () => {
      shaders.push(f.viewer.renderShader)
      expect(f.viewer.renderShader).not.toBe(f.native)
      expect(f.binding()).toBe(f.ids)
      return 42
    })
    expect(first).toBe(42)
    resources.draw(f.viewer, f.ids, .25, () => { shaders.push(f.viewer.renderShader) })
    expect(shaders[0]).toBe(shaders[1]); expect(f.compiled).toHaveLength(2)
    expect(f.viewer.initRenderShader).toHaveBeenCalledOnce()
    expect(f.gl.uniform1i).toHaveBeenCalledWith('label-ids', LABEL_ID_TEXTURE_UNIT)
    expect(f.gl.uniform1f).toHaveBeenCalledWith('opacity', .5)
    expect(f.gl.uniform1f).toHaveBeenCalledWith('opacity', .25)
    expect(f.gl.uniform3fv).toHaveBeenCalledWith('voxels', [193, 229, 193])
    expect(f.gl.uniform3fv).toHaveBeenCalledWith('scale', [1, .8, .9])
    expect(f.gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'volume')
    expect(f.gl.getUniformLocation).toHaveBeenCalledWith(expect.anything(), 'clipPlanes[0]')
    expect(f.viewer.renderShader).toBe(f.native); expect(f.program()).toBe(f.native.program)
    expect(f.active()).toBe(1005); expect(f.binding()).toBe(f.oldIdBinding)
    resources.dispose(f.viewer)
    expect(f.gl.deleteProgram).toHaveBeenCalledOnce()
    expect(f.gl.deleteProgram).not.toHaveBeenCalledWith(f.native.program)
    expect(f.gl.deleteShader).toHaveBeenCalledTimes(2)
  })

  it('restores the exact native shader, program and ID texture binding when drawing fails', () => {
    const f = fixture(), resources = new TransparentLabelVolume()
    expect(() => resources.draw(f.viewer, f.ids, .5, () => { throw new Error('draw failed') })).toThrow('draw failed')
    expect(f.viewer.renderShader).toBe(f.native); expect(f.program()).toBe(f.native.program)
    expect(f.active()).toBe(1005); expect(f.binding()).toBe(f.oldIdBinding)
    resources.dispose(f.viewer); resources.dispose(f.viewer)
    expect(f.gl.deleteProgram).toHaveBeenCalledOnce()
  })

  it('retains its prior cached program when replacement initialization fails, then releases it after a successful replacement', () => {
    const f = fixture(), resources = new TransparentLabelVolume()
    let original: Niivue['renderShader']
    resources.draw(f.viewer, f.ids, .5, () => { original = f.viewer.renderShader })
    const Constructor = f.native.constructor as new (gl: unknown, vertex: string, fragment: string) => typeof f.native
    const replacement = new Constructor(f.gl, 'replacement volume vertex', nativeFragment)
    f.viewer.renderShader = replacement as unknown as Niivue['renderShader']
    f.gl.useProgram(replacement.program)
    let failed: Niivue['renderShader']
    vi.mocked(f.viewer.initRenderShader).mockImplementationOnce(shader => { failed = shader; throw Error('init failed') })
    expect(() => resources.draw(f.viewer, f.ids, .5, () => {})).toThrow('init failed')
    expect(f.viewer.renderShader).toBe(replacement); expect(f.program()).toBe(replacement.program)
    expect(f.active()).toBe(1005); expect(f.binding()).toBe(f.oldIdBinding)
    expect(f.gl.deleteProgram).toHaveBeenCalledExactlyOnceWith(failed!.program)
    expect(f.gl.deleteProgram).not.toHaveBeenCalledWith(original!.program)
    f.viewer.renderShader = f.native as unknown as Niivue['renderShader']
    resources.draw(f.viewer, f.ids, .5, () => { expect(f.viewer.renderShader).toBe(original) })
    f.viewer.renderShader = replacement as unknown as Niivue['renderShader']
    resources.draw(f.viewer, f.ids, .5, () => { expect(f.viewer.renderShader).not.toBe(original) })
    expect(f.gl.deleteProgram).toHaveBeenCalledWith(original!.program)
    resources.dispose(f.viewer)
    expect(f.gl.deleteProgram).toHaveBeenCalledTimes(3)
    expect(f.gl.deleteProgram).not.toHaveBeenCalledWith(f.native.program)
    expect(f.gl.deleteProgram).not.toHaveBeenCalledWith(replacement.program)
  })

  it('does not change opaque rendering, zero-opacity suppression or the native picking program', () => {
    const f = fixture(), resources = new TransparentLabelVolume(), draw = vi.fn()
    resources.draw(f.viewer, f.ids, 1, draw)
    resources.draw(f.viewer, f.ids, 0, draw)
    f.viewer.uiData.mouseDepthPicker = true
    resources.draw(f.viewer, f.ids, .5, draw)
    expect(draw).toHaveBeenCalledTimes(3)
    expect(f.compiled).toHaveLength(1)
    expect(f.gl.bindTexture).not.toHaveBeenCalled()
    expect(f.viewer.renderShader).toBe(f.native)
    resources.dispose(f.viewer)
    expect(f.gl.deleteProgram).not.toHaveBeenCalled()
  })
})
