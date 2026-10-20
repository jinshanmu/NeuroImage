import { SelectField } from './SelectField'
import { useEffect, useRef, useState } from 'react'
import { LibraryStructureSearch } from './LibraryStructureSearch'

interface Notice { title: string; version: string; url: string; citation: string; license_name: string; license_url: string }
interface Coverage { id: string; title: string; evidence: string; structures?: number }
interface SourcePlan {
  peak_additional_bytes: number; additional_download_bytes: number; additional_expansion_bytes: number; capacity_sufficient: boolean
  archives: { url: string | null; access_url?: string; save_as: string; bytes: number }[]
  files: { url: string; save_as: string; bytes: number }[]
}
interface SourceChoice {
  id: string; title: string; representation: string; sources: Notice[]; error?: string; plan?: SourcePlan
  inputs_present: number; inputs_required: number; construction_peak_bytes: number; build_capacity_sufficient: boolean
  coverage: Coverage[]
}
interface LocalPackage {
  key?: string; dataset_id: string; package_version?: string; folder_version: string; title?: string; status: string
  space_name?: string; structures?: number; declared_asset_bytes?: number; detail?: string; completed_assets?: number
  coverage?: Coverage[]
}
interface Job {
  id: string; status: string; started_utc: string; finished_utc?: string; detail: string
  request: { action: string; recipe?: string; package_key?: string }
  events: Record<string, unknown>[]
  result?: { atlas_key?: string; reused?: number; downloads?: number; extracted?: number }
}
interface Snapshot {
  session_token: string; data_root: string; state_root: string; data_free_bytes: number; state_free_bytes: number
  data_floor_gib: number; state_floor_gib: number; workers: number; active_job: string | null
  sources: SourceChoice[]; packages: LocalPackage[]; jobs: Job[]; jobs_total: number; jobs_offset: number; jobs_limit: number
  modules: { id: string; title: string }[]
}
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : `${(value / 1024 ** 2).toFixed(1)} MiB`
const labels: Record<string, string> = { acquire: 'Acquire or verify sources', build: 'Build or resume atlas', activate: 'Open local atlas' }

function progressText(event: Record<string, unknown>): string | null {
  switch (event.event) {
    case 'acquisition-plan': return 'Storage budget checked; verifying existing source files.'
    case 'download-progress': return `Downloading ${event.file}: ${bytes(Number(event.bytes))} of ${bytes(Number(event.total_bytes))}`
    case 'acquisition-complete': return `${event.reused} source files reused, ${event.downloads} downloaded, ${event.extracted} expanded.`
    case 'build-start': return `Constructing the source atlas with ${event.workers} workers.`
    case 'volume-ready': return `Image ready: ${event.id}`
    case 'probability-ready': return `Source probability ready: ${event.id}`
    case 'meshes-ready': return `Surfaces completed: ${event.completed} of ${event.pending_total}`
    case 'build-complete': return `Atlas ready; ${event.reused} assets reused, ${event.built} constructed.`
    case 'workspace-failure': return String(event.message)
    default: return null
  }
}

async function responseJSON(response: Response) {
  const value = await response.json()
  if (!response.ok) throw new Error(value.error ?? `Local operation failed (${response.status})`)
  return value
}

function CoverageList({ items }: { items: Coverage[] }) {
  if (!items.length) return null
  return <details className="coverage-details"><summary>Coverage: {items.map(item => item.title).join(' · ')}</summary>
    <ul>{items.map(item => <li key={item.id}><strong>{item.title}{item.structures !== undefined && item.structures > 0 ? ` · ${item.structures} source entries` : ''}</strong><p>{item.evidence}</p></li>)}</ul>
    <p className="small muted">Each source retains its native space and definitions. Use independent panels to compare the available source views.</p>
  </details>
}

export function WorkspacePanel({ onOpen, dataset }: { dataset?: string; onOpen: (key: string, structureId?: string) => Promise<void> }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState('')
  const [tab, setTab] = useState<'sources' | 'atlases' | 'operations'>('sources'), [revision, setRevision] = useState(0)
  const [pending, setPending] = useState(false), [filter, setFilter] = useState(dataset ?? '')
  useEffect(() => { setFilter(dataset ?? ''); setTab('sources') }, [dataset])
  const [module, setModule] = useState('')
  const [jobsOffset, setJobsOffset] = useState(0)
  const opening = useRef<{job: string; structureId?: string} | null>(null)
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    async function refresh() {
      try {
        const data: Snapshot = await responseJSON(await fetch('/api/workspace?jobs_offset=' + jobsOffset, { signal: controller.signal }))
        if (cancelled) return
        setSnapshot(data)
        if (data.active_job) timer = setTimeout(refresh, 1800)
      } catch (error) { if (!cancelled) setError(String(error)) }
    }
    void refresh()
    return () => { cancelled = true; controller.abort(); if (timer) clearTimeout(timer) }
  }, [revision, jobsOffset])
  useEffect(() => {
    const job = snapshot?.jobs.find(job => job.id === opening.current?.job)
    if (job?.status === 'complete' && job.result?.atlas_key) {
      const structureId = opening.current?.structureId
      if (structureId) setTab('atlases')
      opening.current = null; void onOpen(job.result.atlas_key, structureId).catch(error => setError(String(error)))
    } else if (job && ['failed', 'cancelled', 'interrupted'].includes(job.status)) opening.current = null
  }, [snapshot, onOpen])
  async function post(path: string, body: object) {
    if (!snapshot) return
    return responseJSON(await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-NeuroImage-Token': snapshot.session_token }, body: JSON.stringify(body) }))
  }
  async function start(request: Job['request'], structureId?: string) {
    setPending(true); setError('')
    try {
      const job = await post('/api/workspace/jobs', request)
      if (request.action === 'activate') opening.current = {job: job.id, structureId}
      setTab('operations'); setJobsOffset(0); setRevision(value => value + 1)
    } catch (error) { setError(String(error)) }
    finally { setPending(false) }
  }
  async function stop(id: string) {
    setPending(true); setError('')
    try { await post('/api/workspace/jobs/' + encodeURIComponent(id) + '/cancel', {}); setRevision(value => value + 1) }
    catch (error) { setError(String(error)) }
    finally { setPending(false) }
  }
  const busy = pending || !!snapshot?.active_job
  const coversModule = (items?: Coverage[]) => !module || !!items?.some(item => item.id === module)
  const records = snapshot?.packages.filter(record => (!filter || record.dataset_id === filter) && coversModule(record.coverage)) ?? []
  const sources = snapshot?.sources.filter(source => (!filter || source.id === filter) && coversModule(source.coverage)) ?? []
  return <section className="workspace-manager" aria-label="Local data workspace">
    <div className="manager-heading"><div><div className="eyebrow">LOCAL ANATOMY WORKSPACE</div><h1>Dataset installation and construction</h1><p>Acquire source files, construct an atlas, then explore its native anatomy in 2D and 3D.</p></div><button onClick={() => setRevision(value => value + 1)} disabled={pending}>Refresh workspace</button></div>
    {error && <div className="error" role="alert">{error}<button aria-label="Dismiss workspace error" onClick={() => setError('')}>×</button></div>}
    {!snapshot ? <p role="status">Opening the local workspace…</p> : <>
      <div className="storage-summary"><div><strong>Imaging data</strong><span>{bytes(snapshot.data_free_bytes)} free · {snapshot.data_floor_gib} GiB safety floor</span><code>{snapshot.data_root}</code></div><div><strong>Workspace state</strong><span>{bytes(snapshot.state_free_bytes)} free · {snapshot.state_floor_gib} GiB safety floor</span><code>{snapshot.state_root}</code></div><div><strong>Execution</strong><span>One operation at a time</span><span>{snapshot.workers} construction workers</span><small>Original data and completed checkpoints are retained when stopped.</small></div></div>
      <nav className="manager-tabs" aria-label="Workspace sections">{(['sources', 'atlases', 'operations'] as const).map(value => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{value === 'sources' ? 'Source recipes' : value === 'atlases' ? 'Local atlases' : `Operations${snapshot.active_job ? ' · running' : ''}`}</button>)}</nav>
      {tab !== 'operations' && <label className="module-filter">Anatomy group<SelectField aria-label="Anatomy group" value={module} onChange={event => setModule(event.target.value)}><option value="">All anatomy modules</option>{snapshot.modules.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</SelectField></label>}
      {tab === 'sources' && <><p className="muted">File presence is shown below. Acquisition verifies source hashes and reuses matching files. Each dataset retains its own source terms.</p><div className="source-grid">{sources.map(source => <article className="source-card" key={source.id} aria-label={source.title}>
        <h2>{source.title}</h2><p className="small muted">{source.id} · {source.inputs_present ?? 0}/{source.inputs_required ?? '—'} required inputs present</p>
        <CoverageList items={source.coverage} />
        {source.error ? <p role="alert">{source.error}</p> : source.plan && <>
          <dl className="budget-grid"><div><dt>Additional acquisition peak</dt><dd>{bytes(source.plan.peak_additional_bytes)}</dd></div><div><dt>Construction reserve</dt><dd>{bytes(source.construction_peak_bytes)}</dd></div></dl>
          <p className="small muted">Download {bytes(source.plan.additional_download_bytes)} · Selective expansion {bytes(source.plan.additional_expansion_bytes)}. Safety floor remains additional.</p>
          {!source.plan.capacity_sufficient && <p className="capacity-message">Free space is below the acquisition budget and safety floor.</p>}
          {!source.build_capacity_sufficient && <p className="capacity-message">Free space is below the construction budget and safety floor.</p>}
          <div className="button-row"><button disabled={busy || !source.plan.capacity_sufficient} onClick={() => void start({ action: 'acquire', recipe: source.id })}>Acquire or verify</button><button className="primary" disabled={busy || !source.build_capacity_sufficient || source.inputs_present !== source.inputs_required} onClick={() => void start({ action: 'build', recipe: source.id })}>Build or resume</button></div>
          <details><summary>Source, license and required files</summary>{source.sources.map((notice, index) => <div className="source-notice" key={index}><a href={notice.url} target="_blank" rel="noreferrer">{notice.title}</a><p>{notice.version} · {notice.citation}</p><a href={notice.license_url} target="_blank" rel="noreferrer">{notice.license_name}</a></div>)}
            {[...source.plan.archives, ...source.plan.files].map((file, index) => <div className="source-file" key={index}><a href={file.url || ('access_url' in file ? file.access_url : undefined)} target="_blank" rel="noreferrer">{file.url ? 'Official source file' : 'Official access page'}</a><span>{bytes(file.bytes)}</span><code>{file.save_as}</code>{!file.url && <p>Obtain the unchanged archive from its official access page and save it at this relative path under the imaging data directory. Then use Acquire or verify.</p>}</div>)}
          </details>
        </>}
      </article>)}</div></>}
      <div hidden={tab !== 'atlases'} className="local-library"><label>Dataset<SelectField aria-label="Workspace dataset filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="">All source datasets</option>{snapshot.sources.map(source => <option key={source.id} value={source.id}>{source.id}</option>)}</SelectField></label><p className="muted">Package presence and sizes are inspected here. Opening verifies the selected version's assets and geometry.</p>
        <LibraryStructureSearch dataset={filter} module={module} revision={revision} busy={busy} open={(key, structureId) => void start({action: 'activate', package_key: key}, structureId)}/>
        {!records.length && <p>Choose another module or dataset, or build a source recipe matching these filters.</p>}
        {records.map(record => <article className="local-package" key={record.dataset_id + record.folder_version}><div><h2>{record.title ?? record.dataset_id}</h2><p>{record.space_name ?? 'Construction incomplete'} · <code>{record.package_version ?? record.folder_version}</code></p><p className="muted">{record.status === 'available' ? `${record.structures} source structures · ${bytes(record.declared_asset_bytes ?? 0)}` : record.detail}</p><CoverageList items={record.coverage ?? []} /></div>
          {record.status === 'available' && record.key ? <div className="package-actions"><button className="primary" disabled={busy} onClick={() => void start({ action: 'activate', package_key: record.key })}>Open atlas</button>
          </div> : <span className="job-status">{record.status}</span>}
        </article>)}
      </div>
      {tab === 'operations' && <div className="workspace-jobs" aria-label="Workspace operations">
        <p role="status">{snapshot.jobs_total ? `Operations ${snapshot.jobs_offset + 1}–${snapshot.jobs_offset + snapshot.jobs.length} of ${snapshot.jobs_total}` : 'Ready to prepare a local source.'}</p>
        {snapshot.jobs_total > snapshot.jobs_limit && <div className="button-row" aria-label="Operation history pages"><button disabled={busy || snapshot.jobs_offset === 0} onClick={() => setJobsOffset(Math.max(0, snapshot.jobs_offset - snapshot.jobs_limit))}>Newer operations</button><button disabled={busy || snapshot.jobs_offset + snapshot.jobs_limit >= snapshot.jobs_total} onClick={() => setJobsOffset(snapshot.jobs_offset + snapshot.jobs_limit)}>Older operations</button></div>}
        {snapshot.jobs.map(job => <article key={job.id} className="workspace-job" aria-label={'Operation ' + job.id}>
        <div className="job-heading"><h2>{labels[job.request.action] ?? job.request.action}</h2><span className={'job-status ' + job.status}>{job.status}</span></div><p>{job.request.recipe ?? job.request.package_key}</p><p role={job.status === 'running' ? 'status' : undefined}>{job.status === 'running' ? 'The local operation is running. Verified files and matching checkpoints are reused.' : job.detail}</p>
        {!!job.events.length && <ul className="job-progress" aria-label="Operation progress">{job.events.map(progressText).filter(Boolean).slice(-5).map((message, index) => <li key={index}>{message}</li>)}</ul>}
        {job.status === 'complete' && job.result && <div className="button-row">{job.result.atlas_key && <button className="primary" disabled={busy} onClick={() => void start({action: 'activate', package_key: job.result!.atlas_key!})}>Browse atlas</button>}{job.result.reused !== undefined && <span>{job.result.reused} source files reused · {job.result.downloads ?? 0} downloaded · {job.result.extracted ?? 0} extracted</span>}</div>}
        {job.id === snapshot.active_job && <button disabled={pending || job.status === 'stopping'} onClick={() => void stop(job.id)}>Stop operation</button>}
        <details><summary>Timing and recovery</summary><p>Started {job.started_utc}{job.finished_utc && ` · Finished ${job.finished_utc}`}</p><p>Repeat the same source operation to reuse verified files and matching checkpoints. Diagnostic log:</p><code>{snapshot.state_root}/jobs/{job.id}/operation.log</code></details>
      </article>)}</div>}
    </>}
  </section>
}
