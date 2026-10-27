import type { Niivue, NVMesh } from '@niivue/niivue'
import { TeachingNiivue } from './markers'
import { cutawayPlane } from './cutaway'
import type { SurfaceCutaway } from './types'
import { orderedSurfaces, withTranslucentSurfacePass, type TranslucentSurfaceDraw } from './surfaceTransparency'
import { SurfaceOIT, type SurfaceOITCommand } from './surfaceOIT'

type MeshShader = ReturnType<Niivue['createCustomMeshShader']>

/** Clip source surface fragments in native RAS millimeters, without new geometry. */
export class CutawayNiivue extends TeachingNiivue {
  surfaceCutaway: SurfaceCutaway | undefined
  cutawayMeshIds = new Set<number | string>()
  private cutawayShaders = new Map<string, MeshShader>()
  private translucentShaders = new Map<string, MeshShader>()
  private surfaceOIT: SurfaceOIT | null = null

  private translucentShader(fragment: string): MeshShader {
    const cached = this.translucentShaders.get(fragment)
    if (cached) return cached
    // Back-facing triangles belong to the same original surface. Light their
    // visible side, rather than leaving the rear of a translucent shell dark.
    const source = fragment.replace(/\bnormalize\s*\(\s*vN\s*\)/g, 'normalize(gl_FrontFacing ? vN : -vN)')
    const shader = this.createCustomMeshShader(source, `NeuroImage translucent surface ${this.translucentShaders.size}`)
    this.translucentShaders.set(fragment, shader)
    return shader
  }

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
    const [depth = true, alpha = 1, matrix, , normalMatrix, is2D = false] = args
    const clipped = !!this.surfaceCutaway && !is2D && this.cutawayMeshIds.size > 0
    const translucent = !this.uiData.mouseDepthPicker && !is2D && !!matrix && !!normalMatrix && this.opts.meshXRay === 0 &&
      this.meshes.every(mesh => !mesh.visible || mesh.opacity <= 0 || (!mesh.offsetPt0 && !!this.meshShaders[mesh.meshShaderIndex]?.shader && !this.meshShaders[mesh.meshShaderIndex].shader!.isCrosscut)) &&
      this.meshes.some(mesh => mesh.visible && mesh.opacity * alpha > 0 && mesh.opacity * alpha < 1)
    if (!clipped && !translucent) { super.drawMesh3D(...args); return }
    const original = this.meshes, shaders = this.meshShaders, picking = this.pickingMeshShader
    const plane = clipped ? cutawayPlane(this.surfaceCutaway!) : null
    try {
      const drawMesh = (mesh: NVMesh, collectTransparent?: (command: SurfaceOITCommand) => void) => {
        this.meshes = [mesh]; this.meshShaders = shaders; this.pickingMeshShader = picking
        let definition = shaders[mesh.meshShaderIndex]
        if (clipped && !collectTransparent && !mesh.offsetPt0 && this.cutawayMeshIds.has(mesh.id)) {
          if (!definition) throw new Error('The source surface shader is unavailable.')
          const cut = this.clippedShader(definition.Frag)
          cut.shader!.isCrosscut = definition.shader?.isCrosscut
          cut.shader!.isMatcap = definition.shader?.isMatcap
          this.meshShaders = [...shaders]; this.meshShaders[mesh.meshShaderIndex] = cut
          definition = cut
          const programs = [cut.shader!]
          if (this.uiData.mouseDepthPicker && picking) {
            const fragment = this.gl.getAttachedShaders(picking.program)?.find(shader => this.gl.getShaderParameter(shader, this.gl.SHADER_TYPE) === this.gl.FRAGMENT_SHADER)
            const source = fragment && this.gl.getShaderSource(fragment)
            if (!source) throw new Error('The source depth-picking shader is unavailable.')
            this.pickingMeshShader = this.clippedShader(source).shader
            programs.push(this.pickingMeshShader!)
          }
          for (const program of programs) {
            program.use(this.gl); this.gl.uniform4fv(program.uniforms.neuroimageCutPlane, plane!)
            if (program.isMatcap) this.gl.uniform1i(program.uniforms.matCap, 5)
          }
        }
        if (collectTransparent && definition?.shader) {
          collectTransparent({ mesh, fragment: definition.Frag, alpha: mesh.opacity * alpha,
            plane: plane && this.cutawayMeshIds.has(mesh.id) ? plane : undefined, isMatcap: definition.shader.isMatcap })
        } else super.drawMesh3D(...args)
      }
      if (translucent) {
        // Keep driver queries and state restoration outside the per-mesh loop.
        // Establish opaque depth before compositing the transparent scene.
        const ordered = orderedSurfaces(original, matrix!, alpha)
        const split = ordered.findIndex(mesh => mesh.opacity * alpha < 1)
        const firstTransparent = split < 0 ? ordered.length : split
        for (const mesh of ordered.slice(0, firstTransparent)) drawMesh(mesh)
        if (firstTransparent < ordered.length) {
          const commands: SurfaceOITCommand[] = []
          for (let index = firstTransparent; index < ordered.length; index++) {
            drawMesh(ordered[index], command => { commands.push(command) })
          }
          this.surfaceOIT ??= new SurfaceOIT(this)
          if (!depth || !this.surfaceOIT.draw(commands, matrix!, normalMatrix!)) {
            // Older GPUs retain nearest front-facing depth instead of allowing
            // arbitrary far/back triangles to overwrite the visible surface.
            const fallback: Parameters<TranslucentSurfaceDraw>[] = commands.map(command => {
              const definition = command.plane ? this.clippedShader(command.fragment) : { Frag: command.fragment }
              const material = this.translucentShader(definition.Frag).shader!
              material.isMatcap = command.isMatcap
              return [command.mesh, material, command.alpha, command.plane]
            })
            withTranslucentSurfacePass(this, matrix!, normalMatrix!, depth, draw => {
              for (const command of fallback) draw(...command)
            }, { frontOnly: true, writeDepth: true })
          }
        }
      } else for (const mesh of original) drawMesh(mesh)
    } finally { this.meshes = original; this.meshShaders = shaders; this.pickingMeshShader = picking }
  }

  override cleanup() {
    this.surfaceOIT?.dispose()
    this.surfaceOIT = null
    for (const entry of [...this.cutawayShaders.values(), ...this.translucentShaders.values()]) if (entry.shader) {
      for (const shader of this.gl.getAttachedShaders(entry.shader.program) ?? []) this.gl.deleteShader(shader)
      this.gl.deleteProgram(entry.shader.program)
    }
    this.cutawayShaders.clear()
    this.translucentShaders.clear()
    super.cleanup()
  }
}
