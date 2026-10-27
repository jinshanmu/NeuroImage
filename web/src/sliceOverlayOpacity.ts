/** Keep source textures at unit opacity; scale only their final slice alpha. */
export function sliceOverlayOpacityShader(fragment: string): string {
  const composition = /float\s+a\s*=\s*color\.a\s*\+\s*ocolor\.a\s*\*\s*\(1\.0\s*-\s*color\.a\)\s*;/g
  if ([...fragment.matchAll(composition)].length !== 1 || !/void\s+main\s*\(/.test(fragment)) {
    throw new Error('The pinned slice shader has no recognized overlay composition.')
  }
  return fragment
    .replace(/void\s+main\s*\(/, 'uniform float neuroimageOverlayOpacity;\nvoid main(')
    .replace(composition, match => `ocolor.a *= neuroimageOverlayOpacity;\n\t${match}`)
}
