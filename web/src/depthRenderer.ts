import type { Niivue } from '@niivue/niivue'
import { StreamlineNiivue } from './streamlineRenderer'

const depthFragment = `#version 300 es
precision highp int;
precision highp float;
uniform float opacity;
out vec4 color;
vec4 packFloatToVec4i(float depth) {
  uint value = uint(round(clamp(depth, 0.0, 1.0) * 16777215.0));
  return vec4(float((value >> 16u) & 255u), float((value >> 8u) & 255u), float(value & 255u), 0.0) / 255.0;
}
void main() { color = packFloatToVec4i(gl_FragCoord.z); }
`

/** Integer RGB depth survives the default framebuffer's 8-bit UNORM storage. */
export class SourceDepthNiivue extends StreamlineNiivue {
  private sourceDepthShader: ReturnType<Niivue['createCustomMeshShader']> | null = null

  override drawMesh3D(...args: Parameters<Niivue['drawMesh3D']>) {
    if (!this.uiData.mouseDepthPicker) { super.drawMesh3D(...args); return }
    const original = this.pickingMeshShader, dither = this.gl.isEnabled(this.gl.DITHER)
    try {
      this.sourceDepthShader ??= this.createCustomMeshShader(depthFragment, 'NeuroImage source depth')
      this.pickingMeshShader = this.sourceDepthShader.shader
      this.gl.disable(this.gl.DITHER)
      super.drawMesh3D(...args)
    } finally { this.pickingMeshShader = original; if (dither) this.gl.enable(this.gl.DITHER) }
  }

  override cleanup() {
    if (this.sourceDepthShader?.shader) {
      const program = this.sourceDepthShader.shader.program
      for (const shader of this.gl.getAttachedShaders(program) ?? []) this.gl.deleteShader(shader)
      this.gl.deleteProgram(program)
    }
    this.sourceDepthShader = null
    super.cleanup()
  }
}
