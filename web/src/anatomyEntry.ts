import type { AnatomyScope } from './anatomyNavigation'
import type { Manifest, ViewState, Vec3 } from './types'

// A named regional entry is valid only for its declared source and exact grid.
// Other native packages retain their normal starting view.
export function anatomyEntry(state: ViewState, manifest: Manifest, scope?: AnatomyScope): ViewState {
  const entry = scope?.entry
  if (!entry || !manifest.sources.some(s => s.id === entry.source_id && s.version === entry.source_version)) return state
  const volume = manifest.volumes.find(v => v.id === entry.volume_id)
  if (!volume || volume.shape.some((n,i)=>n!==entry.shape[i]) ||
    volume.affine_ras_mm.some((row,i)=>row.some((v,j)=>!Number.isFinite(entry.affine_ras_mm[i]?.[j])||Math.abs(v-entry.affine_ras_mm[i][j])>1e-6)) ||
    entry.index.some((v,i)=>!Number.isInteger(v)||v<0||v>=volume.shape[i])) return state
  const ids = new Set(manifest.structures.map(s=>s.id))
  if (entry.visible.some(id=>!ids.has(id)) || (entry.selected!==null&&!ids.has(entry.selected))) return state
  const position = volume.affine_ras_mm.slice(0,3).map(row=>row[3]+entry.index.reduce((sum,v,i)=>sum+row[i]*v,0)) as Vec3
  return {...state,selected:entry.selected && state.visible.includes(entry.selected) ? entry.selected : state.selected,background:volume.id,position,
    window:[volume.cal_min,volume.cal_max],pan:[0,0,0,1],layout:'quad',camera:[110,15,1.4],
    surfaceOpacity:entry.surface_opacity,selectionEvidence:{kind:'teaching-marker',candidates:[]},
    annotations:[...state.annotations,{id:`anatomy-entry:${scope!.id}`,text:`${entry.label} · regional observation anchor. ${entry.reference}`,position_ras_mm:position,structure_id:null}]}
}
