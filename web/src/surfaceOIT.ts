import type { Niivue, NVMesh } from '@niivue/niivue'

export interface SurfaceOITCommand {
  mesh: NVMesh
  fragment: string
  alpha: number
  plane?: ArrayLike<number>
  isMatcap?: boolean
}
type Viewer = Pick<Niivue, 'gl' | 'createCustomMeshShader' | 'matCapTexture'>
type Material = ReturnType<Niivue['createCustomMeshShader']>

export const OIT_DEPTH_FRAGMENT = `#version 300 es
precision highp float;
in vec4 vP;
uniform bool neuroimageHasCut;
uniform vec4 neuroimageCutPlane;
void main() {
  if (neuroimageHasCut && dot(vec4(vP.xyz, 1.0), neuroimageCutPlane) > 0.0) discard;
}`

/** Retain the supplied material's color/lighting, changing only compositing. */
export function oitAccumulationFragment(fragment: string): string {
  if ([...fragment.matchAll(/\bout\s+vec4\s+color\s*;/g)].length !== 1 ||
      [...fragment.matchAll(/void\s+main\s*\([^)]*\)\s*\{/g)].length !== 1) {
    throw Error('Unsupported source surface color shader.')
  }
  const declarations = `
${/\bin\s+vec4\s+vP\s*;/.test(fragment) ? '' : 'in vec4 vP;'}
${/\buniform\s+vec4\s+neuroimageCutPlane\s*;/.test(fragment) ? '' : 'uniform vec4 neuroimageCutPlane;'}
uniform bool neuroimageHasCut;
uniform highp sampler2D neuroimageNearestDepth;
uniform highp sampler2D neuroimageOpaqueDepth;
uniform float neuroimageDepthEpsilon;
layout(location=0) out vec4 neuroimageFront;
layout(location=1) out vec4 neuroimageBehind;
layout(location=2) out vec4 neuroimageLayers;
vec4 color;
`
  return fragment.replace(/\bout\s+vec4\s+color\s*;/, declarations)
    .replace(/void\s+main\s*\([^)]*\)\s*\{/, 'void neuroimageSourceColor() {') + `
void main() {
  if (neuroimageHasCut && dot(vec4(vP.xyz, 1.0), neuroimageCutPlane) > 0.0) discard;
  ivec2 p = ivec2(gl_FragCoord.xy);
  float opaqueDepth = texelFetch(neuroimageOpaqueDepth, p, 0).r;
  if (gl_FragCoord.z > opaqueDepth + neuroimageDepthEpsilon) discard;
  neuroimageSourceColor();
  float a = clamp(color.a, 0.0, 1.0);
  if (a <= 0.0) discard;
  float nearestDepth = texelFetch(neuroimageNearestDepth, p, 0).r;
  neuroimageFront = vec4(0.0);
  neuroimageBehind = vec4(0.0);
  neuroimageLayers = vec4(0.0);
  if (gl_FragCoord.z <= nearestDepth + neuroimageDepthEpsilon) {
    neuroimageFront = vec4(color.rgb * a, a);
    neuroimageLayers.g = 1.0;
  } else {
    float weight = clamp(pow(1.0 - gl_FragCoord.z, 3.0) * 8.0 + 0.01, 0.01, 8.0);
    neuroimageBehind = vec4(color.rgb * a * weight, a * weight);
    neuroimageLayers.r = -log(max(1.0 - a, 0.000001));
  }
}`
}

export const OIT_RESOLVE_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export const OIT_RESOLVE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D neuroimageNearestDepth;
uniform highp sampler2D neuroimageFront;
uniform highp sampler2D neuroimageBehind;
uniform highp sampler2D neuroimageLayers;
uniform ivec2 neuroimageViewportOrigin;
out vec4 color;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) - neuroimageViewportOrigin;
  vec4 front = texelFetch(neuroimageFront, p, 0);
  vec4 behind = texelFetch(neuroimageBehind, p, 0);
  vec4 layers = texelFetch(neuroimageLayers, p, 0);
  if (layers.g <= 0.0) discard;
  front /= layers.g;
  float frontAlpha = clamp(front.a, 0.0, 1.0);
  float behindAlpha = 1.0 - exp(-max(layers.r, 0.0));
  vec3 behindColor = behind.rgb / max(behind.a, 0.000001);
  color = vec4(front.rgb + (1.0 - frontAlpha) * behindColor * behindAlpha,
    frontAlpha + (1.0 - frontAlpha) * behindAlpha);
  gl_FragDepth = texelFetch(neuroimageNearestDepth, p, 0).r;
}`

type Targets = {
  width: number; height: number
  nearest: WebGLTexture; opaque: WebGLTexture; colors: WebGLTexture[]
  nearestFbo: WebGLFramebuffer; opaqueFbo: WebGLFramebuffer; colorFbo: WebGLFramebuffer
}
type Resolve = { program: WebGLProgram; shaders: WebGLShader[]; uniforms: Record<string, WebGLUniformLocation | null>; vao: WebGLVertexArrayObject }

/** Exact nearest layer plus order-independent weighted deeper source surfaces. */
export class SurfaceOIT {
  private targets?: Targets
  private depth?: Material
  private materials = new Map<string, Material>()
  private resolve?: Resolve
  private disabled = false
  private checkedBlit = false
  private depthBits = 24
  private capability: boolean | undefined

  constructor(private viewer: Viewer) {}

  draw(commands: readonly SurfaceOITCommand[], matrix: ArrayLike<number>, normalMatrix: ArrayLike<number>): boolean {
    if (this.disabled) return false
    const gl = this.viewer.gl
    if (typeof gl.getExtension !== 'function' || typeof gl.getParameter !== 'function') return false
    if (this.capability === undefined) {
      this.capability = !!gl.getExtension('EXT_color_buffer_float') && gl.getParameter(gl.MAX_DRAW_BUFFERS) >= 3 &&
        gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) >= 3 && gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) >= 16
      this.depthBits = gl.getParameter(gl.DEPTH_BITS)
    }
    if (!this.capability || ![16, 24, 32].includes(this.depthBits)) return false
    const viewport = Array.from(gl.getParameter(gl.VIEWPORT)) as number[]
    const [x, y, width, height] = viewport
    if (!width || !height || width > 4096 || height > 4096 || width * height > 8_388_608) return false
    const saved = this.save()
    if (saved.drawFbo !== null) return false
    try {
      this.ensure(width, height)
      const targets = this.targets!, depth = this.depth!.shader!, resolve = this.resolve!
      const active = commands.filter(command => command.mesh.visible && command.alpha > 0 && Number.isFinite(command.alpha) && (command.mesh.indexCount ?? 0) >= 3)
      if (!active.length) return true
      // Compile all variants before cached state and uniform setup begins.
      const prepared = active.map(command => ({ command, shader: this.material(command.fragment).shader! }))
      gl.disable(gl.SCISSOR_TEST)
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
      for (const fbo of [targets.nearestFbo, targets.opaqueFbo]) {
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo)
        gl.blitFramebuffer(x, y, x + width, y + height, 0, 0, width, height, gl.DEPTH_BUFFER_BIT, gl.NEAREST)
      }
      if (!this.checkedBlit) {
        this.checkedBlit = true
        if (gl.getError() !== gl.NO_ERROR) throw Error('Unsupported source depth copy.')
      }
      gl.viewport(0, 0, width, height)
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK)
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true)
      gl.disable(gl.BLEND); gl.colorMask(false, false, false, false)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.nearestFbo)
      depth.use(gl)
      gl.uniformMatrix4fv(depth.uniforms.mvpMtx, false, Float32Array.from(matrix))
      for (const command of active) {
        this.cut(depth, command.plane)
        gl.bindVertexArray(command.mesh.vao)
        gl.drawElements(gl.TRIANGLES, command.mesh.indexCount!, gl.UNSIGNED_INT, 0)
      }
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, targets.colorFbo)
      gl.colorMask(true, true, true, true)
      for (let attachment = 0; attachment < 3; attachment++) gl.clearBufferfv(gl.COLOR, attachment, new Float32Array(4))
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false)
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE)
      this.texture(12, targets.nearest); this.texture(13, targets.opaque)
      const initialized = new Set<NonNullable<Material['shader']>>()
      const mvp = Float32Array.from(matrix), normal = Float32Array.from(normalMatrix)
      let program: WebGLProgram | undefined
      for (const { command, shader } of prepared) {
        if (program !== shader.program) { shader.use(gl); program = shader.program }
        if (!initialized.has(shader)) {
          initialized.add(shader)
          gl.uniformMatrix4fv(shader.uniforms.mvpMtx, false, mvp)
          if (shader.uniforms.normMtx !== undefined) gl.uniformMatrix4fv(shader.uniforms.normMtx, false, normal)
          gl.uniform1i(shader.uniforms.neuroimageNearestDepth, 12)
          gl.uniform1i(shader.uniforms.neuroimageOpaqueDepth, 13)
          gl.uniform1f(shader.uniforms.neuroimageDepthEpsilon, 2 / (2 ** Math.min(this.depthBits, 24) - 1))
          if (command.isMatcap) { gl.uniform1i(shader.uniforms.matCap, 5); this.texture(5, this.viewer.matCapTexture) }
        }
        this.cut(shader, command.plane)
        gl.uniform1f(shader.uniforms.opacity, command.alpha)
        gl.bindVertexArray(command.mesh.vao)
        gl.drawElements(gl.TRIANGLES, command.mesh.indexCount!, gl.UNSIGNED_INT, 0)
      }
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
      gl.viewport(x, y, width, height)
      gl.enable(gl.SCISSOR_TEST)
      if (saved.enabled.get(gl.SCISSOR_TEST)) {
        const [sx, sy, sw, sh] = Array.from(saved.values.get(gl.SCISSOR_BOX)) as number[]
        const left = Math.max(x, sx), bottom = Math.max(y, sy)
        gl.scissor(left, bottom, Math.max(0, Math.min(x + width, sx + sw) - left), Math.max(0, Math.min(y + height, sy + sh) - bottom))
      } else gl.scissor(x, y, width, height)
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false)
      gl.disable(gl.CULL_FACE)
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.useProgram(resolve.program); gl.bindVertexArray(resolve.vao)
      this.texture(12, targets.nearest); this.texture(13, targets.colors[0])
      this.texture(14, targets.colors[1]); this.texture(15, targets.colors[2])
      for (const [name, unit] of [['neuroimageNearestDepth', 12], ['neuroimageFront', 13], ['neuroimageBehind', 14], ['neuroimageLayers', 15]] as const) gl.uniform1i(resolve.uniforms[name], unit)
      gl.uniform2i(resolve.uniforms.neuroimageViewportOrigin, x, y)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      return true
    } catch {
      this.disabled = true
      this.release()
      return false
    } finally { this.restore(saved) }
  }

  private material(fragment: string): Material {
    let material = this.materials.get(fragment)
    if (!material) {
      material = this.viewer.createCustomMeshShader(oitAccumulationFragment(fragment), 'NeuroImage surface OIT accumulation')
      this.materials.set(fragment, material)
    }
    return material
  }

  private cut(shader: NonNullable<Material['shader']>, plane?: ArrayLike<number>) {
    const gl = this.viewer.gl
    gl.uniform1i(shader.uniforms.neuroimageHasCut, plane ? 1 : 0)
    if (plane) gl.uniform4fv(shader.uniforms.neuroimageCutPlane, Float32Array.from(plane))
  }

  private texture(unit: number, texture: WebGLTexture | null) {
    const gl = this.viewer.gl
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture)
  }

  private ensure(width: number, height: number) {
    const gl = this.viewer.gl
    if (!this.depth) this.depth = this.viewer.createCustomMeshShader(OIT_DEPTH_FRAGMENT, 'NeuroImage surface OIT nearest')
    if (!this.resolve) this.resolve = this.resolveProgram()
    if (this.targets?.width === width && this.targets.height === height) return
    this.releaseTargets()
    const textures: WebGLTexture[] = [], fbos: WebGLFramebuffer[] = []
    try {
      const texture = (format: number) => {
        const item = gl.createTexture(); if (!item) throw Error('No OIT texture.')
        textures.push(item); this.texture(12, item)
        gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        return item
      }
      const fbo = () => { const item = gl.createFramebuffer(); if (!item) throw Error('No OIT framebuffer.'); fbos.push(item); gl.bindFramebuffer(gl.FRAMEBUFFER, item); return item }
      const format = this.depthBits === 16 ? gl.DEPTH_COMPONENT16 : this.depthBits === 32 ? gl.DEPTH_COMPONENT32F : gl.DEPTH_COMPONENT24
      const nearest = texture(format), opaque = texture(format)
      const nearestFbo = fbo(); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, nearest, 0)
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); this.complete()
      const opaqueFbo = fbo(); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, opaque, 0)
      gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); this.complete()
      const colors = [texture(gl.RGBA16F), texture(gl.RGBA16F), texture(gl.RGBA16F)]
      const colorFbo = fbo()
      colors.forEach((item, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, item, 0))
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]); gl.readBuffer(gl.COLOR_ATTACHMENT0); this.complete()
      this.targets = { width, height, nearest, opaque, colors, nearestFbo, opaqueFbo, colorFbo }
    } catch (error) { textures.forEach(item => gl.deleteTexture(item)); fbos.forEach(item => gl.deleteFramebuffer(item)); throw error }
  }

  private complete() {
    const gl = this.viewer.gl
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Unsupported OIT framebuffer.')
  }

  private resolveProgram(): Resolve {
    const gl = this.viewer.gl, shaders: WebGLShader[] = []
    const program = gl.createProgram(), vao = gl.createVertexArray()
    if (!program || !vao) {
      if (program) gl.deleteProgram(program)
      if (vao) gl.deleteVertexArray(vao)
      throw Error('No OIT resolve program.')
    }
    try {
      for (const [kind, source] of [[gl.VERTEX_SHADER, OIT_RESOLVE_VERTEX], [gl.FRAGMENT_SHADER, OIT_RESOLVE_FRAGMENT]] as const) {
        const shader = gl.createShader(kind); if (!shader) throw Error('No OIT resolve shader.')
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error('Invalid OIT resolve shader.')
        gl.attachShader(program, shader)
      }
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('Invalid OIT resolve program.')
      const uniforms = Object.fromEntries(['neuroimageNearestDepth', 'neuroimageFront', 'neuroimageBehind', 'neuroimageLayers', 'neuroimageViewportOrigin'].map(name => [name, gl.getUniformLocation(program, name)]))
      return { program, vao, shaders, uniforms }
    } catch (error) { shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program); gl.deleteVertexArray(vao); throw error }
  }

  private save() {
    const gl = this.viewer.gl
    const names: number[] = [gl.CURRENT_PROGRAM, gl.VERTEX_ARRAY_BINDING, gl.READ_FRAMEBUFFER_BINDING, gl.DRAW_FRAMEBUFFER_BINDING,
      gl.READ_BUFFER, gl.DRAW_BUFFER0, gl.VIEWPORT, gl.SCISSOR_BOX, gl.COLOR_WRITEMASK, gl.DEPTH_WRITEMASK, gl.DEPTH_FUNC,
      gl.CULL_FACE_MODE, gl.BLEND_SRC_RGB, gl.BLEND_DST_RGB, gl.BLEND_SRC_ALPHA, gl.BLEND_DST_ALPHA,
      gl.BLEND_EQUATION_RGB, gl.BLEND_EQUATION_ALPHA, gl.COLOR_CLEAR_VALUE, gl.DEPTH_CLEAR_VALUE, gl.ACTIVE_TEXTURE]
    const values = new Map(names.map(name => [name, gl.getParameter(name)]))
    const textures = new Map<number, WebGLTexture | null>()
    for (const unit of [5, 12, 13, 14, 15]) { gl.activeTexture(gl.TEXTURE0 + unit); textures.set(unit, gl.getParameter(gl.TEXTURE_BINDING_2D)) }
    gl.activeTexture(values.get(gl.ACTIVE_TEXTURE))
    return { values, textures, drawFbo: values.get(gl.DRAW_FRAMEBUFFER_BINDING), enabled: new Map([gl.DEPTH_TEST, gl.CULL_FACE, gl.BLEND, gl.SCISSOR_TEST].map(cap => [cap, gl.isEnabled(cap)])) }
  }

  private restore(saved: ReturnType<SurfaceOIT['save']>) {
    const gl = this.viewer.gl, value = (name: number) => saved.values.get(name)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, value(gl.DRAW_FRAMEBUFFER_BINDING)); gl.drawBuffers([value(gl.DRAW_BUFFER0)])
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, value(gl.READ_FRAMEBUFFER_BINDING)); gl.readBuffer(value(gl.READ_BUFFER))
    gl.viewport(...Array.from(value(gl.VIEWPORT)) as [number, number, number, number]); gl.scissor(...Array.from(value(gl.SCISSOR_BOX)) as [number, number, number, number])
    gl.colorMask(...Array.from(value(gl.COLOR_WRITEMASK)) as [boolean, boolean, boolean, boolean]); gl.depthMask(value(gl.DEPTH_WRITEMASK)); gl.depthFunc(value(gl.DEPTH_FUNC)); gl.cullFace(value(gl.CULL_FACE_MODE))
    gl.blendFuncSeparate(value(gl.BLEND_SRC_RGB), value(gl.BLEND_DST_RGB), value(gl.BLEND_SRC_ALPHA), value(gl.BLEND_DST_ALPHA)); gl.blendEquationSeparate(value(gl.BLEND_EQUATION_RGB), value(gl.BLEND_EQUATION_ALPHA))
    gl.clearColor(...Array.from(value(gl.COLOR_CLEAR_VALUE)) as [number, number, number, number]); gl.clearDepth(value(gl.DEPTH_CLEAR_VALUE))
    for (const [cap, enabled] of saved.enabled) enabled ? gl.enable(cap) : gl.disable(cap)
    gl.useProgram(value(gl.CURRENT_PROGRAM)); gl.bindVertexArray(value(gl.VERTEX_ARRAY_BINDING))
    for (const [unit, texture] of saved.textures) this.texture(unit, texture)
    gl.activeTexture(value(gl.ACTIVE_TEXTURE))
  }

  private releaseTargets() {
    if (!this.targets) return
    const gl = this.viewer.gl, targets = this.targets
    for (const texture of [targets.nearest, targets.opaque, ...targets.colors]) gl.deleteTexture(texture)
    for (const fbo of [targets.nearestFbo, targets.opaqueFbo, targets.colorFbo]) gl.deleteFramebuffer(fbo)
    this.targets = undefined
    this.checkedBlit = false
  }

  private release() {
    this.releaseTargets()
    const gl = this.viewer.gl
    for (const material of [this.depth, ...this.materials.values()]) if (material?.shader) {
      for (const shader of gl.getAttachedShaders(material.shader.program) ?? []) gl.deleteShader(shader)
      gl.deleteProgram(material.shader.program)
    }
    this.depth = undefined; this.materials.clear()
    if (this.resolve) {
      this.resolve.shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(this.resolve.program); gl.deleteVertexArray(this.resolve.vao)
      this.resolve = undefined
    }
  }

  dispose() { this.disabled = true; this.release() }
}
