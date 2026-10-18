import { useLayoutEffect, useRef, useState } from 'react'
import type { SelectHTMLAttributes } from 'react'

/** Keep native selection and keyboard behavior while displaying the complete value. */
export function SelectField({ children, onChange, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const control = useRef<HTMLSelectElement>(null)
  const [label, setLabel] = useState('')
  useLayoutEffect(() => {
    setLabel(control.current?.selectedOptions[0]?.textContent ?? '')
  }, [props.value, props.defaultValue, children])
  return <span className="complete-select" data-disabled={props.disabled || undefined}>
    <select {...props} ref={control} onChange={event => {
      setLabel(event.currentTarget.selectedOptions[0]?.textContent ?? '')
      onChange?.(event)
    }}>{children}</select>
    <span className="complete-select-label" aria-hidden="true">{label || '\u00a0'}</span>
    <span className="complete-select-arrow" aria-hidden="true">⌄</span>
  </span>
}
