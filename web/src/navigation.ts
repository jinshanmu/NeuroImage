import { initialState } from './scene'
import type { Manifest, ViewState } from './types'

export function locateSourceStructure(state: ViewState, manifest: Manifest, structureId: string): ViewState {
  const structure = manifest.structures.find(item => item.id === structureId)
  if (!structure) throw new Error('This structure is not declared in the selected atlas version.')
  return { ...state, selected: structure.id, position: [...structure.target_ras_mm],
    selectionEvidence: {kind: 'source-target', candidates: [structure.id]},
    visible: [...new Set([...state.visible, structure.id])], layout: 'quad', pan: [0, 0, 0, 1],
    camera: initialState(manifest).camera, focus3D: undefined, surfaceCutaway: undefined }
}
