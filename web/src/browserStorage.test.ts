import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { readBrowserContent, removeBrowserContent, saveBrowserContent } from './browserStorage'

const key = 'neuroimage:scene:package-v1'
let legacy: Map<string, string>
beforeEach(() => {
  legacy = new Map()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', {
    getItem: (name: string) => legacy.get(name) ?? null,
    removeItem: (name: string) => legacy.delete(name),
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('reads a legacy file without modifying it, then migrates only the explicitly saved key', async () => {
  legacy.set(key, 'old scene'); legacy.set('neuroimage:notebook:other', 'other work')
  expect(await readBrowserContent(key)).toBe('old scene')
  expect(legacy.get(key)).toBe('old scene')
  await saveBrowserContent(key, 'new scene')
  expect(await readBrowserContent(key)).toBe('new scene')
  expect(legacy.has(key)).toBe(false)
  expect(legacy.get('neuroimage:notebook:other')).toBe('other work')
})

it('round-trips a record larger than the previous localStorage failure size', async () => {
  const content = JSON.stringify({note: 'x'.repeat(6 * 1024 ** 2), position: [1.25, -8.5, 99]})
  await saveBrowserContent(key, content)
  expect(await readBrowserContent(key)).toBe(content)
})

it('reads committed updates through a new connection without a stale in-memory cache', async () => {
  await saveBrowserContent(key, 'first tab')
  expect(await readBrowserContent(key)).toBe('first tab')
  await saveBrowserContent(key, 'second tab')
  expect(await readBrowserContent(key)).toBe('second tab')
})

it('does not acknowledge a successful request when its transaction subsequently aborts', async () => {
  await saveBrowserContent(key, 'committed original')
  legacy.set(key, 'preserved legacy')
  const original = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
    const request = original.apply(this, args)
    request.addEventListener('success', () => this.transaction.abort())
    return request
  })
  await expect(saveBrowserContent(key, 'uncommitted replacement')).rejects.toThrow()
  expect(await readBrowserContent(key)).toBe('committed original')
  expect(legacy.get(key)).toBe('preserved legacy')
})

it('retains legacy recovery when the browser blocks IndexedDB', async () => {
  legacy.set(key, 'recoverable scene')
  vi.stubGlobal('indexedDB', undefined)
  expect(await readBrowserContent(key)).toBe('recoverable scene')
  await expect(saveBrowserContent(key, 'replacement')).rejects.toThrow('unavailable')
  expect(legacy.get(key)).toBe('recoverable scene')
})

it('reports unavailable storage when no saved fallback exists', async () => {
  vi.stubGlobal('indexedDB', undefined)
  await expect(readBrowserContent(key)).rejects.toThrow('unavailable')
})

it('removes both versions only after the database transaction succeeds', async () => {
  await saveBrowserContent(key, 'current')
  legacy.set(key, 'old copy')
  await removeBrowserContent(key)
  expect(await readBrowserContent(key)).toBeNull()
})

it('rejects oversized or unrelated writes while retaining the previous valid file', async () => {
  await saveBrowserContent(key, 'original')
  await expect(saveBrowserContent(key, 'x'.repeat(12 * 1024 ** 2 + 1))).rejects.toThrow('too large')
  await expect(saveBrowserContent('another-application', 'value')).rejects.toThrow('Invalid')
  expect(await readBrowserContent(key)).toBe('original')
})
