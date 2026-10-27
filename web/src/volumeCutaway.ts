import type { SurfaceCutaway, Vec3 } from './types'

/** Convert the RAS half-space to NiiVue's centered texture-space clip format.
 * Volume clipping keeps positive values; surface clipping discards them.
 * Fraction-to-RAS includes the source affine, voxel sizes and half-voxel offset.
 */
export function volumeCutawayPlane(cut: SurfaceCutaway, fracToRAS: (fraction: Vec3) => ArrayLike<number>): [number, number, number] {
  const origin = fracToRAS([0, 0, 0])[cut.axis]
  const basis = [0, 1, 2].map(axis => {
    const fraction: Vec3 = [0, 0, 0]
    fraction[axis] = 1
    return fracToRAS(fraction)[cut.axis] - origin
  })
  const magnitude = Math.hypot(...basis)
  if (!Number.isFinite(origin) || !Number.isFinite(magnitude) || magnitude <= Number.EPSILON) throw new Error('The volume cutaway requires a finite source coordinate transform.')
  const normal = basis.map(value => -cut.side * value / magnitude)
  const center = origin + basis.reduce((sum, value) => sum + value, 0) / 2
  const depth = -cut.side * (center - cut.position_mm) / magnitude
  // The pinned volume renderer encodes n as sph2cartDeg(azimuth + 180, elevation).
  const degrees = 180 / Math.PI
  const azimuth = Math.hypot(normal[0], normal[1]) < 1e-12 ? 0 : Math.atan2(-normal[0], normal[1]) * degrees
  const elevation = -Math.asin(Math.max(-1, Math.min(1, normal[2]))) * degrees
  return [depth, azimuth, elevation]
}
