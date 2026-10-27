/** Native multiplanar rendering centers a square 3D viewport within its panel.
 * Include the surrounding blank space in both projection and pointer picking. */
export function full3DPanel(rect: number[], sections: number[][], region: number[]): number[] {
  if (sections.length !== 3 || rect.length < 4 || region.length < 4) return rect
  const distinct = (axis: number) => new Set(sections.map(section => Math.round(section[axis]))).size
  const [x, y, width, height] = region
  const right = x + width, bottom = y + height
  const panel = distinct(0) === 3 ? [rect[0], y, right - rect[0], height]
    : distinct(1) === 3 ? [x, rect[1], width, bottom - rect[1]]
      : [rect[0], rect[1], right - rect[0], bottom - rect[1]]
  return panel.every(Number.isFinite) && panel[2] > 0 && panel[3] > 0 ? panel : rect
}
