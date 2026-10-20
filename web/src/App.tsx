import { SelectField } from './SelectField'
import { StructureVisibilityActions } from './StructureVisibilityActions'
import { BackgroundControls } from './BackgroundControls'
import { brainBackgroundIds } from './atlasBackground'
import { centeredSlicePan } from './independentRegions'
import { navigate, normalizeBrowseLocation } from './appNavigation'
import { anatomyGroup, browseTargets, targetScope } from './anatomyNavigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { readBrowserContent, saveBrowserContent } from './browserStorage'
import type { AtlasViewer } from './viewer'
import { exportScene, initialState, makeScene, readScene } from './scene'
import { exportAtlasImage } from './export'
import { formatProbability, probabilityNavigationDescription, probabilityScale } from './probability'
import { StreamlineControls } from './StreamlineControls'
import { NativeImageControls } from './NativeImageControls'
import { SurfaceCutawayControls } from './SurfaceCutawayControls'
import { focusStructure3D, setSurfaceOpacity, surfaceOpacity } from './display'
import { SECTION_PLANES, PLANE_COLORS } from './sectionPlanes'
import { WorkspacePanel } from './WorkspacePanel'
import { AnatomyHome } from './AnatomyHome'
import { SurfaceModelWorkspace } from './SurfaceModelWorkspace'
import { initialModelView } from './modelScene'
import type { ModelView, SurfaceManifest } from './modelTypes'
import type { AnatomyScope } from './anatomyNavigation'
import { anatomyEntry } from './anatomyEntry'
import { locateSourceStructure } from './navigation'
import type { AtlasEntry, Manifest, Structure, ViewState } from './types'

export default function App() {
  const [atlases, setAtlases] = useState<AtlasEntry[]>([]), [active, setActive] = useState(''), [error, setError] = useState('')
  const [comparing, setComparing] = useState(false), [comparison, setComparison] = useState('')
  const [startup, setStartup] = useState<{ atlas_key: string; content: unknown } | null>(null)
  const [home, setHome] = useState(true), [dataset, setDataset] = useState<string | null>(null)
  const [homeGroup, setHomeGroup] = useState<string | null>(null)
  const [scope, setScope] = useState<AnatomyScope | undefined>()
  const [workspaceEnabled, setWorkspaceEnabled] = useState(false), [showWorkspace, setShowWorkspace] = useState(false)
  const [routeVisit, setRouteVisit] = useState(0), [loadingCatalog, setLoadingCatalog] = useState(true)
  const memory = useRef(new Map<string, ViewState>())
  const modelMemory = useRef(new Map<string, ModelView>())
  const updateAtlases = useCallback((next: AtlasEntry[]) => setAtlases(previous => next.map(entry => {
    const current = previous.find(item => item.key === entry.key)
    return current && JSON.stringify(current) === JSON.stringify(entry) ? current : entry
  })), [])
  useEffect(() => {
    const restoreRoute = () => setRouteVisit(value => value + 1)
    window.addEventListener('popstate', restoreRoute)
    return () => window.removeEventListener('popstate', restoreRoute)
  }, [])
  useEffect(() => {
    let cancelled = false
    setError(''); setLoadingCatalog(true)
    async function load() {
      const normalized = normalizeBrowseLocation(location.pathname + location.search)
      if (normalized !== location.pathname + location.search) history.replaceState(null, '', normalized)
      const requestedUrl = location.pathname + location.search
      const response = await fetch('/api/atlases')
      if (!response.ok) throw new Error('The local atlas service is unavailable.')
      let data = await response.json()
      let selected: { atlas_key: string; content: unknown } | null = null
      const parameters = new URLSearchParams(location.search)
      const managing = parameters.get('view') === 'workspace' && !!data.workspace
      const requestedAtlas = parameters.get('view') === 'atlas' ? parameters.get('atlas') : null
      if (requestedAtlas && data.workspace && !data.atlases.some((entry: AtlasEntry) => entry.key === requestedAtlas)) {
        const restored = await fetch('/api/workspace/atlases/' + encodeURIComponent(requestedAtlas))
        const value = await restored.json()
        if (!restored.ok) throw Error(value.error ?? 'The bookmarked source package could not be opened.')
        data = await (await fetch('/api/atlases')).json()
      }
      if (data.startup && !parameters.get('view')) {
        const result = await fetch(data.startup.content_url)
        if (!result.ok) throw new Error('The selected scene is unavailable from this local service.')
        selected = { atlas_key: data.startup.atlas_key, content: await result.json() }
      }
      if (cancelled || location.pathname + location.search !== requestedUrl) return
      const requestedEntry: AtlasEntry | undefined = data.atlases.find((entry: AtlasEntry) => entry.key === requestedAtlas)
      if (requestedAtlas && !requestedEntry) throw Error('The selected source is unavailable. Open it from Browse anatomy.')
      const requestedGroup = anatomyGroup(parameters.get('group'))
      setScope(requestedEntry && requestedGroup ? targetScope(requestedGroup, browseTargets([requestedEntry])[0]) : undefined)
      setDataset(parameters.get('dataset'))
      setHomeGroup(parameters.get('view') === 'anatomy' ? parameters.get('group') : null)
      setWorkspaceEnabled(!!data.workspace); setShowWorkspace(managing); setHome(!selected && !requestedEntry)
      setStartup(selected); updateAtlases(data.atlases)
      setActive(selected?.atlas_key ?? requestedEntry?.key ?? data.atlases[0]?.key ?? '')
      setComparison(data.atlases[1]?.key ?? data.atlases[0]?.key ?? '')
    }
    void load().catch(error => !cancelled && setError(String(error))).finally(() => !cancelled && setLoadingCatalog(false))
    return () => { cancelled = true }
  }, [routeVisit, updateAtlases])
  const openWorkspaceAtlas = useCallback(async (key: string, structureId?: string, anatomyScope?: AnatomyScope, signal?: AbortSignal) => {
    const response = await fetch('/api/atlases', { signal })
    if (!response.ok) throw new Error('The local atlas catalog is unavailable.')
    const data = await response.json()
    const entry = data.atlases.find((entry: AtlasEntry) => entry.key === key)
    if (!entry) throw new Error('Open and verify this atlas from the local library first.')
    if (structureId) {
      const response = await fetch(entry.manifest_url, { signal })
      if (!response.ok) throw new Error('The verified source manifest is unavailable.')
      const manifest = await response.json(), viewKey = 'primary:' + key
      if (entry.representation === 'surface-model') {
        const model = manifest as SurfaceManifest, item = model.structures.find(item => item.id === structureId)
        if (!item) throw Error('The source model object is unavailable.')
        const previous = modelMemory.current.get(viewKey) ?? initialModelView(model)
        modelMemory.current.set(viewKey, { ...previous, selected: item.id, position_native_mm: [...item.target_native_mm], visible: [...new Set([...previous.visible, item.id])] })
      } else memory.current.set(viewKey, locateSourceStructure(memory.current.get(viewKey) ?? initialState(manifest), manifest, structureId))
    }
    signal?.throwIfAborted()
    updateAtlases(data.atlases); setActive(key); setComparison(value => value || key)
    setShowWorkspace(false); setHome(false); setScope(anatomyScope); setStartup(null); setError('')
    navigate({ view: 'atlas', atlas: key, group: anatomyScope?.id })
  }, [updateAtlases])
  function openAnatomyHome() {
    setHome(true); setDataset(null); setHomeGroup(null); setShowWorkspace(false); setError('')
    navigate({ view: 'anatomy' })
  }
  const atlas = atlases.find(a => a.key === active)
  const second = atlases.find(a => a.key === comparison)
  const atlasLabel = (entry: AtlasEntry) => atlases.some(other => other.key !== entry.key && other.title === entry.title)
    ? `${entry.title} · ${entry.package_version}` : entry.title
  return <div className={`app ${comparing && !showWorkspace && !home ? 'comparing' : ''}`}>
    <header className="app-header"><a className="brand" href="/?view=anatomy" aria-label="NeuroImage home" onClick={event => { event.preventDefault(); openAnatomyHome() }}><span className="brand-mark">N</span><span>NeuroImage<small>ANATOMY WORKSPACE</small></span></a>
      <button className="workspace-toggle" aria-pressed={home && !dataset && !showWorkspace} onClick={openAnatomyHome}>Browse anatomy</button>
      {showWorkspace && <button onClick={() => { setShowWorkspace(false); setHome(true); navigate({ view: 'anatomy', dataset: dataset ?? undefined }) }}>Back to dataset</button>}
      {!showWorkspace && !home && <div className="dataset-picker"><label htmlFor="atlas">Source</label><SelectField id="atlas" value={active} onChange={e => { setActive(e.target.value); setScope(undefined); setStartup(null); navigate({ view: 'atlas', atlas: e.target.value }) }}>{atlases.map(a => <option key={a.key} value={a.key}>{atlasLabel(a)}</option>)}</SelectField></div>}
      {!showWorkspace && !home && <label className="check-control"><input type="checkbox" checked={comparing} disabled={!atlas} onChange={e => setComparing(e.target.checked)}/>Compare sources</label>}
      {comparing && !showWorkspace && !home && <div className="dataset-picker comparison-picker"><label htmlFor="comparison-atlas">Compare with</label><SelectField id="comparison-atlas" value={comparison} onChange={e => setComparison(e.target.value)}>{atlases.map(a => <option key={a.key} value={a.key}>{atlasLabel(a)}</option>)}</SelectField></div>}
      <div className="header-note"><span className="status-dot"/>Local workspace<span className="version">v{__NEUROIMAGE_VIEWER__.version} · Anatomy browser</span></div>
    </header>
    {loadingCatalog && <p role="status" className="catalog-status">Loading local sources…</p>}
    {error && <div role="alert" className="error">{error}<button onClick={() => setRouteVisit(value => value + 1)}>Retry</button></div>}
    {comparing && !showWorkspace && !home && <div className="comparison-note">Independent native spaces · Each panel keeps its own coordinates, structure selection and scene. Compare source definitions before interpreting similarities.</div>}
    {workspaceEnabled && showWorkspace && <WorkspacePanel onOpen={openWorkspaceAtlas} dataset={dataset ?? undefined}/>}
    {home && !showWorkspace && !loadingCatalog && <AnatomyHome atlases={atlases} workspace={workspaceEnabled} dataset={dataset} group={homeGroup} onGroup={value => { setHomeGroup(value); navigate({ view: 'anatomy', dataset: dataset ?? undefined, group: value ?? undefined }) }} onDataset={value => { setDataset(value); setHomeGroup(null); navigate({ view: 'anatomy', dataset: value ?? undefined }) }} onManage={value => { setDataset(value); setHomeGroup(null); setShowWorkspace(true); navigate({ view: 'workspace', dataset: value }) }} onOpen={openWorkspaceAtlas}/>}
    {!home && !showWorkspace && (atlas ? <main className={`workspace-pair ${comparing ? 'comparison-active' : ''}`}>
      <section className="atlas-slot" aria-label="Primary atlas workspace">{atlas.representation === 'surface-model' ? <SurfaceModelWorkspace key={atlas.key + (scope?.id ?? '')} atlas={atlas} scope={scope} memory={modelMemory.current} viewKey={'primary:' + atlas.key + (scope ? ':' + scope.id : '')} startupContent={startup?.atlas_key === atlas.key ? startup.content : undefined}/> : <AtlasWorkspace key={atlas.key + (scope?.id ?? '')} atlas={atlas} scope={scope} memory={memory.current} viewKey={'primary:' + atlas.key + (scope ? ':' + scope.id : '')} startupContent={startup?.atlas_key === atlas.key ? startup.content : undefined}/>}</section>
      {comparing && second && <section className="atlas-slot" aria-label="Comparison atlas workspace">{second.representation === 'surface-model' ? <SurfaceModelWorkspace key={second.key} atlas={second} memory={modelMemory.current} viewKey={'comparison:' + second.key}/> : <AtlasWorkspace key={second.key} atlas={second} memory={memory.current} viewKey={'comparison:' + second.key}/>}</section>}
    </main> : <div className="empty">Loading the local atlas catalog…<p>Build a package and run <code>neuroimage serve --atlas path/to/manifest.json</code> to begin.</p></div>)}
  </div>
}
function AtlasWorkspace({ atlas, memory, viewKey, startupContent, scope }: { atlas: AtlasEntry; scope?: AnatomyScope; memory: Map<string, ViewState>; viewKey: string; startupContent?: unknown }) {
  const [expanded, setExpanded] = useState(false), compact = true
  const [groupOnly, setGroupOnly] = useState(!!scope?.structure_ids.length)
  const workspaceElement = useRef<HTMLElement>(null), expandButton = useRef<HTMLButtonElement>(null)
  const expansionScroll = useRef(0)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [state, setState] = useState<ViewState | null>(null), [status, setStatus] = useState('Loading package…'), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [category, setCategory] = useState('All structures')
  const [loadFailed, setLoadFailed] = useState(false)
  const [saved, setSaved] = useState(false), [ready, setReady] = useState(false), [exporting, setExporting] = useState(false)
  const [drawer, setDrawer] = useState<'library' | null>(null)
  useEffect(() => {
    if (!drawer || !matchMedia('(max-width:1100px)').matches) return
    workspaceElement.current?.querySelector('.drawer-open')?.scrollIntoView({block:'start'})
  }, [drawer])
  useEffect(() => {
    if (!expanded) return
    const previous = document.activeElement as HTMLElement | null
    expandButton.current?.focus({ preventScroll: true }); window.scrollTo(0, 0)
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault(); setDrawer(null); setExpanded(false)
      } else if (event.key === 'Tab') {
        const elements = Array.from(workspaceElement.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"], summary') ?? []).filter(element => element.getClientRects().length > 0)
        const first = elements[0], last = elements[elements.length - 1]
        if (!elements.includes(document.activeElement as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); previous?.focus({ preventScroll: true }); window.scrollTo(0, expansionScroll.current) }
  }, [expanded])
  const canvas = useRef<HTMLCanvasElement>(null), viewer = useRef<AtlasViewer | null>(null), stateRef = useRef<ViewState | null>(null), upload = useRef<HTMLInputElement>(null)
  const storageKey = `neuroimage:scene:${viewKey.startsWith('comparison:') ? 'comparison:' : ''}${atlas.key}`
  function patch(change: Partial<ViewState>) { setState(s => s ? { ...s, ...change } : s) }
  useEffect(() => { let cancelled = false
    async function load() {
      const response = await fetch(atlas.manifest_url)
      if (!response.ok) throw new Error('Could not open the local atlas manifest.')
      const m: Manifest = await response.json()
      if (!['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.8', '1.9', '1.10'].includes(m.schema_version)) throw new Error('Unsupported atlas schema version.')
      if (cancelled) return
      let initial = memory.get(viewKey) ?? initialState(m, scope)
      if (!memory.has(viewKey)) initial = anatomyEntry(initial, m, scope)
      if (!memory.has(viewKey) && startupContent !== undefined) {
        try { initial = readScene(startupContent, m).state }
        catch (error) { setError(`The selected scene could not be opened. ${String(error)}`) }
      }
      setManifest(m); setState(initial); stateRef.current = initial
      try { const saved = !!(await readBrowserContent(storageKey)); if (!cancelled) setSaved(saved) } catch { /* Saving remains optional. */ }
    }
    load().catch(e => { if (!cancelled) { setLoadFailed(true); setStatus('Source loading failed'); setError(String(e)) } })
    return () => { cancelled = true }
  }, [atlas, storageKey, memory, viewKey, startupContent, scope])
  useEffect(() => {
    if (!manifest || !canvas.current || !stateRef.current) return
    let mounted = true
    let v: AtlasViewer | undefined
    void import('./viewer').then(async ({ AtlasViewer }) => {
    if (!mounted || !canvas.current || !stateRef.current) return
    v = new AtlasViewer(canvas.current, manifest, atlas.base_url, change => {
      if (!mounted) return
      setState(s => {
        if (!s) return s
        const visible = change.selected && !s.visible.includes(change.selected) ? [...s.visible, change.selected] : s.visible
        return { ...s, ...change, visible }
      })
    }, message => mounted && setStatus(message))
    viewer.current = v
    await v.initialize(stateRef.current)
    if (mounted) setReady(true)
    }).catch(e => { if (mounted) { setLoadFailed(true); setStatus('Viewer loading failed'); setError(`Viewer: ${String(e)}`) } })
    return () => { mounted = false; v?.dispose(); viewer.current = null }
  }, [manifest, atlas.base_url])
  useEffect(() => {
    stateRef.current = state
    if (state) memory.set(viewKey, state)
    if (state && ready) viewer.current?.apply(state).catch(e => setError(String(e)))
  }, [state, ready, memory, viewKey])
  const selected = manifest?.structures.find(s => s.id === state?.selected)
  const scalarFields = manifest?.representation === 'scalar-fields'
  const imageOnly = scalarFields || manifest?.representation === 'mri-volume'
  const imageValue = state && ready ? viewer.current?.imageAt(state.position) : null
  const ctLabels = manifest?.representation === 'ct-labels'
  const imageEvidence = manifest?.volumes.find(volume => volume.id === state?.background)?.image_evidence
  const labelModel = manifest?.representation === 'label-model'
  const streamlines = manifest?.representation === 'mri-streamlines'
  const independent = manifest?.representation === 'mri-regions'
  const derivedMask = selected?.mask?.origin === 'derived-from-probability'
  const derivedMasks = manifest?.structures.some(structure => structure.mask?.origin === 'derived-from-probability')
  const probabilistic = manifest?.structures.some(s => s.probability)
  const probabilityValue = state && ready ? viewer.current?.probabilityAt(state.position, state.selected) : null
  function choose(structure: Structure) {
    if (!state) return
    patch({ selected: structure.id, selectionEvidence: { kind: 'source-target', candidates: [structure.id] }, position: structure.target_ras_mm, visible: [...new Set([...state.visible, structure.id])] })
    if (compact) setDrawer(null)
  }
  async function settled() {
    const v = viewer.current
    if (!v || !stateRef.current) throw new Error('The viewer is not ready.')
    await v.apply(stateRef.current)
    if (viewer.current !== v) throw new Error('The atlas changed before the scene was ready.')
    return { viewer: v, state: v.snapshot(stateRef.current!) }
  }
  async function save() {
    try { const current = await settled(); await saveBrowserContent(storageKey, JSON.stringify(makeScene(manifest!, current.state))); setSaved(true); setStatus('Scene saved in this browser') } catch (e) { setError(`Could not save the scene. Export a scene file if browser storage is unavailable. ${String(e)}`) }
  }
  async function sceneExport() {
    try { const current = await settled(); exportScene(manifest!, current.state) } catch (e) { setError(String(e)) }
  }
  async function restore() {
    try { const scene = readScene(JSON.parse(await readBrowserContent(storageKey) ?? 'null'), manifest!); setState(scene.state); setStatus('Saved scene restored') } catch (e) { setError(String(e)) }
  }
  async function importScene(file?: File) {
    if (!file) return
    try { if (file.size > 2 * 1024 * 1024) throw new Error('Scene file exceeds the 2 MiB limit.'); const scene = readScene(JSON.parse(await file.text()), manifest!); setState(scene.state); setStatus('Scene file restored') } catch (e) { setError(String(e)) }
    if (upload.current) upload.current.value = ''
  }
  async function screenshot() {
    setExporting(true)
    try { const current = await settled(); setStatus('Preparing image, source credits and licenses…'); await exportAtlasImage(current.viewer.capture(), manifest!, current.state, atlas.base_url); setStatus('Image export prepared') } catch (e) { setError(String(e)) }
    finally { setExporting(false) }
  }
  function locate(position: ViewState['position']) {
    const change = viewer.current?.locate(position)
    if (change && state) patch({ ...change, visible: change.selected ? [...new Set([...state.visible, change.selected])] : state.visible })
  }
  const structures = manifest?.structures.filter(s => (!groupOnly || !scope || scope.structure_ids.includes(s.id)) && (category === 'All structures' || s.category === category) && `${s.name} ${s.source_name} ${s.id}`.toLowerCase().includes(query.toLowerCase())) ?? []
  const regional = !!scope && scope.id !== 'general-anatomy'
  const backgroundIds = brainBackgroundIds(manifest?.structures ?? [], atlas.coverage)
  const surfaceBackground = !!state?.surfaceContext || (!state?.imageContext && !!backgroundIds.length)
  const background3D = state && (surfaceBackground || !labelModel) ? {
    enabled: !!state.surfaceContext?.enabled || state.imageContext,
    opacity: surfaceBackground ? state.surfaceContext?.opacity ?? .15 : state.backgroundOpacity3D ?? 1,
    toggle: (enabled: boolean) => patch(surfaceBackground
      ? { surfaceContext: { enabled, opacity: state.surfaceContext?.opacity ?? .15, structure_ids: state.surfaceContext?.structure_ids ?? backgroundIds }, imageContext: false, fitVisible3D: true, focus3D: undefined }
      : { imageContext: enabled, fitVisible3D: !enabled, focus3D: undefined, camera: [state.camera[0], state.camera[1], .8] }),
    adjust: (opacity: number) => patch(surfaceBackground
      ? { surfaceContext: { enabled: true, opacity, structure_ids: state.surfaceContext?.structure_ids ?? backgroundIds } }
      : { backgroundOpacity3D: opacity }),
  } : undefined
  return <section ref={workspaceElement} className={`workspace ${compact ? 'compact' : ''} ${expanded ? 'expanded' : ''} ${drawer ? 'showing-' + drawer : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? 'Expanded atlas viewer' : undefined}>
    <aside className={`catalog ${drawer === 'library' ? 'drawer-open' : ''}`}><div className="panel-title"><span>{imageOnly ? 'Source image' : 'Structure library'}</span><span className="count">{imageOnly ? '1' : manifest?.structures.length ?? '—'}</span>{compact && <button aria-label="Close structure library" onClick={() => setDrawer(null)}>Close</button>}</div>
      <p className="muted">Explore the anatomy in its native space.</p>{scope && !!scope.structure_ids.length && <label className="check-control anatomy-scope"><input type="checkbox" checked={groupOnly} onChange={event => setGroupOnly(event.target.checked)}/>{scope.title} only</label>}
      {imageOnly && manifest && state ? <NativeImageControls manifest={manifest} state={state} value={imageValue} ready={ready} base={atlas.base_url} patch={patch}/> : <>
      <label className="sr-only" htmlFor={viewKey + '-search'}>Search structures</label><input id={viewKey + '-search'} type="search" placeholder="Search name or structure ID…" value={query} onChange={e => setQuery(e.target.value)}/>
      <label className="sr-only" htmlFor={viewKey + '-category'}>Anatomy category</label><SelectField id={viewKey + '-category'} value={category} onChange={e => setCategory(e.target.value)}>{['All structures', ...new Set(manifest?.structures.map(s => s.category))].map(c => <option key={c}>{c}</option>)}</SelectField>
      <div className="library-actions"><button onClick={() => state && patch({ visible: selected ? [selected.id] : [] })} disabled={!ready}>Isolate selected</button><button onClick={() => patch({ visible: [] })} disabled={!ready}>Hide all</button></div>
      <StructureVisibilityActions structures={structures} visible={state?.visible ?? []} disabled={!ready} onChange={visible => patch({ visible })}/>
      <details className="surface-context-controls"><summary>{streamlines ? '3D bundle context' : 'Surface context'} · {structures.length} matches</summary><p className="small muted">Apply to the current search and category. Only 3D opacity changes.</p><div className="button-row"><button disabled={!ready || !structures.length} onClick={() => state && patch({ surfaceOpacity: setSurfaceOpacity(state, structures.map(s => s.id), .2) })}>Translucent matches</button><button disabled={!ready || !structures.length} onClick={() => state && patch({ surfaceOpacity: setSurfaceOpacity(state, structures.map(s => s.id), 1) })}>Opaque matches</button></div><button disabled={!ready} onClick={() => patch({ surfaceOpacity: {}, meshOpacity: 1 })}>Reset surface opacities</button></details>
      <div className="structure-list" aria-label="Anatomical structures">
        {structures.map(s => <div key={s.id} className={`structure-row ${s.id === state?.selected ? 'selected' : ''}`}>
          <input type="checkbox" aria-label={`Show ${s.name}`} checked={state?.visible.includes(s.id) ?? false} disabled={!ready} onChange={e => state && patch({ visible: e.target.checked ? [...state.visible, s.id] : state.visible.filter(id => id !== s.id) })}/>
          <button onClick={() => choose(s)} disabled={!ready} title={s.id}><span className="structure-color" style={{ background: `rgb(${s.color.join(',')})` }}/><span>{s.name}<small>{s.laterality} · {s.category}</small></span></button>
        </div>)}
        {!structures.length && <p className="muted">Try another structure name or category.</p>}
      </div>
      </>}
      {selected && <details className="source-details"><summary>Selected structure details</summary>
        <h2>{selected.name}</h2><p>{selected.laterality} · {selected.category}</p>
        <p className="evidence">{selected.evidence}</p>
        {selected.kind === 'streamline-bundle' ? <><p>{selected.streamlines.source_streamline_count.toLocaleString()} source trajectories · {selected.streamlines.source_point_count.toLocaleString()} retained vertices</p><a href={atlas.base_url + selected.streamlines.levels.find(level => level.id === 'full')!.file} download>Download complete source trajectories (TCK)</a></> : <p>{(selected.volume_mm3 / 1000).toFixed(2)} mL · {selected.voxel_count.toLocaleString()} source label or mask voxels</p>}
        <p>Source definition: {selected.source_name}</p><code className="break-word">{selected.id}</code>
        {selected.source_notes.map((note, index) => <p key={index}>{note}</p>)}
        {selected.probability && <><p>{selected.probability.interpretation}</p><p>{selected.probability.derivation}</p></>}
      </details>}
      <div className="catalog-footer"><span className="status-dot"/>{imageOnly ? 'Original source samples' : <>{state?.visible.length ?? 0} visible · {streamlines ? 'Trajectories' : 'Surfaces'} load on demand</>}</div>
    </aside>
    <section className="viewer-column">
      <div className="workspace-heading"><h1>{scope?.title ?? manifest?.title ?? 'Opening atlas'}</h1></div>
      {compact && <div className="compact-toolbar"><button aria-expanded={drawer === 'library'} onClick={() => setDrawer(drawer === 'library' ? null : 'library')}>Structure library</button><span className="compact-selection">{selected?.name ?? (scalarFields ? 'Native statistical field observation' : imageOnly ? 'Native source image observation' : streamlines ? 'Choose a displayed trajectory' : 'Source background at cursor')}</span></div>}
      <div className="view-toolbar"><label>{labelModel ? 'Model' : scalarFields ? 'Field' : 'Image'}<SelectField aria-label={labelModel ? 'Reference model' : scalarFields ? 'Scalar field' : ctLabels ? 'CT image' : 'MRI contrast'} value={state?.background ?? ''} disabled={!ready} onChange={e => { const image = manifest!.volumes.find(v => v.id === e.target.value)!; patch({ background: image.id, window: [image.cal_min, image.cal_max] }) }}>{manifest?.volumes.filter(v => v.kind === (labelModel ? 'labels' : scalarFields ? 'scalar' : 'image')).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</SelectField></label>
        <button className="expand-view" ref={expandButton} aria-pressed={expanded} disabled={!ready} onClick={() => { if (!expanded) expansionScroll.current = window.scrollY; setDrawer(null); setExpanded(value => !value) }}>{expanded ? 'Exit expanded view' : 'Expand viewer'}</button>
        <label>Layout<SelectField aria-label="View layout" value={state?.layout ?? 'quad'} disabled={!ready} onChange={e => patch({ layout: e.target.value as ViewState['layout'] })}>{[['quad', '2D + 3D'], ['anatomy', 'Equal 2D + 3D'], ['axial', 'Axial'], ['coronal', 'Coronal'], ['sagittal', 'Sagittal'], ['3d', '3D anatomy']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</SelectField></label>
        {state?.layout === 'quad' && <label>Panels<SelectField aria-label="Image panel arrangement" value={state.tileLayout ?? 'grid'} disabled={!ready} onChange={event => patch({tileLayout:event.target.value as ViewState['tileLayout']})}><option value="auto">Fit window</option><option value="grid">2 × 2 grid</option><option value="row">Side by side</option></SelectField></label>}
        <label className="check-control"><input type="checkbox" checked={state?.radiological ?? true} onChange={e => patch({ radiological: e.target.checked })} disabled={!ready}/>Radiological</label>
        <button onClick={() => manifest && state && setState({ ...anatomyEntry(initialState(manifest, scope), manifest, scope), note: state.note, annotations: state.annotations })} disabled={!ready}>Reset view</button>
      </div>
      <div className="section-navigation" role="group" aria-label="Section field of view">
        <button disabled={!ready} onClick={() => patch({ pan: [0, 0, 0, 1] })}>Full sections</button>
        <button disabled={!ready} onClick={() => state && manifest && patch({ pan: centeredSlicePan(manifest.volumes.find(v => v.id === state.background)!, state.position, Math.max(3, state.pan[3])) })}>Magnify at cursor</button>
        <label title="1× shows the complete source field of view; higher zoom centers on the cursor">2D zoom<input aria-label="2D zoom" type="range" min="1" max="10" step=".1" value={state?.pan[3] ?? 1} onChange={e => { const zoom = Number(e.target.value); if (state && manifest) patch({ pan: zoom === 1 ? [0, 0, 0, 1] : centeredSlicePan(manifest.volumes.find(v => v.id === state.background)!, state.position, zoom) }) }} disabled={!ready}/><output aria-label="2D zoom factor">{(state?.pan[3] ?? 1).toFixed(1)}×</output></label>
      </div>
      {scalarFields && manifest && state && <div className="evidence scalar-field-summary">{(() => { const field=manifest.volumes.find(v=>v.id===state.background)!; return `${field.name} · ${field.scalar!.units} · display ${state.window.join(" to ")} · no reference MRI`; })()}</div>}
      <div className="canvas-shell"><canvas ref={canvas} aria-label={scalarFields ? 'Linked scalar field sections and three-dimensional intensity display' : labelModel ? 'Linked categorical model sections and three-dimensional anatomy' : ctLabels ? 'Linked CT slices and three-dimensional anatomy' : 'Linked MRI slices and three-dimensional anatomy'} tabIndex={0}/>{!ready && <div className="loading" role="status">{status}{loadFailed && <button onClick={() => window.location.reload()}>Reload viewer</button>}</div>}</div>
      <div className="coordinate-bar"><span>RAS · mm</span>{['R', 'A', 'S'].map((axis, i) => <label key={axis}>{axis}<input aria-label={`${axis} coordinate in millimeters`} type="number" step="1" value={Number((state?.position[i] ?? 0).toFixed(2))} disabled={!ready} onChange={e => { const value = Number(e.target.value); if (state && Number.isFinite(value)) { const position = [...state.position] as ViewState['position']; position[i] = value; locate(position) } }}/></label>)}<span className="coordinate-status">{selected?.name ?? (scalarFields ? 'Native statistical field observation' : imageOnly ? 'Native source image observation' : streamlines ? 'Choose a displayed trajectory' : 'Source background at cursor')}</span></div>
      <div className="display-controls">{!imageOnly && <label>{streamlines ? 'Section trajectories' : labelModel ? 'Model section opacity' : state?.overlay === 'probability' ? 'Probability opacity' : independent ? 'Selected mask opacity' : 'Label overlay'}<input aria-label={streamlines ? 'Streamline section opacity' : 'Label opacity'} type="range" min="0" max="1" step=".05" value={state?.labelOpacity ?? .45} onChange={e => patch({ labelOpacity: Number(e.target.value) })} disabled={!ready}/></label>}
        {probabilistic && <label>2D evidence<SelectField aria-label="Evidence overlay" value={state?.overlay ?? 'labels'} onChange={e => patch({ overlay: e.target.value as ViewState['overlay'] })} disabled={!ready}><option value="probability">Selected probability channel</option><option value={independent ? "mask" : "labels"}>{independent ? (derivedMask ? "Project display mask" : "Selected binary mask") : "Source navigation labels"}</option></SelectField></label>}
        {!imageOnly && <label>{streamlines ? '3D trajectory opacity' : 'Surface opacity'}<input aria-label={streamlines ? '3D trajectory opacity' : 'Surface opacity'} type="range" min="0" max="1" step=".05" value={state?.meshOpacity ?? 1} onChange={e => patch({ meshOpacity: Number(e.target.value) })} disabled={!ready}/></label>}
        <label title="Magnifies the displayed source geometry">3D zoom<input aria-label="3D zoom" type="range" min=".1" max="20" step=".01" value={state?.camera[2] ?? 2} onChange={e => state && patch({ fitVisible3D: false, camera: [state.camera[0], state.camera[1], Number(e.target.value)] })} disabled={!ready}/><output aria-label="3D zoom factor">{(state?.camera[2] ?? 2).toFixed(2)}×</output></label>
        {!imageOnly && <label className="check-control"><input type="checkbox" aria-label="Fit visible 3D" checked={state?.fitVisible3D ?? state?.layout === 'anatomy'} disabled={!ready || !!state?.imageContext} onChange={event => patch({ fitVisible3D: event.target.checked })}/>Fit visible 3D</label>}
        <button disabled={!ready || !selected} onClick={() => state && selected && manifest && patch({ ...focusStructure3D(selected, manifest.volumes.find(volume => volume.id === state.background)!, state.camera), fitVisible3D: false })}>Focus selected 3D</button>
        <button disabled={!ready} onClick={() => state && patch({ fitVisible3D: false, focus3D: [...state.position] })}>Center 3D on cursor</button>
        <button disabled={!ready} onClick={() => state && patch({ fitVisible3D: false, focus3D: undefined, camera: [state.camera[0], state.camera[1], .8] })}>Full 3D context</button>
        {!regional && !labelModel && <label className="check-control"><input type="checkbox" checked={state?.imageContext ?? false} onChange={e => patch({ imageContext: e.target.checked })} disabled={!ready}/>{imageOnly ? '3D intensity display' : ctLabels ? '3D CT context' : '3D MRI context'}</label>}
      </div>
      {regional && state && <BackgroundControls title={backgroundIds.length ? 'Whole-brain background' : 'Source background'} disabled={!ready}
        image={{enabled: state.background2D !== false, opacity: state.backgroundOpacity2D ?? 1,
          toggle: enabled => patch({background2D: enabled}), adjust: opacity => patch({backgroundOpacity2D: opacity})}}
        model={background3D} unavailable={!background3D ? 'Whole-brain 3D context is unavailable in this source.' : undefined}/>}
      <details className="section-guide-controls"><summary>3D section guides{state?.sectionPlanes?.length ? ` · ${state.sectionPlanes.length} shown` : ''}</summary><div role="group" aria-label="3D section guides">{SECTION_PLANES.map(plane => <label key={plane} className="check-control"><input type="checkbox" aria-label={`Show ${plane} guide`} checked={state?.sectionPlanes?.includes(plane) ?? false} disabled={!ready} onChange={event => patch({ sectionPlanes: event.target.checked ? [...(state?.sectionPlanes ?? []), plane] : state?.sectionPlanes?.filter(value => value !== plane) })}/><span style={{ color: `rgb(${PLANE_COLORS[plane].map(value => Math.round(value * 255)).join(',')})` }}>{plane[0].toUpperCase() + plane.slice(1)}</span></label>)}</div><p className="small muted">Colored planes mark the current RAS sections within the source image field of view. The linked image panels show the corresponding source image texture.</p></details>
      {probabilistic && <div className="probability-evidence"><div><strong>{state?.overlay === 'probability' ? 'Source probability' : independent ? (derivedMask ? 'Project display mask' : 'Selected binary mask') : 'Source navigation labels'}</strong><span>{selected?.name ?? 'Select a channel'}</span>{state?.overlay === 'probability' && <output aria-label="Source probability at cursor">{formatProbability(probabilityValue, selected?.probability)}</output>}</div>
        {state?.overlay === 'probability' && <div className="probability-scale"><span>{probabilityScale(selected?.probability)[0]}</span><i/><span>{probabilityScale(selected?.probability)[1]}</span></div>}
        <p>{state?.overlay === 'probability' ? 'Moving the cursor samples the selected channel. Choose a structure to change channels. ' : ''}{manifest && probabilityNavigationDescription(manifest.build)}</p>{selected?.probability && <p>{selected.probability.derivation}</p>}</div>}
      {independent && state && state.selectionEvidence?.kind === 'independent-mask' && <div className="independent-memberships" aria-label="Independent region memberships"><strong>Mask membership at cursor</strong><p className="small muted">{state.selectionEvidence.candidates.length} visible mask fields contain the nearest native voxel. Selecting a region changes the evidence field at this location.</p><div className="button-row">{state.selectionEvidence.candidates.map(id => <button key={id} disabled={!ready || id === state.selected} onClick={() => patch({ selected: id })}>{manifest?.structures.find(s => s.id === id)?.name}</button>)}</div></div>}
      {streamlines && manifest && state && <StreamlineControls manifest={manifest} state={state} ready={ready} patch={patch}/>}
      <details className="anatomy-display-details"><summary>Surface display and cursor</summary>
      {state && <div className="cursor-display-control"><label className="check-control"><input type="checkbox" aria-label="Show 3D cursor" checked={state.show3DCursor !== false} disabled={!ready} onChange={event => patch({show3DCursor: event.target.checked})}/>Show 3D cursor</label><p className="small muted">Hide this guide when it covers a small structure. Slice cursors and the physical location stay unchanged.</p></div>}
      {!imageOnly && !streamlines && state && <SurfaceCutawayControls state={state} matches={structures.map(s => s.id)} ready={ready} patch={patch}/>}
      {selected && state && <details className="selected-surface-control"><summary>{streamlines ? 'Selected bundle display' : 'Selected surface display'}</summary><label>Opacity multiplier<input aria-label="Selected surface opacity" type="range" min="0" max="1" step=".05" value={state.surfaceOpacity?.[selected.id] ?? 1} onChange={e => patch({ surfaceOpacity: setSurfaceOpacity(state, [selected.id], Number(e.target.value)) })} disabled={!ready}/></label><output aria-label="Selected effective surface opacity">{Math.round(surfaceOpacity(state, selected.id) * 100)}% effective opacity</output><p className="small muted">Multiplied by the overall 3D opacity. The 2D section display and source geometry are unchanged.</p></details>}
      </details>
      {manifest && <details className="source-details"><summary>Sources and coordinates</summary><dl><dt>Representation</dt><dd>{scalarFields ? 'Original statistical fields in their native source grid' : imageOnly ? 'Original native MRI and source-intensity rendering' : streamlines ? 'Reference MRI and source computational streamline bundles' : labelModel ? 'Categorical label model · Original source tissue classes' : independent ? (derivedMasks ? 'Source MRI and probabilities with explicitly derived display masks' : 'Source MRI, independent probabilities and overlapping source masks') : probabilistic ? 'Source MRI, probability evidence and categorical navigation labels' : ctLabels ? 'Original temporal-bone CT and source fluid-space labels' : 'Measured MRI and source labels'}</dd><dt>Native space</dt><dd>{manifest.space.name}</dd><dt>Package version</dt><dd><code>{manifest.package_version}</code></dd></dl><p className="evidence">{manifest.space.correspondence}</p>{imageEvidence && <section aria-label="Image acquisition evidence"><h3>{imageEvidence.modality} acquisition and sampling</h3><p>{imageEvidence.acquisition}</p><p>{imageEvidence.sampling}</p><p>{imageEvidence.intensity_units}. {imageEvidence.calibration}</p><p className="small muted">Original source array: <code>{imageEvidence.source_dataset}</code></p></section>}<details><summary>Source coverage and interpretation</summary>{[...new Set([...manifest.validation.warnings.filter(warning => !/expert review|anatomical review|unreviewed/i.test(warning)), ...(manifest.build.recipe?.scope_notes ?? [])])].map((warning, index) => <p className="small muted" key={index}>{warning}</p>)}</details>{manifest.sources.map(s => <section key={s.id} className="source"><h3>{s.title}</h3><p>{s.citation}</p><a href={s.url} target="_blank" rel="noreferrer">Official source ↗</a><p><a href={atlas.base_url + s.license_file} target="_blank" rel="noreferrer">{s.license_name} · local license</a></p></section>)}<p className="small muted">Each source retains its native coordinates. Use the comparison panels to inspect source definitions side by side. Exported images include licenses, source versions and processing records.</p></details>}
      <div className="scene-toolbar"><button onClick={save} disabled={!ready}>Save scene</button><button onClick={restore} disabled={!ready || !saved}>Restore saved</button><button onClick={sceneExport} disabled={!ready || exporting}>Export scene</button><button onClick={() => upload.current?.click()} disabled={!ready}>Import scene</button><button className="primary" onClick={screenshot} disabled={!ready || exporting}>Export image</button><input ref={upload} aria-label="Import scene file" type="file" accept=".json,application/json" hidden onChange={e => importScene(e.target.files?.[0])}/></div>
      <p className="interaction-hint">Click slices to locate · Scroll to move through slices · Drag 3D to rotate · Double-click {imageOnly ? 'the intensity view for approximate volume location' : streamlines ? 'a trajectory to locate' : 'a surface to locate'}{!labelModel && ' · Right-drag slices to adjust contrast'}</p>
      <div className="live-status" role="status">{ready ? status : ""}</div>
      {error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    </section>
  </section>
}
