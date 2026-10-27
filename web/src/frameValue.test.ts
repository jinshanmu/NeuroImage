import { describe, expect, it, vi } from 'vitest'
import { FrameValue } from './frameValue'

function fixture(initial = 1) {
  let id = 0
  const frames = new Map<number, FrameRequestCallback>(), send = vi.fn(), display = vi.fn()
  const value = new FrameValue(initial, send, display, {
    request: callback => { frames.set(++id, callback); return id },
    cancel: frame => { frames.delete(frame) },
  })
  const run = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(16)) }
  return { value, send, display, frames, run }
}

describe('frame-limited range updates', () => {
  it('shows rapid native thumb values immediately but submits only the latest per frame', () => {
    const f = fixture()
    for (let i = 0; i < 100; i++) f.value.queue(i / 100)
    expect(f.display).toHaveBeenCalledTimes(100)
    expect(f.display).toHaveBeenLastCalledWith(.99)
    expect(f.send).not.toHaveBeenCalled()
    expect(f.frames.size).toBe(1)
    f.run()
    expect(f.send.mock.calls).toEqual([[.99]])
    f.value.queue(.8); f.value.queue(.7); f.run()
    expect(f.send.mock.calls).toEqual([[.99], [.7]])
  })

  it('flushes release/keyboard/blur value exactly once without a later frame replay', () => {
    const f = fixture()
    f.value.queue(.5); f.value.queue(.3); f.value.flush(); f.value.flush(); f.run()
    expect(f.send.mock.calls).toEqual([[.3]])
    expect(f.frames.size).toBe(0)
  })

  it('does not snap a newer optimistic value back when an older submitted prop arrives', () => {
    const f = fixture()
    f.value.queue(.8); f.run()
    f.value.queue(.5)
    f.value.synchronize(.8)
    expect(f.display).toHaveBeenLastCalledWith(.5)
    f.run(); f.value.synchronize(.5)
    expect(f.send.mock.calls).toEqual([[.8], [.5]])
    expect(f.display).toHaveBeenLastCalledWith(.5)
  })

  it('supports skipped React acknowledgements without replaying intermediate states', () => {
    const f = fixture()
    f.value.queue(.8); f.run(); f.value.queue(.6); f.run()
    f.value.queue(.4); f.value.synchronize(.6)
    expect(f.display).toHaveBeenLastCalledWith(.4)
    f.run()
    expect(f.send.mock.calls).toEqual([[.8], [.6], [.4]])
  })

  it('lets an external reset cancel stale pending work and synchronize the thumb', () => {
    const f = fixture()
    f.value.queue(.8); f.run(); f.value.synchronize(.8)
    f.value.queue(.5); f.value.synchronize(.2); f.run()
    expect(f.send.mock.calls).toEqual([[.8]])
    expect(f.display).toHaveBeenLastCalledWith(.2)
    expect(f.frames.size).toBe(0)
    f.value.queue(.3); f.run()
    expect(f.send.mock.calls).toEqual([[.8], [.3]])
  })

  it('accepts a reset to an older submitted value after the range loses focus', () => {
    const f = fixture()
    f.value.queue(.8); f.run()
    f.value.queue(.4); f.value.flush()
    f.value.cancel()
    f.value.synchronize(.8)
    expect(f.display).toHaveBeenLastCalledWith(.8)
    f.run()
    expect(f.send.mock.calls).toEqual([[.8], [.4]])
  })

  it('cancels work on disable/unmount and permits a later enabled control to continue', () => {
    const f = fixture()
    f.value.queue(.5); f.value.cancel(1); f.run()
    expect(f.send).not.toHaveBeenCalled()
    expect(f.display).toHaveBeenLastCalledWith(1)
    f.value.queue(.3); f.value.cancel(); f.run()
    expect(f.send).not.toHaveBeenCalled()
    f.value.queue(.2); f.run()
    expect(f.send.mock.calls).toEqual([[.2]])
  })

  it('ignores invalid values and avoids repeating an already submitted endpoint', () => {
    const f = fixture()
    f.value.queue(NaN); f.value.queue(Infinity)
    expect(f.frames.size).toBe(0)
    f.value.queue(1); f.run()
    expect(f.send).not.toHaveBeenCalled()
    f.value.queue(.5); f.run(); f.value.queue(.5); f.value.flush()
    expect(f.send.mock.calls).toEqual([[.5]])
  })
})
