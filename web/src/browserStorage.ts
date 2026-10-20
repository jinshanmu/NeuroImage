/** Store scenes without sharing the small localStorage quota. */
// Keep the historical database name so existing scenes and other records survive.
const DATABASE = 'neuroimage-teaching'
const STORE = 'content'
const MAX_BYTES = 12 * 1024 ** 2

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Browser saving is unavailable. Export a file to retain your work.')); return }
    const request = indexedDB.open(DATABASE, 1)
    let abandoned = false
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'))
    request.onblocked = () => {
      abandoned = true
      reject(new Error('Close other NeuroImage tabs and retry saving, or export a file.'))
    }
    request.onsuccess = () => {
      if (abandoned) { request.result.close(); return }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}

function checkKey(key: string) {
  if (!key.startsWith('neuroimage:') || key.length > 1024) throw new Error('Invalid scene storage key.')
}

async function transaction(key: string, operation: 'get' | 'put' | 'delete', value?: string): Promise<string | null> {
  checkKey(key)
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    let result: unknown = null
    let work: IDBTransaction
    try {
      work = database.transaction(STORE, operation === 'get' ? 'readonly' : 'readwrite')
      const store = work.objectStore(STORE)
      const request = operation === 'get' ? store.get(key) : operation === 'put' ? store.put(value, key) : store.delete(key)
      request.onsuccess = () => { if (operation === 'get') result = request.result ?? null }
    } catch (error) { database.close(); reject(error); return }
    // A successful request is not proof that the surrounding write committed.
    work.oncomplete = () => {
      database.close()
      if (result !== null && typeof result !== 'string') reject(new Error('The stored scene is unreadable. Its original copy has been retained.'))
      else resolve(result as string | null)
    }
    work.onabort = () => { database.close(); reject(work.error ?? new Error('Saving was interrupted. Export a file to retain your work.')) }
    work.onerror = () => { /* The abort event reports the final transaction failure. */ }
  })
}

function legacyValue(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null } catch { return null }
}

export async function readBrowserContent(key: string): Promise<string | null> {
  checkKey(key)
  try { return await transaction(key, 'get') ?? legacyValue(key) }
  catch (error) {
    const previous = legacyValue(key)
    if (previous !== null) return previous
    throw error
  }
}

export async function saveBrowserContent(key: string, value: string): Promise<void> {
  if (new TextEncoder().encode(value).length > MAX_BYTES) throw new Error('This scene is too large for browser storage. Export a scene file.')
  await transaction(key, 'put', value)
  // Retire only this old key, and only after its replacement has committed.
  try { globalThis.localStorage?.removeItem(key) } catch { /* The committed record remains authoritative. */ }
}

export async function removeBrowserContent(key: string): Promise<void> {
  await transaction(key, 'delete')
  // Report failure instead of claiming removal while a legacy draft remains.
  globalThis.localStorage?.removeItem(key)
}
