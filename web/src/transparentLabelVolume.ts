import type { Niivue } from '@niivue/niivue'

type VolumeShader = NonNullable<Niivue['renderShader']>
type ShaderConstructor = new (gl: WebGL2RenderingContext, vertex: string, fragment: string) => VolumeShader

export const LABEL_ID_TEXTURE_UNIT = 14

/** Retain the pinned renderer's physical ray/clip math, replacing its opaque first-hit accumulation. */
export function transparentLabelFragment(source: string): string {
  const main = /void\s+main\s*\(\s*(?:void)?\s*\)\s*\{/.exec(source)
  if (!main || !['vec3 GetBackPosition', 'void clipSampleRange', 'bool skipSample', 'float frac2ndc', 'uniform bool isClipCutaway'].every(token => source.slice(0, main.index).includes(token))) {
    throw new Error('The pinned categorical volume shader has no recognized ray/clip helpers.')
  }
  return source.slice(0, main.index) + `
uniform highp sampler3D neuroimageLabelIds;
void main() {
  fColor = vec4(0.0);
  gl_FragDepth = 1.0;
  vec3 start = vColor;
  vec3 finish = GetBackPosition(start);
  float rayLength = length(finish - start);
  float voxelLength = length(texVox * (finish - start));
  if (rayLength <= 0.0 || rayLength > 3.0 || voxelLength < 0.5 || backOpacity <= 0.0) return;
  vec3 direction = (finish - start) / rayLength;
  float stepLength = rayLength / voxelLength * 0.5;
  vec2 sampleRange = vec2(0.0, rayLength);
  bool hasClip = false;
  for (int plane = 0; plane < MAX_CLIP_PLANES; plane++) {
    clipSampleRange(direction, vec4(start, 0.0), clipPlanes[plane], sampleRange, hasClip);
  }
  if (hasClip && !isClipCutaway && sampleRange.y <= sampleRange.x) return;
  float sampleDistance = hasClip && !isClipCutaway ? max(0.0, sampleRange.x) : 0.0;
  float sampleEnd = hasClip && !isClipCutaway ? min(rayLength, sampleRange.y) : rayLength;
  vec4 accumulated = vec4(0.0);
  int previousLabel = 0;
  bool firstHit = true;
  // A half-voxel step resolves thin parcels without making a thick parcel
  // repeatedly opaque. Only entry into a new contiguous label adds a layer.
  for (int stepIndex = 0; stepIndex < 8192; stepIndex++) {
    if (sampleDistance > sampleEnd) break;
    vec3 position = start + direction * sampleDistance;
    bool retained = !hasClip || (skipSample(sampleDistance, sampleRange) == isClipCutaway);
    if (retained) {
      vec4 sampleColor = texture(volume, position);
      int label = 0;
      if (sampleColor.a > 0.0) {
        ivec3 idBytes = ivec3(round(texture(neuroimageLabelIds, position).rgb * 255.0));
        label = idBytes.r + 256 * idBytes.g + 65536 * idBytes.b;
      }
      if (label != 0 && label != previousLabel) {
        float alpha = clamp(backOpacity * sampleColor.a, 0.0, 1.0);
        if (alpha > 0.0) {
          if (firstHit) { gl_FragDepth = frac2ndc(position); firstHit = false; }
          float contribution = (1.0 - accumulated.a) * alpha;
          accumulated.rgb += sampleColor.rgb * contribution;
          accumulated.a += contribution;
          if (accumulated.a >= 0.995) break;
        }
      }
      previousLabel = label;
    } else {
      previousLabel = 0;
    }
    sampleDistance += stepLength;
  }
  if (accumulated.a > 0.0) {
    // Native drawing uses SRC_ALPHA blending, so output straight color.
    fColor = vec4(accumulated.rgb / accumulated.a, accumulated.a);
  }
}
`
}

/** Front-to-back reference for categorical ray segments, including cut-entry interiors. */
export function compositeLabelSegments(samples: { id: number; color: readonly number[]; alpha?: number }[], opacity: number): [number, number, number, number] {
  const result: [number, number, number, number] = [0, 0, 0, 0]
  let previous = 0
  for (const sample of samples) {
    if (sample.id && sample.id !== previous) {
      const alpha = Math.max(0, Math.min(1, opacity * (sample.alpha ?? 1)))
      const contribution = (1 - result[3]) * alpha
      for (let channel = 0; channel < 3; channel++) result[channel] += sample.color[channel] * contribution
      result[3] += contribution
      if (result[3] >= .995) break
    }
    previous = sample.id
  }
  return result
}

/** Own a transparent categorical program; opaque anatomy and picking remain native. */
export class TransparentLabelVolume {
  private shader: VolumeShader | null = null
  private nativeProgram: WebGLProgram | null = null

  private get(viewer: Niivue, native: VolumeShader): VolumeShader {
    if (this.shader && this.nativeProgram === native.program) return this.shader
    const gl = viewer.gl
    const attached = gl.getAttachedShaders(native.program) ?? []
    const source = (type: number) => {
      const shader = attached.find(item => gl.getShaderParameter(item, gl.SHADER_TYPE) === type)
      const text = shader && gl.getShaderSource(shader)
      if (!text) throw new Error('The native categorical volume shader source is unavailable.')
      return text
    }
    const vertex = source(gl.VERTEX_SHADER), fragment = transparentLabelFragment(source(gl.FRAGMENT_SHADER))
    const program = gl.getParameter(gl.CURRENT_PROGRAM)
    let next: VolumeShader | null = null
    try {
      const Constructor = native.constructor as ShaderConstructor
      next = new Constructor(gl, vertex, fragment)
      // Native Shader's declaration parser does not split comma declarations or
      // expand arrays; initialize those uniforms explicitly as the native init does.
      next.uniforms.volume = gl.getUniformLocation(next.program, 'volume')
      next.uniforms.clipPlanes = gl.getUniformLocation(next.program, 'clipPlanes[0]')
      viewer.initRenderShader(next, 0)
    } catch (error) {
      if (next) this.release(gl, next)
      throw error
    } finally { gl.useProgram(program) }
    if (this.shader) this.release(gl, this.shader)
    this.shader = next
    this.nativeProgram = native.program
    return next
  }

  draw<T>(viewer: Niivue, ids: WebGLTexture, opacity: number, draw: () => T): T {
    const native = viewer.renderShader
    if (!native || viewer.uiData.mouseDepthPicker || !(opacity > 0 && opacity < 1)) return draw()
    const gl = viewer.gl, active = gl.getParameter(gl.ACTIVE_TEXTURE), program = gl.getParameter(gl.CURRENT_PROGRAM)
    const shader = this.get(viewer, native)
    const unit = gl.TEXTURE0 + LABEL_ID_TEXTURE_UNIT
    gl.activeTexture(unit)
    const binding = gl.getParameter(gl.TEXTURE_BINDING_3D)
    try {
      gl.bindTexture(gl.TEXTURE_3D, ids)
      viewer.renderShader = shader
      shader.use(gl)
      gl.uniform1i(shader.uniforms.neuroimageLabelIds, LABEL_ID_TEXTURE_UNIT)
      gl.uniform1f(shader.uniforms.backOpacity, opacity)
      gl.uniform3fv(shader.uniforms.texVox, viewer.vox)
      gl.uniform3fv(shader.uniforms.volScale, viewer.volScale)
      return draw()
    } finally {
      viewer.renderShader = native
      gl.activeTexture(unit); gl.bindTexture(gl.TEXTURE_3D, binding); gl.activeTexture(active)
      gl.useProgram(program)
    }
  }

  private release(gl: WebGL2RenderingContext, shader: VolumeShader): void {
    for (const attached of gl.getAttachedShaders(shader.program) ?? []) gl.deleteShader(attached)
    gl.deleteProgram(shader.program)
  }

  dispose(viewer: Niivue): void {
    if (this.shader) this.release(viewer.gl, this.shader)
    this.shader = null; this.nativeProgram = null
  }
}
