import { describe, expect, it, vi } from 'vitest'
import type { Niivue } from '@niivue/niivue'
import { OIT_DEPTH_FRAGMENT, OIT_RESOLVE_FRAGMENT, OIT_RESOLVE_VERTEX, oitAccumulationFragment, SurfaceOIT } from './surfaceOIT'

const source = `#version 300 es
precision highp float;
in vec4 vClr;
uniform float opacity;
out vec4 color;
void main() { color = vec4(vClr.rgb, opacity); }`

describe('nearest-layer transparent surface shader contract', () => {
  it('retains the source lighting/color operation while separating nearest and deeper contributions', () => {
    const original = source
    const built = oitAccumulationFragment(source)
    expect(source).toBe(original)
    expect(built).toContain('void neuroimageSourceColor() { color = vec4(vClr.rgb, opacity); }')
    expect(built).toContain('neuroimageSourceColor();')
    expect(built).toContain('neuroimageFront = vec4(color.rgb * a, a);')
    expect(built).toContain('neuroimageLayers.r = -log(max(1.0 - a, 0.000001));')
    expect(built).toContain('uniform highp sampler2D neuroimageNearestDepth;')
    expect(built).toContain('uniform highp sampler2D neuroimageOpaqueDepth;')
    expect(OIT_RESOLVE_FRAGMENT).toContain('uniform highp sampler2D neuroimageNearestDepth;')
    expect(built.match(/layout\(location=/g)).toHaveLength(3)
  })

  it('retains identical cutaway tests in source and nearest-depth programs', () => {
    const built = oitAccumulationFragment(source)
    const predicate = 'if (neuroimageHasCut && dot(vec4(vP.xyz, 1.0), neuroimageCutPlane) > 0.0) discard;'
    expect(built).toContain(predicate)
    expect(OIT_DEPTH_FRAGMENT).toContain(predicate)
    const declared = source.replace('out vec4 color;', 'in vec4 vP;\nuniform vec4 neuroimageCutPlane;\nout vec4 color;')
    expect(oitAccumulationFragment(declared).match(/in vec4 vP;/g)).toHaveLength(1)
    expect(oitAccumulationFragment(declared).match(/uniform vec4 neuroimageCutPlane;/g)).toHaveLength(1)
  })

  it('fails closed when a custom source program does not have the pinned color/main contract', () => {
    expect(() => oitAccumulationFragment('void main() {}')).toThrow('Unsupported')
    expect(() => oitAccumulationFragment(source + source)).toThrow('Unsupported')
  })

  it('resolves premultiplied nearest color with a vanishing deeper contribution as alpha approaches one', () => {
    expect(OIT_RESOLVE_FRAGMENT).toContain('front.rgb + (1.0 - frontAlpha) * behindColor * behindAlpha')
    expect(OIT_RESOLVE_FRAGMENT).toContain('gl_FragDepth = texelFetch(neuroimageNearestDepth, p, 0).r;')
    expect(OIT_RESOLVE_FRAGMENT).toContain('ivec2(gl_FragCoord.xy) - neuroimageViewportOrigin')
    expect(OIT_RESOLVE_VERTEX).toContain('gl_VertexID')
  })
})

function unsupported(float = false, size: number[] = [0, 0, 100, 100]) {
  const gl = {
    MAX_DRAW_BUFFERS: 1, MAX_COLOR_ATTACHMENTS: 2, MAX_TEXTURE_IMAGE_UNITS: 3, DEPTH_BITS: 4, VIEWPORT: 5,
    getExtension: vi.fn(() => float ? {} : null),
    getParameter: vi.fn((name: number) => name === 4 ? 24 : name === 5 ? size : 16),
    createFramebuffer: vi.fn(), createTexture: vi.fn(), drawElements: vi.fn(),
  }
  const viewer = { gl: gl as unknown as WebGL2RenderingContext, createCustomMeshShader: vi.fn(), matCapTexture: null } as unknown as Pick<Niivue, 'gl' | 'createCustomMeshShader' | 'matCapTexture'>
  return { gl, oit: new SurfaceOIT(viewer) }
}

describe('transparent surface capability and allocation safeguards', () => {
  it('rejects a renderer without real GL capabilities before touching any render state', () => {
    const viewer = { gl: {} } as unknown as Pick<Niivue, 'gl' | 'createCustomMeshShader' | 'matCapTexture'>
    expect(new SurfaceOIT(viewer).draw([], [], [])).toBe(false)
  })
  it('falls back without touching source draws or allocating textures when float targets are unavailable', () => {
    const { gl, oit } = unsupported()
    expect(oit.draw([], [], [])).toBe(false)
    expect(oit.draw([], [], [])).toBe(false)
    expect(gl.getExtension).toHaveBeenCalledOnce()
    expect(gl.createFramebuffer).not.toHaveBeenCalled()
    expect(gl.createTexture).not.toHaveBeenCalled()
    expect(gl.drawElements).not.toHaveBeenCalled()
  })

  it.each([{ viewport: [0, 0, 0, 100] }, { viewport: [0, 0, 5000, 100] }, { viewport: [0, 0, 4096, 4096] }])('bounds temporary GPU storage for viewport $viewport', ({ viewport }) => {
    const { gl, oit } = unsupported(true, viewport)
    expect(oit.draw([], [], [])).toBe(false)
    expect(gl.createFramebuffer).not.toHaveBeenCalled()
    expect(gl.createTexture).not.toHaveBeenCalled()
  })

  it('does not start GL work after disposal', () => {
    const { gl, oit } = unsupported()
    oit.dispose()
    expect(oit.draw([], [], [])).toBe(false)
    expect(gl.getExtension).not.toHaveBeenCalled()
  })
})
