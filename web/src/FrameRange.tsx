import { useLayoutEffect, useRef, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { FrameValue } from './frameValue'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: number
  onValueChange: (value: number) => void
}

/** A native range control with immediate thumb feedback and frame-limited work. */
export function FrameRange({ value, onValueChange, disabled, onPointerUp, onPointerCancel, onKeyUp, onBlur, ...props }: Props) {
  const [displayed, setDisplayed] = useState(value)
  const changed = useRef(onValueChange)
  changed.current = onValueChange
  const queued = useRef<FrameValue | null>(null)
  if (!queued.current) queued.current = new FrameValue(value, next => changed.current(next), setDisplayed)

  useLayoutEffect(() => {
    if (disabled) queued.current!.cancel(value)
    else queued.current!.synchronize(value)
  }, [value, disabled])
  useLayoutEffect(() => () => queued.current!.cancel(), [])

  return <input {...props} type="range" value={displayed} disabled={disabled}
    onChange={event => { if (!disabled) queued.current!.queue(Number(event.currentTarget.value)) }}
    onPointerUp={event => { queued.current!.flush(); onPointerUp?.(event) }}
    onPointerCancel={event => { queued.current!.flush(); onPointerCancel?.(event) }}
    onKeyUp={event => { queued.current!.flush(); onKeyUp?.(event) }}
    onBlur={event => {
      queued.current!.flush()
      // A following reset/button action must not be mistaken for an older
      // acknowledgement of the range gesture that just ended.
      queued.current!.cancel()
      onBlur?.(event)
    }}/>
}
