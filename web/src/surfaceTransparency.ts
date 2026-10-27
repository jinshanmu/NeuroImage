import type { Niivue, NVMesh } from '@niivue/niivue'

/** Keep opaque depth in place before compositing transparent source surfaces. */
export function orderedSurfaces(meshes: readonly NVMesh[], matrix: ArrayLike<number>, globalAlpha: number): NVMesh[] {
  if (!Number.isFinite(globalAlpha) || globalAlpha <= 0) return []
  const opaque: NVMesh[] = []
  const translucent: { mesh: NVMesh; depth: number }[] = []
  for (const mesh of meshes) {
    if (!mesh.visible || !Number.isFinite(mesh.opacity) || mesh.opacity <= 0 || (mesh.indexCount ?? 0) < 3) continue
    if (mesh.opacity * globalAlpha >= 1) { opaque.push(mesh); continue }
    const low = mesh.extentsMin, high = mesh.extentsMax
    const center = [0, 1, 2].map(axis => typeof low === 'number' || typeof high === 'number' ? 0 : (low[axis] + high[axis]) / 2)
    const z = matrix[2] * center[0] + matrix[6] * center[1] + matrix[10] * center[2] + matrix[14]
    const w = matrix[3] * center[0] + matrix[7] * center[1] + matrix[11] * center[2] + matrix[15]
    const depth = z / w
    translucent.push({ mesh, depth: Number.isFinite(depth) ? depth : 0 })
  }
  // NVMesh.id is a random UUID on every load; the supplied source name is
  // stable across reloads. Equal source names retain stable input order.
  translucent.sort((a, b) => {
    const depth = b.depth - a.depth
    const left = a.mesh.name ?? '', right = b.mesh.name ?? ''
    return depth || (left < right ? -1 : left > right ? 1 : 0)
  })
  return [...opaque, ...translucent.map(item => item.mesh)]
}

type SurfaceShader = NonNullable<Niivue['meshShaders'][number]['shader']>
type SurfaceViewer = Pick<Niivue, 'gl' | 'matCapTexture'>
export type TranslucentSurfaceDraw = (mesh: NVMesh, shader: SurfaceShader, alpha: number, plane?: ArrayLike<number>) => void

/** Share GL state and camera uniforms across an entire transparent surface pass. */
export function withTranslucentSurfacePass(
  viewer: SurfaceViewer, matrix: ArrayLike<number>, normalMatrix: ArrayLike<number>, depthTest: boolean,
  consume: (draw: TranslucentSurfaceDraw) => void, options: { twoPass?: boolean; frontOnly?: boolean; writeDepth?: boolean } = {},
): void {
  const gl = viewer.gl
  const saved = {
    program: gl.getParameter(gl.CURRENT_PROGRAM), vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING),
    depth: gl.isEnabled(gl.DEPTH_TEST), cull: gl.isEnabled(gl.CULL_FACE), blend: gl.isEnabled(gl.BLEND),
    mask: gl.getParameter(gl.DEPTH_WRITEMASK), depthFunc: gl.getParameter(gl.DEPTH_FUNC), cullMode: gl.getParameter(gl.CULL_FACE_MODE),
    srcRgb: gl.getParameter(gl.BLEND_SRC_RGB), dstRgb: gl.getParameter(gl.BLEND_DST_RGB),
    srcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA), dstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA),
    eqRgb: gl.getParameter(gl.BLEND_EQUATION_RGB), eqAlpha: gl.getParameter(gl.BLEND_EQUATION_ALPHA),
    activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE),
  }
  let matcapBinding: WebGLTexture | null = null, matcapTouched = false
  const mvp = matrix instanceof Float32Array ? matrix : Float32Array.from(matrix)
  const normal = normalMatrix instanceof Float32Array ? normalMatrix : Float32Array.from(normalMatrix)
  const materials = new Map<SurfaceShader, { alpha?: number; plane?: number[] }>()
  let currentProgram = saved.program
  try {
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(depthTest ? gl.LEQUAL : gl.ALWAYS); gl.depthMask(options.writeDepth ?? false)
    gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    if (options.frontOnly) { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK) }
    else if (options.twoPass) gl.enable(gl.CULL_FACE)
    else gl.disable(gl.CULL_FACE)
    consume((mesh, shader, alpha, plane) => {
      if (!mesh.visible || mesh.opacity <= 0 || !Number.isFinite(alpha) || alpha <= 0 || (mesh.indexCount ?? 0) < 3) return
      if (currentProgram !== shader.program) { shader.use(gl); currentProgram = shader.program }
      let material = materials.get(shader)
      if (!material) {
        material = {}; materials.set(shader, material)
        gl.uniformMatrix4fv(shader.uniforms.mvpMtx, false, mvp)
        gl.uniformMatrix4fv(shader.uniforms.normMtx, false, normal)
        if (shader.isMatcap) gl.uniform1i(shader.uniforms.matCap, 5)
      }
      if (material.alpha !== alpha) { gl.uniform1f(shader.uniforms.opacity, alpha); material.alpha = alpha }
      if (plane && (!material.plane || plane.length !== material.plane.length || material.plane.some((value, i) => value !== plane[i]))) {
        material.plane = Array.from(plane)
        gl.uniform4fv(shader.uniforms.neuroimageCutPlane, material.plane)
      }
      if (shader.isMatcap && !matcapTouched) {
        gl.activeTexture(gl.TEXTURE5)
        matcapBinding = gl.getParameter(gl.TEXTURE_BINDING_2D)
        matcapTouched = true
        gl.bindTexture(gl.TEXTURE_2D, viewer.matCapTexture)
      }
      gl.bindVertexArray(mesh.vao)
      if (options.twoPass) {
        gl.cullFace(gl.FRONT)
        gl.drawElements(gl.TRIANGLES, mesh.indexCount!, gl.UNSIGNED_INT, 0)
        gl.cullFace(gl.BACK)
      }
      gl.drawElements(gl.TRIANGLES, mesh.indexCount!, gl.UNSIGNED_INT, 0)
    })
  } finally {
    gl.useProgram(saved.program); gl.bindVertexArray(saved.vao)
    gl.depthMask(saved.mask); gl.depthFunc(saved.depthFunc); gl.cullFace(saved.cullMode)
    gl.blendFuncSeparate(saved.srcRgb, saved.dstRgb, saved.srcAlpha, saved.dstAlpha)
    gl.blendEquationSeparate(saved.eqRgb, saved.eqAlpha)
    for (const [flag, enabled] of [[gl.DEPTH_TEST, saved.depth], [gl.CULL_FACE, saved.cull], [gl.BLEND, saved.blend]] as const)
      enabled ? gl.enable(flag) : gl.disable(flag)
    if (matcapTouched) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, matcapBinding) }
    gl.activeTexture(saved.activeTexture)
  }
}

/** Isolated back/front rendering retained for callers that require two passes. */
export function drawTranslucentSurface(
  viewer: SurfaceViewer, mesh: NVMesh, shader: SurfaceShader,
  matrix: ArrayLike<number>, normalMatrix: ArrayLike<number>, alpha: number, depthTest: boolean,
): void {
  if (!mesh.visible || mesh.opacity <= 0 || !Number.isFinite(alpha) || alpha <= 0 || (mesh.indexCount ?? 0) < 3) return
  withTranslucentSurfacePass(viewer, matrix, normalMatrix, depthTest, draw => draw(mesh, shader, alpha), { twoPass: true })
}
