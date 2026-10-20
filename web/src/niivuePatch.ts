/** Route the pinned renderer's inline gradient work through its existing hook. */
export function patchGradientHook(source: string) {
  const pattern = /(this\.volumeTexture = outTexture;\s*)this\.gradientTexture = gradientGL\(\{[\s\S]*?rgbaTex: this\.rgbaTex\.bind\(this\)\s*\}\);/g
  if ([...source.matchAll(pattern)].length !== 1) throw Error('NiiVue gradient hook changed; review the pinned renderer integration.')
  return source.replace(pattern, '$1this.gradientGL(hdr);')
}
