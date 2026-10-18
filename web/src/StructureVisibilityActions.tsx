interface Props {
  structures: { id: string }[]
  visible: string[]
  disabled: boolean
  onChange: (visible: string[]) => void
}

export function StructureVisibilityActions({ structures, visible, disabled, onChange }: Props) {
  const ids = new Set(structures.map(structure => structure.id))
  const shown = visible.filter(id => ids.has(id)).length
  return <div className="structure-selection" role="group" aria-label="Select structures in this list">
    <div className="library-actions">
      <button disabled={disabled || !ids.size || shown === ids.size} onClick={() => onChange([...new Set([...visible, ...ids])])}>Select all</button>
      <button disabled={disabled || !shown} onClick={() => onChange(visible.filter(id => !ids.has(id)))}>Deselect all</button>
    </div>
    <p className="small muted" role="status">{shown} of {ids.size} structures shown</p>
    <p className="small muted">Applies to the current search, category and region filters.</p>
  </div>
}
