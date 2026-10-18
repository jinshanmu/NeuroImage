import type { Niivue } from '@niivue/niivue'
import { TeachingNiivue } from './markers'
import { cutawayPlane } from './cutaway'
import type { SurfaceCutaway } from './types'

type MeshShader = ReturnType<Niivue['createCustomMeshShader']>

/** Clip source surface fragments in native RAS millimeters, without new geometry. */
export class CutawayNiivue extends TeachingNiivue {
  surfaceCutaway: SurfaceCutaway | undefined
  cutawayMeshIds = new Set<number | string>()
  private cutawayShaders = new Map<string, MeshShader>()

  private clippedShader(fragment: string): MeshShader {
    const cached = this.cutawayShaders.get(fragment)
    if (cached) return cached
    const main = /void\s+main\s*\([^)]*\)\s*\{/
    if (!main.test(fragment)) throw new Error('The pinned surface shader has no recognized entry point.')
    // NiiVue's mesh vertex shader supplies vP directly from the original RAS
    // vertex. Retain its lighting and depth encoding for rendering and picking.
    const declaration = (/(?:in|varying)\s+vec4\s+vP\s*;/.test(fragment) ? '' : 'in vec4 vP;\n') + 'uniform vec4 neuroimageCutPlane;\n'
    const source = fragment.replace(main, match => declaration + match + '\nif (dot(vec4(vP.xyz, 1.0), neuroimageCutPlane) > 0.0) discard;\n')
    const shader = this.createCustomMeshShader(source, `NeuroImage source cutaway ${this.cutawayShaders.size}`)
    this.cutawayShaders.set(fragment, shader)
    return shader
  }

  override drawMesh3D(...args: Parameters<Niivue['drawMesh3D']>) {
    if (!this.uiData.mouseDepthPicker) { this.drawSurfacePass(...args); return }
    const opacities = new Map(this.meshes.map(mesh => [mesh, mesh.opacity]))
    try {
      // Packed depth is data. Alpha blending would corrupt it for translucent
      // context surfaces; zero-opacity objects must remain unpickable.
      for (const mesh of this.meshes) if (mesh.opacity > 0) mesh.opacity = 1
      args[1] = 1
      this.drawSurfacePass(...args)
    } finally { for (const [mesh, opacity] of opacities) mesh.opacity = opacity }
  }

  private drawSurfacePass(...args: Parameters<Niivue['drawMesh3D']>) {
    if (!this.surfaceCutaway || args[5] || !this.cutawayMeshIds.size) { super.drawMesh3D(...args); return }
    const original = this.meshes, shaders = this.meshShaders, picking = this.pickingMeshShader
    const plane = cutawayPlane(this.surfaceCutaway)
    try {
      // Preserve original draw order, opacity and source buffers. The same
      // predicate applies to depth picking, so hidden fragments cannot be hit.
      for (const mesh of original) {
        this.meshes = [mesh]; this.meshShaders = shaders; this.pickingMeshShader = picking
        if (!mesh.offsetPt0 && this.cutawayMeshIds.has(mesh.id)) {
          const definition = shaders[mesh.meshShaderIndex]
          if (!definition) throw new Error('The source surface shader is unavailable.')
          const clipped = this.clippedShader(definition.Frag)
          clipped.shader!.isCrosscut = definition.shader?.isCrosscut
          clipped.shader!.isMatcap = definition.shader?.isMatcap
          this.meshShaders = [...shaders]; this.meshShaders[mesh.meshShaderIndex] = clipped
          const programs = [clipped.shader!]
          if (this.uiData.mouseDepthPicker && picking) {
            const fragment = this.gl.getAttachedShaders(picking.program)?.find(shader => this.gl.getShaderParameter(shader, this.gl.SHADER_TYPE) === this.gl.FRAGMENT_SHADER)
            const source = fragment && this.gl.getShaderSource(fragment)
            if (!source) throw new Error('The source depth-picking shader is unavailable.')
            this.pickingMeshShader = this.clippedShader(source).shader
            programs.push(this.pickingMeshShader!)
          }
          for (const program of programs) { program.use(this.gl); this.gl.uniform4fv(program.uniforms.neuroimageCutPlane, plane) }
        }
        super.drawMesh3D(...args)
      }
    } finally { this.meshes = original; this.meshShaders = shaders; this.pickingMeshShader = picking }
  }

  override cleanup() {
    for (const entry of this.cutawayShaders.values()) if (entry.shader) {
      for (const shader of this.gl.getAttachedShaders(entry.shader.program) ?? []) this.gl.deleteShader(shader)
      this.gl.deleteProgram(entry.shader.program)
    }
    this.cutawayShaders.clear()
    super.cleanup()
  }
}
