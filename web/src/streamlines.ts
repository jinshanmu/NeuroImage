import type { SelectionEvidence, StreamlineLevel, StreamlineLevelId, StreamlineStructure, Vec3 } from './types'

export interface Trajectories { pts: Float32Array; offsetPt0: Uint32Array }
export interface VisibleTrajectories extends Trajectories { visible: boolean; opacity?: number }

export function displayLevel(structure: StreamlineStructure, level: StreamlineLevelId = 'standard'): StreamlineLevel {
  const found = structure.streamlines.levels.find(value => value.id === level)
  if (!found) throw new Error('The requested source streamline display level is unavailable.')
  return found
}

/** Decode only the package's checked, standard little-endian RAS-mm encoding. */
export function parseTck(buffer: ArrayBuffer, expected: Pick<StreamlineLevel, 'point_count' | 'streamline_count'>): Trajectories {
  if (buffer.byteLength < 1072 || (buffer.byteLength - 1024) % 12) throw new Error('Truncated streamline coordinates.')
  const header = new TextDecoder().decode(new Uint8Array(buffer, 0, 1024)).split('END\n')[0]
  if (!header.startsWith('mrtrix tracks\n') || !header.includes('datatype: Float32LE\n') || !header.includes('file: . 1024\n') ||
      Number(header.match(/count: (\d+)\n/)?.[1]) !== expected.streamline_count) throw new Error('Streamline header differs from the package contract.')
  if (buffer.byteLength !== 1024 + 12 * (expected.point_count + expected.streamline_count + 1)) throw new Error('Streamline byte count differs from the manifest.')
  const reader = new DataView(buffer), pts = new Float32Array(expected.point_count * 3), offsets = new Uint32Array(expected.streamline_count + 1)
  let point = 0, count = 0
  for (let pos = 1024; pos < buffer.byteLength; pos += 12) {
    const x = reader.getFloat32(pos, true), y = reader.getFloat32(pos + 4, true), z = reader.getFloat32(pos + 8, true)
    if (pos === buffer.byteLength - 12) {
      if (x !== Infinity || y !== Infinity || z !== Infinity || count !== expected.streamline_count || point !== expected.point_count || offsets[count] !== point)
        throw new Error('Invalid streamline termination or count.')
    } else if (Number.isNaN(x) && Number.isNaN(y) && Number.isNaN(z)) {
      if (count >= expected.streamline_count || point - offsets[count] < 2) throw new Error('Invalid streamline boundary.')
      offsets[++count] = point
    } else {
      if (![x, y, z].every(Number.isFinite) || point >= expected.point_count) throw new Error('Invalid streamline point.')
      pts[point * 3] = x; pts[point * 3 + 1] = y; pts[point * 3 + 2] = z; point++
    }
  }
  return { pts, offsetPt0: offsets }
}

/** Clip a segment to a physical RAS slab, preserving source geometry. */
export function clipSegment(a: Vec3, b: Vec3, axis: number, position: number, width: number): [Vec3, Vec3] | null {
  const delta = b[axis] - a[axis], low = position - width / 2, high = position + width / 2
  if (delta === 0) return a[axis] >= low && a[axis] <= high ? [a, b] : null
  const t0 = (low - a[axis]) / delta, t1 = (high - a[axis]) / delta
  const start = Math.max(0, Math.min(t0, t1)), end = Math.min(1, Math.max(t0, t1))
  if (end < start) return null
  return [a.map((v, i) => v + start * (b[i] - v)) as Vec3, a.map((v, i) => v + end * (b[i] - v)) as Vec3]
}

export function segmentDistance(position: Vec3, a: Vec3, b: Vec3, excludedAxis = -1) {
  let numerator = 0, denominator = 0
  for (let axis = 0; axis < 3; axis++) if (axis !== excludedAxis) {
    numerator += (position[axis] - a[axis]) * (b[axis] - a[axis]); denominator += (b[axis] - a[axis]) ** 2
  }
  const t = denominator ? Math.max(0, Math.min(1, numerator / denominator)) : 0
  return Math.sqrt(a.reduce((sum, value, axis) => axis === excludedAxis ? sum : sum + (position[axis] - value - t * (b[axis] - value)) ** 2, 0))
}

export function resolveStreamlineSelection(position: Vec3, bundles: Iterable<[string, VisibleTrajectories]>, preferred: string | null,
  tolerance = 1, sectionAxis = -1, slabWidth = 1) {
  const ranked: { id: string; distance: number }[] = []
  for (const [id, mesh] of bundles) {
    if (!mesh.visible || (sectionAxis < 0 && mesh.opacity === 0)) continue
    let distance = Infinity
    for (let line = 0; line < mesh.offsetPt0.length - 1; line++) {
      for (let index = mesh.offsetPt0[line]; index < mesh.offsetPt0[line + 1] - 1; index++) {
        let nearby = true
        for (let axis = 0; axis < 3; axis++) {
          const x = mesh.pts[index * 3 + axis], y = mesh.pts[index * 3 + 3 + axis], margin = axis === sectionAxis ? slabWidth / 2 : tolerance
          if (position[axis] < Math.min(x, y) - margin || position[axis] > Math.max(x, y) + margin) { nearby = false; break }
        }
        if (!nearby) continue
        const a = Array.from(mesh.pts.subarray(index * 3, index * 3 + 3)) as Vec3
        const b = Array.from(mesh.pts.subarray(index * 3 + 3, index * 3 + 6)) as Vec3
        const segment = sectionAxis < 0 ? [a, b] : clipSegment(a, b, sectionAxis, position[sectionAxis], slabWidth)
        if (!segment) continue
        distance = Math.min(distance, segmentDistance(position, segment[0], segment[1], sectionAxis))
      }
    }
    if (distance <= tolerance) ranked.push({ id, distance })
  }
  ranked.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
  const candidates = ranked.map(value => value.id)
  return { selected: preferred && candidates.includes(preferred) ? preferred : candidates[0] ?? null,
    selectionEvidence: { kind: 'visible-streamline', candidates, ...(sectionAxis >= 0 ? { sectionAxis } : {}) } as SelectionEvidence }
}
