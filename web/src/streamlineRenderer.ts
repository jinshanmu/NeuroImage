import type { Niivue } from '@niivue/niivue'
import { SectionNiivue } from './sectionRenderer'

/** Preserve per-bundle visibility/opacity and the physical slice clip matrices. */
export class StreamlineNiivue extends SectionNiivue {
  streamlineSectionOpacity = 1
  override drawMesh3D(...args: Parameters<Niivue['drawMesh3D']>) {
    const fibers = this.meshes.filter(mesh => mesh.offsetPt0)
    if (!fibers.length) { super.drawMesh3D(...args); return }
    const [depth = true, alpha = 1, matrix, , normalMatrix, is2D = false] = args
    const original = this.meshes
    try {
      // The pinned renderer's fiber pass ignores per-bundle visibility/opacity.
      // Draw these line VAOs explicitly and leave other geometry to its renderer.
      this.meshes = original.filter(mesh => !mesh.offsetPt0)
      if (matrix && this.fiberShader) {
        const gl = this.gl
        const saved = { program: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING),
          depth: gl.isEnabled(gl.DEPTH_TEST), blend: gl.isEnabled(gl.BLEND), mask: gl.getParameter(gl.DEPTH_WRITEMASK),
          function: gl.getParameter(gl.DEPTH_FUNC), src: gl.getParameter(gl.BLEND_SRC_RGB), dst: gl.getParameter(gl.BLEND_DST_RGB),
          srcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA), dstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA) }
        try {
          const shader = this.uiData.mouseDepthPicker ? this.pickingMeshShader! : this.fiberShader
          shader.use(gl); gl.uniformMatrix4fv(shader.uniforms.mvpMtx, false, matrix)
          if (this.uiData.mouseDepthPicker && normalMatrix) gl.uniformMatrix4fv(shader.uniforms.normMtx, false, normalMatrix)
          gl.enable(gl.DEPTH_TEST); gl.depthFunc(depth ? gl.LEQUAL : gl.ALWAYS)
          for (const mesh of fibers) {
            const opacity = alpha * (is2D ? this.streamlineSectionOpacity : mesh.opacity)
            if (!mesh.visible || opacity <= 0 || !mesh.indexCount) continue
            gl.uniform1f(shader.uniforms.opacity, this.uiData.mouseDepthPicker ? 1 : opacity)
            if (opacity < 1 && !this.uiData.mouseDepthPicker) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false) }
            else { gl.disable(gl.BLEND); gl.depthMask(true) }
            gl.bindVertexArray(mesh.vaoFiber); gl.drawElements(gl.LINE_STRIP, mesh.indexCount, gl.UNSIGNED_INT, 0)
          }
        } finally {
          gl.useProgram(saved.program); gl.bindVertexArray(saved.vao); gl.depthMask(saved.mask); gl.depthFunc(saved.function)
          saved.depth ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST)
          saved.blend ? gl.enable(gl.BLEND) : gl.disable(gl.BLEND)
          gl.blendFuncSeparate(saved.src, saved.dst, saved.srcAlpha, saved.dstAlpha)
        }
      }
      super.drawMesh3D(...args)
    } finally { this.meshes = original }
  }
}
