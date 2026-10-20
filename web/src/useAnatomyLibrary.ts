import { useCallback, useEffect, useRef, useState } from 'react'

export interface SourceInfo {
  id: string; title: string; inputs_present?: number; inputs_required?: number
  sources: { title: string; version: string; license_name: string; url: string }[]
}
export interface LibrarySnapshot {
  session_token: string; sources: SourceInfo[]; packages: Record<string, unknown>[]; active_job: string | null
}

// Owned by App so navigating away from the home page never repeats discovery.
// A new document starts fresh; explicit refresh and completed data operations update it.
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
  const update = useCallback((data: LibrarySnapshot) => {
    // Workspace polling already supplies current discovery results, including new builds.
    // Do not let an older home-page request overwrite them.
    request.current?.abort()
    setSnapshot(data); setLoading(false); setError('')
  }, [])
  useEffect(() => {
    if (enabled) void refresh()
    return () => request.current?.abort()
  }, [enabled, refresh])
  const activeJob = snapshot?.active_job
  useEffect(() => {
    if (!enabled || !activeJob) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    async function poll() {
      try {
        const response = await fetch('/api/workspace/jobs/' + encodeURIComponent(activeJob!), { signal: controller.signal })
        const job = await response.json()
        if (!response.ok) throw Error(job.error ?? 'The local operation is unavailable.')
        if (controller.signal.aborted) return
        if (['complete', 'failed', 'cancelled', 'interrupted'].includes(job.status)) {
          setSnapshot(previous => previous && previous.active_job === activeJob ? { ...previous, active_job: null } : previous)
          // Activation changes the open-atlas registry, not the files in the library.
          if (['acquire', 'build'].includes(job.request?.action)) void refresh(true)
        } else timer = setTimeout(poll, 1800)
      } catch (error) {
        if (!controller.signal.aborted) setError(String(error))
      }
    }
    timer = setTimeout(poll, 1800)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [enabled, activeJob, refresh])
  return { snapshot, loading: enabled && loading, error, refresh, update, clearError: () => setError('') }
}

export type AnatomyLibrary = ReturnType<typeof useAnatomyLibrary>
