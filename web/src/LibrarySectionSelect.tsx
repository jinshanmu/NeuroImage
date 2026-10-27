import { SelectField } from './SelectField'
import { ALL_STRUCTURES, BACKGROUND_STRUCTURES, CURRENT_GROUP } from './librarySections'

export function LibrarySectionSelect({ id, label, value, onChange, groupName, hasBackground }: {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  groupName: string
  hasBackground: boolean
}) {
  return <SelectField id={id} aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    <option value={CURRENT_GROUP}>{groupName}</option>
    <option value={BACKGROUND_STRUCTURES} disabled={!hasBackground}>Background</option>
    <option value={ALL_STRUCTURES}>All structures</option>
  </SelectField>
}
