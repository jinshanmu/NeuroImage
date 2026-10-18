/** Map a top-origin pointer to one exact framebuffer pixel and its center. */
export function depthSamplePixel(pointer: ArrayLike<number>, canvasHeight: number, viewport: ArrayLike<number>) {
  if (![pointer[0], pointer[1], canvasHeight, ...Array.from(viewport)].every(Number.isFinite) || viewport[2] <= 0 || viewport[3] <= 0) return null
  const x = Math.floor(pointer[0]), y = canvasHeight - 1 - Math.floor(pointer[1])
  const fx = (x + .5 - viewport[0]) / viewport[2], fy = (y + .5 - viewport[1]) / viewport[3]
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null
  return { x, y, fx, fy }
}

/** Alpha zero identifies our integer RGB surface/trajectory depth, not a volume. */
export function decodeSurfaceDepth(rgba: ArrayLike<number>): number | null {
  if (rgba[3] !== 0) return null
  return (rgba[0] * 65536 + rgba[1] * 256 + rgba[2]) / 16777215
}
