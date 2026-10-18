import type { Niivue } from '@niivue/niivue'
import { CutawayNiivue } from './cutawayRenderer'
import { PLANE_COLORS } from './sectionPlanes'
import type { SectionPlane } from './sectionPlanes'
import type { Vec3 } from './types'

/** Flat, explicitly schematic section guides in the renderer's physical RAS space. */
export class SectionNiivue extends CutawayNiivue {
  sectionGuides: { plane: SectionPlane; polygon: Vec3[] }[] = []
  private guideProgram: WebGLProgram | null = null
  private guideBuffer: WebGLBuffer | null = null
  private guideVao: WebGLVertexArrayObject | null = null
  private guideMatrix: WebGLUniformLocation | null = null
  private guideColor: WebGLUniformLocation | null = null

  override drawMesh3D(...args: Parameters<Niivue['drawMesh3D']>) {
    super.drawMesh3D(...args)
    const [depth = true, , matrix, , , is2D = false] = args
    // Picking reads this depth buffer. A guide must never become an anatomical hit.
    if (!depth || is2D || this.uiData.mouseDepthPicker || !matrix || !this.sectionGuides?.some(guide => guide.polygon.length)) return
    const gl = this.gl
    const saved = {
      program: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), buffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
      depth: gl.isEnabled(gl.DEPTH_TEST), cull: gl.isEnabled(gl.CULL_FACE), blend: gl.isEnabled(gl.BLEND),
      depthMask: gl.getParameter(gl.DEPTH_WRITEMASK), depthFunction: gl.getParameter(gl.DEPTH_FUNC),
      srcRgb: gl.getParameter(gl.BLEND_SRC_RGB), dstRgb: gl.getParameter(gl.BLEND_DST_RGB), srcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA), dstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA),
      equationRgb: gl.getParameter(gl.BLEND_EQUATION_RGB), equationAlpha: gl.getParameter(gl.BLEND_EQUATION_ALPHA),
    }
    try {
      if (!this.guideProgram) this.initializeGuides()
      gl.useProgram(this.guideProgram); gl.bindVertexArray(this.guideVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.guideBuffer)
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); gl.disable(gl.CULL_FACE)
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.uniformMatrix4fv(this.guideMatrix, false, matrix)
      for (const { plane, polygon } of this.sectionGuides) {
        if (polygon.length < 3) continue
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(polygon.flat()), gl.DYNAMIC_DRAW)
        const color = PLANE_COLORS[plane]
        gl.uniform4f(this.guideColor, ...color, .1)
        gl.drawArrays(gl.TRIANGLE_FAN, 0, polygon.length)
        gl.uniform4f(this.guideColor, ...color, .8)
        gl.drawArrays(gl.LINE_LOOP, 0, polygon.length)
      }
    } finally {
      gl.useProgram(saved.program); gl.bindVertexArray(saved.vao); gl.bindBuffer(gl.ARRAY_BUFFER, saved.buffer)
      gl.depthMask(saved.depthMask); gl.depthFunc(saved.depthFunction)
      for (const [flag, enabled] of [[gl.DEPTH_TEST, saved.depth], [gl.CULL_FACE, saved.cull], [gl.BLEND, saved.blend]] as const)
        enabled ? gl.enable(flag) : gl.disable(flag)
      gl.blendFuncSeparate(saved.srcRgb, saved.dstRgb, saved.srcAlpha, saved.dstAlpha)
      gl.blendEquationSeparate(saved.equationRgb, saved.equationAlpha)
    }
  }

  private initializeGuides() {
    const gl = this.gl, shaders: WebGLShader[] = []
    const program = gl.createProgram()
    if (!program) throw new Error('Could not allocate the section guide renderer.')
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, '#version 300 es\nlayout(location=0) in vec3 position;\nuniform mat4 matrix;\nvoid main(){gl_Position=matrix*vec4(position,1.0);}'],
        [gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;\nuniform vec4 color;\nout vec4 fragment;\nvoid main(){fragment=color;}'],
      ] as const) {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('Could not allocate a section guide shader.')
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Section guide shader: ${gl.getShaderInfoLog(shader)}`)
        gl.attachShader(program, shader)
      }
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Section guide renderer: ${gl.getProgramInfoLog(program)}`)
      this.guideProgram = program; this.guideBuffer = gl.createBuffer(); this.guideVao = gl.createVertexArray()
      if (!this.guideBuffer || !this.guideVao) throw new Error('Could not allocate the section guide geometry.')
      this.guideMatrix = gl.getUniformLocation(program, 'matrix'); this.guideColor = gl.getUniformLocation(program, 'color')
      gl.bindVertexArray(this.guideVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.guideBuffer)
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
    } catch (error) {
      gl.deleteProgram(program); this.guideProgram = null
      if (this.guideBuffer) gl.deleteBuffer(this.guideBuffer)
      if (this.guideVao) gl.deleteVertexArray(this.guideVao)
      this.guideBuffer = null; this.guideVao = null
      throw error
    } finally { shaders.forEach(shader => gl.deleteShader(shader)) }
  }

  override cleanup() {
    if (this.guideProgram) this.gl.deleteProgram(this.guideProgram)
    if (this.guideBuffer) this.gl.deleteBuffer(this.guideBuffer)
    if (this.guideVao) this.gl.deleteVertexArray(this.guideVao)
    this.guideProgram = null; this.guideBuffer = null; this.guideVao = null
    super.cleanup()
  }
}
