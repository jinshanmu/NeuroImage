import { useCallback, useEffect, useRef, useState } from 'react'
import type { DatasetInfo, DatasetSource } from './types'

export interface SourceInfo {
  id: string; title: string; inputs_present?: number; inputs_required?: number
  sources: DatasetSource[]; dataset_info?: DatasetInfo
}
export interface LibrarySnapshot {
  session_token: string; sources: SourceInfo[]; packages: Record<string, unknown>[]; active_job: string | null
}

// Owned by App so navigating away from the home page never repeats discovery.
// A new document starts fresh; explicit refresh updates the read-only library.
export function useAnatomyLibrary(enabled: boolean) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const refresh = useCallback(async (force = false) => {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/workspace/browse' + (force ? '?refresh=1' : ''), { signal: controller.signal })
      const data = await response.json()
      if (!response.ok) throw Error(data.error ?? 'The local source library is unavailable.')
      if (!controller.signal.aborted) setSnapshot(data)
    } catch (error) {
      if (!controller.signal.aborted) setError(String(error))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (enabled) void refresh()
    return () => request.current?.abort()
  }, [enabled, refresh])
  return { snapshot, loading: enabled && loading, error, refresh, clearError: () => setError('') }
}

export type AnatomyLibrary = ReturnType<typeof useAnatomyLibrary>
