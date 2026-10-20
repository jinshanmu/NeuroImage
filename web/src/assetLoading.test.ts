import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadAssetsInOrder } from './assetLoading'

afterEach(() => vi.unstubAllGlobals())

function requests() {
  const responses = new Map<string, (response: Response) => void>(), signals: AbortSignal[] = []
  const fetch = vi.fn((url: string, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = options.signal!
    signals.push(signal)
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), {once:true})
    responses.set(url, resolve)
  }))
  vi.stubGlobal('fetch', fetch)
  const respond = (id: string, status = 200) => responses.get(id)!(new Response(id, {status}))
  return { fetch, respond, signals }
}

describe('bounded source asset loading', () => {
  it('overlaps reads while preserving source order and bytes for the renderer', async () => {
    const { fetch, respond } = requests(), seen: string[] = []
    const done = loadAssetsInOrder(['a','b','c','d','e'], id => id, (id, buffer) => {
      seen.push(id + ':' + new TextDecoder().decode(buffer))
    }, new AbortController().signal)
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['a','b','c','d'])
    respond('c'); respond('b')
    await Promise.resolve()
    expect(seen).toEqual([])
    respond('a')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(5))
    respond('e'); respond('d'); await done
    expect(seen).toEqual(['a:a','b:b','c:c','d:d','e:e'])
  })

  it('aborts pending reads when the viewer is disposed without delivering partial geometry', async () => {
    const { fetch, signals } = requests(), controller = new AbortController(), consume = vi.fn()
    const done = loadAssetsInOrder(['a','b','c','d','e'], id => id, consume, controller.signal)
    controller.abort(); await done
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(consume).not.toHaveBeenCalled()
  })

  it('stops an obsolete render and releases its read-ahead buffers', async () => {
    const { respond, signals } = requests()
    let current = true
    const seen: string[] = []
    const done = loadAssetsInOrder(['a','b','c','d'], id => id, id => {
      seen.push(id); current = false
    }, new AbortController().signal, () => current)
    respond('a'); await done
    expect(seen).toEqual(['a'])
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })

  it('reports an unreadable asset and cancels remaining reads', async () => {
    const { respond, signals } = requests(), consume = vi.fn()
    const done = loadAssetsInOrder(['a','b','c'], id => id, consume, new AbortController().signal)
    const failure = expect(done).rejects.toThrow('Could not load source asset (404): b')
    respond('b', 404); respond('a')
    await failure
    expect(consume).toHaveBeenCalledOnce()
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })

  it('does not start work for an already cancelled viewer', async () => {
    const { fetch } = requests(), controller = new AbortController()
    controller.abort()
    await loadAssetsInOrder(['a'], id => id, vi.fn(), controller.signal)
    expect(fetch).not.toHaveBeenCalled()
  })
})
