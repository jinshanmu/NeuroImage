import type { ReactNode } from 'react'

interface Props {
  structures: { id: string }[]
  sourceStructures: { id: string }[]
  visible: string[]
  disabled: boolean
  onChange: (visible: string[]) => void
  children: ReactNode
}

export function StructureVisibilityActions({ structures, sourceStructures, visible, disabled, onChange, children }: Props) {
  const ids = new Set(structures.map(structure => structure.id))
  const shownIds = new Set(visible)
  const allSelected = ids.size > 0 && [...ids].every(id => shownIds.has(id))
  const shown = sourceStructures.filter(structure => shownIds.has(structure.id)).length
  return <div className="structure-library-controls" role="group" aria-label="Source structure visibility">
    <div className="library-bulk-row">
      {children}
      <button className="library-bulk-toggle" disabled={disabled || !ids.size}
        onClick={() => onChange(allSelected ? visible.filter(id => !ids.has(id)) : [...new Set([...visible, ...ids])])}>
        {allSelected ? 'Deselect' : 'Select'}
      </button>
    </div>
    <p className="library-visibility-count" role="status" aria-label="Structures shown">{shown} of {sourceStructures.length} structures shown</p>
  </div>
}
