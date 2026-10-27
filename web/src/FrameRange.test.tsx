import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FrameRange } from './FrameRange'

describe('frame range native control', () => {
  it('preserves the range semantics, accessible name, limits and current value', () => {
    const html = renderToStaticMarkup(createElement(FrameRange, {
      value: .4, onValueChange: () => {}, 'aria-label': '3D opacity', min: 0, max: 1, step: .05,
      disabled: true, title: '3D opacity', id: 'opacity',
    }))
    for (const attr of ['type="range"', 'aria-label="3D opacity"', 'min="0"', 'max="1"', 'step="0.05"', 'value="0.4"', 'disabled=""', 'title="3D opacity"', 'id="opacity"'])
      expect(html).toContain(attr)
  })
})
