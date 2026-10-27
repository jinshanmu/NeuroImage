import { expect, it, vi } from 'vitest'
import { ViewerLifecycle } from './viewerLifecycle'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

it('waits for canvas attachment before applying the newest startup state', async () => {
  const attachment = deferred(), viewer = {
    initialize: vi.fn(() => attachment.promise), apply: vi.fn(async (_state: number) => {}), dispose: vi.fn(),
  }
  const lifecycle = new ViewerLifecycle(viewer), ready = lifecycle.initialize(1)
  await lifecycle.apply(2)
  await lifecycle.apply(3)
  expect(viewer.apply).not.toHaveBeenCalled()
  attachment.resolve()
  expect(await ready).toBe(true)
  expect(viewer.apply.mock.calls).toEqual([[3]])
  await lifecycle.apply(4)
  expect(viewer.apply.mock.calls).toEqual([[3], [4]])
})

it('settles camera acknowledgements that arrive during the startup echo', async () => {
  const attachment = deferred(), echo = deferred(), viewer = {
    initialize: vi.fn(() => attachment.promise), apply: vi.fn(async (_state: number) => { if (viewer.apply.mock.calls.length === 1) await echo.promise }), dispose: vi.fn(),
  }
  const lifecycle = new ViewerLifecycle(viewer), ready = lifecycle.initialize(1)
  await lifecycle.apply(2)
  attachment.resolve()
  await vi.waitFor(() => expect(viewer.apply).toHaveBeenCalledWith(2))
  await lifecycle.apply(3)
  echo.resolve()
  expect(await ready).toBe(true)
  expect(viewer.apply.mock.calls).toEqual([[2], [3]])
})

it('does not make a disposed or replaced startup ready or replay its queued state', async () => {
  const attachment = deferred(), oldViewer = {
    initialize: vi.fn(() => attachment.promise), apply: vi.fn(async (_state: number) => {}), dispose: vi.fn(),
  }
  const old = new ViewerLifecycle(oldViewer), oldReady = old.initialize(1)
  await old.apply(2)
  old.dispose()
  const nextViewer = { initialize: vi.fn(async (_state: number) => {}), apply: vi.fn(async (_state: number) => {}), dispose: vi.fn() }
  const next = new ViewerLifecycle(nextViewer)
  expect(await next.initialize(10)).toBe(true)
  attachment.resolve()
  expect(await oldReady).toBe(false)
  await old.apply(3)
  expect(old.active).toBe(false)
  expect(oldViewer.dispose).toHaveBeenCalledOnce()
  expect(oldViewer.apply).not.toHaveBeenCalled()
  expect(nextViewer.apply).not.toHaveBeenCalled()
})

it('leaves failed initialization unavailable and permits an independent retry', async () => {
  const apply = vi.fn(async (_state: number) => {})
  const failed = new ViewerLifecycle({ initialize: async () => { throw Error('source unavailable') }, apply, dispose: vi.fn() })
  await expect(failed.initialize(1)).rejects.toThrow('source unavailable')
  await failed.apply(2)
  expect(apply).not.toHaveBeenCalled()
  failed.dispose()
  const retry = new ViewerLifecycle({ initialize: async (_state: number) => {}, apply, dispose: vi.fn() })
  expect(await retry.initialize(3)).toBe(true)
  await retry.apply(4)
  expect(apply).toHaveBeenCalledWith(4)
})
