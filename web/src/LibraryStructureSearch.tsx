import { useEffect, useState } from 'react'

interface Match {
  atlas_key: string; dataset_id: string; package_version: string; title: string; space_name: string
  structure_id: string; name: string; source_name: string; category: string; laterality: string; kind: string
}
interface Results { query: string; offset: number; limit: number; total: number; matches: Match[]; indexed_packages: number; unavailable_packages: number }

export function LibraryStructureSearch({ dataset, module, revision, busy, open }: {
  dataset: string; module: string; revision: number; busy: boolean; open: (key: string, structureId: string) => void
}) {
  const [query, setQuery] = useState(''), [offset, setOffset] = useState(0)
  const [results, setResults] = useState<Results | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('')
  useEffect(() => setOffset(0), [dataset, module])
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setResults(null); setError('')
    if (query.trim().length < 2) { setLoading(false); return }
    setLoading(true)
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim(), dataset, module, offset: String(offset) })
      void fetch('/api/workspace/structures?' + params, {signal: controller.signal}).then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'The local structure catalog is unavailable.')
        if (!cancelled) setResults(data)
      }).catch(error => { if (!cancelled) setError(String(error)) }).finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer); controller.abort() }
  }, [query, dataset, module, offset, revision])
  return <section className="library-structure-search" aria-label="Search local anatomy">
    <label>Find a structure across local atlases<input type="search" aria-label="Search all local structures" maxLength={160} placeholder="e.g. trigeminal, RN_l, left putamen" value={query} onChange={event => { setQuery(event.target.value); setOffset(0) }}/></label>
    <p className="small muted">Search source names, abbreviations and stable IDs in the selected dataset and module. Historical versions remain separate. Compare source definitions when names match.</p>
    {loading && <p role="status">Searching local source definitions…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {results && <>
      <p role="status">{results.total ? `${results.offset + 1}–${Math.min(results.offset + results.matches.length, results.total)} of ${results.total} source matches` : 'Try another source name, abbreviation or module'} · {results.indexed_packages} local packages searched{results.unavailable_packages > 0 && ` · ${results.unavailable_packages} incomplete or unavailable packages omitted`}</p>
      {!results.total && <p className="small muted">Try another source name or clear a filter. Image-only acquisitions have no segmented structure entries.</p>}
      <ul className="structure-search-results">{results.matches.map(match => <li key={match.atlas_key + ':' + match.structure_id} aria-label={`${match.name} · ${match.dataset_id} · ${match.package_version}`}>
        <div><strong>{match.name}</strong><span>{match.laterality} · {match.category}</span><span>{match.title} · <code>{match.package_version}</code></span><span className="small muted">{match.space_name} · Source: {match.source_name}</span><code className="small break-word">{match.structure_id}</code></div>
        <button disabled={busy} onClick={() => open(match.atlas_key, match.structure_id)}>Open structure</button>
      </li>)}</ul>
      {results.total > results.limit && <div className="button-row" aria-label="Structure search pages"><button disabled={offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - results.limit))}>Previous matches</button><button disabled={offset + results.limit >= results.total || loading} onClick={() => setOffset(value => value + results.limit)}>Next matches</button></div>}
      {!!results.matches.length && <p className="small muted">Opening checks the exact package assets and locates its native source target with complete 2D sections. Comparison views retain independent coordinates.</p>}
    </>}
  </section>
}
