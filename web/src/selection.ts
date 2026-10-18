import type { SelectionEvidence, Vec3 } from './types'

export function resolveSurfaceSelection(position: Vec3, surfaces: Iterable<[string, { visible: boolean; opacity?: number; pts: ArrayLike<number> }]>, voxelSelected: string | null, tolerance: number, preferred: string | null, included?: (id: string, point: ArrayLike<number>) => boolean) {
  const ranked: { id: string; distance: number }[] = []
  for (const [id, mesh] of surfaces) if (mesh.visible && mesh.opacity !== 0) {
    let squared = Infinity
    for (let i = 0; i < mesh.pts.length; i += 3) {
      if (included && !included(id, [mesh.pts[i], mesh.pts[i + 1], mesh.pts[i + 2]])) continue
      const d = (mesh.pts[i] - position[0]) ** 2 + (mesh.pts[i + 1] - position[1]) ** 2 + (mesh.pts[i + 2] - position[2]) ** 2
      if (d < squared) squared = d
    }
    if (squared <= tolerance ** 2) ranked.push({ id, distance: Math.sqrt(squared) })
  }
  ranked.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
  const fallback = voxelSelected && (!included || included(voxelSelected, position)) ? voxelSelected : null
  if (!ranked.length) return { selected: fallback, selectionEvidence: { kind: 'label-voxel', candidates: fallback ? [fallback] : [] } as SelectionEvidence }
  // Adjacent categorical isosurfaces can coincide. Do not pretend proximity
  // uniquely identifies a boundary shared by multiple currently visible labels.
  const candidates = ranked.filter(s => s.distance <= ranked[0].distance + tolerance * .05).map(s => s.id)
  return { selected: preferred && candidates.includes(preferred) ? preferred : candidates[0],
    selectionEvidence: { kind: 'visible-surface', candidates } as SelectionEvidence }
}
