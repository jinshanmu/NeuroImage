import { SelectField } from './SelectField'
import { FrameRange } from './FrameRange'
import { StructureVisibilityActions } from './StructureVisibilityActions'
import { LibrarySectionSelect } from './LibrarySectionSelect'
import { BACKGROUND_STRUCTURES, CURRENT_GROUP, librarySectionStructures } from './librarySections'
import { BackgroundControls } from './BackgroundControls'
import { brainBackgroundIds, reserveBrainBackground } from './atlasBackground'
import { centeredSlicePan } from './independentRegions'
import { navigate, normalizeBrowseLocation } from './appNavigation'
import { anatomyGroup, browseTargets, targetScope, viewerComparisonTargets, viewerSourceTargets } from './anatomyNavigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AtlasViewer } from './viewer'
import { ViewerLifecycle } from './viewerLifecycle'
import { initialState, readScene } from './scene'
import { formatProbability, probabilityNavigationDescription, probabilityScale } from './probability'
import { StreamlineControls } from './StreamlineControls'
import { NativeImageControls } from './NativeImageControls'
import { SurfaceCutawayControls } from './SurfaceCutawayControls'
import { cursorCutaway } from './cutaway'
import { atlasDisplayView, viewZoom3D, zoomFactor } from './display'
import { SECTION_PLANES } from './sectionPlanes'
import { AnatomyHome } from './AnatomyHome'
import { useAnatomyLibrary } from './useAnatomyLibrary'
import { SurfaceModelWorkspace } from './SurfaceModelWorkspace'
import { initialModelView } from './modelScene'
import type { ModelView, SurfaceManifest } from './modelTypes'
import type { AnatomyScope } from './anatomyNavigation'
import { anatomyEntry } from './anatomyEntry'
import { locateSourceStructure } from './navigation'
import { datasetOptionName } from './datasetFamilies'
import type { AtlasEntry, Manifest, Structure, ViewState } from './types'

export default function App() {
  const header = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = header.current
    if (!element) return
    const update = () => element.parentElement?.style.setProperty('--app-header-height', `${element.getBoundingClientRect().height}px`)
    const observer = new ResizeObserver(update)
    update()
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const [atlases, setAtlases] = useState<AtlasEntry[]>([]), [active, setActive] = useState(''), [error, setError] = useState('')
  const [comparing, setComparing] = useState(false), [comparison, setComparison] = useState('')
  const [startup, setStartup] = useState<{ atlas_key: string; content: unknown } | null>(null)
  const [home, setHome] = useState(true), [dataset, setDataset] = useState<string | null>(null)
  const [homeGroup, setHomeGroup] = useState<string | null>(null)
  const [scope, setScope] = useState<AnatomyScope | undefined>()
  const [switchingSource, setSwitchingSource] = useState(false)
  const sourceRequest = useRef<AbortController | null>(null)
  const [switchingComparison, setSwitchingComparison] = useState(false)
  const comparisonRequest = useRef<AbortController | null>(null)
  const [workspaceEnabled, setWorkspaceEnabled] = useState(false)
  const library = useAnatomyLibrary(workspaceEnabled)
  const [routeVisit, setRouteVisit] = useState(0), [loadingCatalog, setLoadingCatalog] = useState(true)
  const memory = useRef(new Map<string, ViewState>())
  const modelMemory = useRef(new Map<string, ModelView>())
  const updateAtlases = useCallback((next: AtlasEntry[]) => setAtlases(previous => next.map(entry => {
    const current = previous.find(item => item.key === entry.key)
    return current && JSON.stringify(current) === JSON.stringify(entry) ? current : entry
  })), [])
  useEffect(() => () => { sourceRequest.current?.abort(); comparisonRequest.current?.abort() }, [])
  useEffect(() => {
    const restoreRoute = () => setRouteVisit(value => value + 1)
    window.addEventListener('popstate', restoreRoute)
    return () => window.removeEventListener('popstate', restoreRoute)
  }, [])
  useEffect(() => {
    let cancelled = false
    sourceRequest.current?.abort(); setSwitchingSource(false)
    comparisonRequest.current?.abort(); setSwitchingComparison(false)
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
      let requestedScope: AnatomyScope | undefined
      if (requestedEntry && requestedGroup) {
        try {
          requestedScope = targetScope(requestedGroup, browseTargets([requestedEntry])[0])
        } catch (error) {
          // Old bookmarks may name a group whose coverage has since been
          // corrected. Keep the exact source accessible in its own scope.
          const sourceUrl = new URL(location.href)
          sourceUrl.searchParams.delete('group')
          history.replaceState(null, '', sourceUrl.pathname + sourceUrl.search + sourceUrl.hash)
          setError(String(error) + ' The source is open with its original coverage.')
        }
      }
      setScope(requestedScope)
      setDataset(parameters.get('dataset'))
      setHomeGroup(parameters.get('view') === 'anatomy' ? parameters.get('group') : null)
      setWorkspaceEnabled(!!data.workspace); setHome(!selected && !requestedEntry)
      setStartup(selected); updateAtlases(data.atlases)
      setActive(selected?.atlas_key ?? requestedEntry?.key ?? data.atlases[0]?.key ?? '')
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
    updateAtlases(data.atlases); setActive(key)
    setHome(false); setScope(anatomyScope); setStartup(null); setError('')
    navigate({ view: 'atlas', atlas: key, group: anatomyScope?.id })
  }, [updateAtlases])
  function openAnatomyHome() {
    sourceRequest.current?.abort(); setSwitchingSource(false)
    setHome(true); setDataset(null); setHomeGroup(null); setError('')
    navigate({ view: 'anatomy' })
  }
  const sourceChoices = useMemo(() => viewerSourceTargets(atlases, library.snapshot?.packages, active, scope),
    [atlases, library.snapshot, active, scope])
  async function switchSource(key: string) {
    const target = sourceChoices.find(item => item.key === key)
    if (!target || key === active) return
    sourceRequest.current?.abort()
    const controller = new AbortController(); sourceRequest.current = controller
    setSwitchingSource(true); setError('')
    try {
      const group = scope ? anatomyGroup(scope.id) : undefined
      if (scope && !group) throw Error('The selected anatomy category is unavailable.')
      const nextScope = group ? targetScope(group, target) : undefined
      let nextKey = target.key
      if (!target.active) {
        const response = await fetch('/api/workspace/atlases/' + encodeURIComponent(nextKey), { signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw Error(result.error ?? 'The local atlas could not be opened.')
        nextKey = result.atlas_key
      }
      controller.signal.throwIfAborted()
      await openWorkspaceAtlas(nextKey, undefined, nextScope, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) setError(String(error))
    } finally {
      if (sourceRequest.current === controller) setSwitchingSource(false)
    }
  }
  const atlas = atlases.find(a => a.key === active)
  const comparisonChoices = useMemo(() => viewerComparisonTargets(atlases, library.snapshot?.packages, active, scope, comparison),
    [atlases, library.snapshot, active, scope, comparison])
  const comparisonTarget = comparisonChoices.find(target => target.key === comparison) ?? comparisonChoices[0]
  const second = atlases.find(entry => entry.key === comparisonTarget?.key)
  const comparisonGroupId = scope?.id
  const comparisonScope = useMemo(() => {
    const group = anatomyGroup(comparisonGroupId ?? null)
    return group && comparisonTarget ? targetScope(group, comparisonTarget) : undefined
  }, [comparisonGroupId, comparisonTarget?.key, comparisonTarget?.coverage, comparisonTarget?.detail_coverage])
  const comparisonVisible = comparing && comparisonChoices.length > 0
  useEffect(() => {
    if (!comparisonChoices.length) setComparing(false)
  }, [comparisonChoices.length])
  useEffect(() => {
    comparisonRequest.current?.abort()
    if (!comparisonVisible || home || loadingCatalog || !comparisonTarget || comparisonTarget.active) {
      setSwitchingComparison(false)
      return
    }
    const controller = new AbortController(); comparisonRequest.current = controller
    const key = comparisonTarget.key, datasetId = comparisonTarget.dataset_id
    setSwitchingComparison(true); setError('')
    async function openComparison() {
      const response = await fetch('/api/workspace/atlases/' + encodeURIComponent(key), { signal: controller.signal })
      const value = await response.json()
      if (!response.ok) throw Error(value.error ?? 'The comparison atlas could not be opened.')
      const catalog = await fetch('/api/atlases', { signal: controller.signal })
      if (!catalog.ok) throw Error('The local atlas catalog is unavailable.')
      const data = await catalog.json()
      if (!data.atlases.some((entry: AtlasEntry) => entry.key === key && entry.dataset_id === datasetId))
        throw Error('The selected comparison source is unavailable.')
      controller.signal.throwIfAborted()
      updateAtlases(data.atlases)
    }
    void openComparison().catch(error => {
      if (!controller.signal.aborted) { setError(String(error)); setComparing(false) }
    }).finally(() => {
      if (comparisonRequest.current === controller) setSwitchingComparison(false)
    })
    return () => controller.abort()
  }, [comparisonVisible, home, loadingCatalog, comparisonTarget?.key, comparisonTarget?.active, updateAtlases])
  const locatingAtlas = loadingCatalog && new URLSearchParams(location.search).get('view') === 'atlas'
  return <div className={`app ${comparisonVisible && !home ? 'comparing' : ''}`}>
    <header ref={header} className="app-header"><a className="brand" href="/?view=anatomy" aria-label="NeuroImage home" onClick={event => { event.preventDefault(); openAnatomyHome() }}><span className="brand-mark">N</span><span>NeuroImage<small>NEUROANATOMY WORKSPACE</small></span></a>
      {!home && <div className="dataset-picker"><label htmlFor="atlas">Source</label><SelectField id="atlas" value={active} disabled={switchingSource || loadingCatalog} aria-busy={switchingSource} onChange={e => { void switchSource(e.target.value) }}>{sourceChoices.map(target => <option key={target.key} value={target.key}>{datasetOptionName(target)}</option>)}</SelectField></div>}
      {!home && <label className="check-control"><input type="checkbox" checked={comparisonVisible} disabled={!atlas || !comparisonChoices.length || loadingCatalog} onChange={e => setComparing(e.target.checked)}/>Compare sources</label>}
      {comparisonVisible && !home && <div className="dataset-picker comparison-picker"><label htmlFor="comparison-atlas">Compare with</label><SelectField id="comparison-atlas" value={comparisonTarget?.key ?? ''} disabled={switchingComparison || loadingCatalog} aria-busy={switchingComparison} onChange={e => setComparison(e.target.value)}>{comparisonChoices.map(target => <option key={target.key} value={target.key}>{datasetOptionName(target)}</option>)}</SelectField></div>}
      <div className="header-note header-version"><span className="version">v{__NEUROIMAGE_VIEWER__.version}</span></div>
    </header>
    {loadingCatalog && !locatingAtlas && <p role="status" className="catalog-status">Loading</p>}
    {locatingAtlas && <main className="atlas-opening"><div className="canvas-shell" aria-busy="true"><div className="atlas-loading" role="status">Loading</div></div></main>}
    {error && <div role="alert" className="error">{error}<button onClick={() => setRouteVisit(value => value + 1)}>Retry</button></div>}
    {home && !loadingCatalog && (!error || atlases.length > 0) && <AnatomyHome atlases={atlases} workspace={workspaceEnabled} library={library} dataset={dataset} group={homeGroup} onGroup={value => { setHomeGroup(value); navigate({ view: 'anatomy', dataset: dataset ?? undefined, group: value ?? undefined }) }} onDataset={value => { setDataset(value); setHomeGroup(null); navigate({ view: 'anatomy', dataset: value ?? undefined }) }} onOpen={openWorkspaceAtlas}/>}
    {!home && !locatingAtlas && (atlas ? <main className={`workspace-pair ${comparisonVisible ? 'comparison-active' : ''}`}>
      <section className="atlas-slot" aria-label="Primary atlas workspace">{atlas.representation === 'surface-model' ? <SurfaceModelWorkspace key={atlas.key + (scope?.id ?? '')} atlas={atlas} scope={scope} memory={modelMemory.current} viewKey={'primary:' + atlas.key + (scope ? ':' + scope.id : '')} startupContent={startup?.atlas_key === atlas.key ? startup.content : undefined}/> : <AtlasWorkspace key={atlas.key + (scope?.id ?? '')} atlas={atlas} scope={scope} memory={memory.current} viewKey={'primary:' + atlas.key + (scope ? ':' + scope.id : '')} startupContent={startup?.atlas_key === atlas.key ? startup.content : undefined}/>}</section>
      {comparisonVisible && <section className="atlas-slot" aria-label="Comparison atlas workspace">{second ? second.representation === 'surface-model' ? <SurfaceModelWorkspace key={second.key + (comparisonScope?.id ?? '')} atlas={second} scope={comparisonScope} memory={modelMemory.current} viewKey={'comparison:' + second.key + (comparisonScope ? ':' + comparisonScope.id : '')}/> : <AtlasWorkspace key={second.key + (comparisonScope?.id ?? '')} atlas={second} scope={comparisonScope} memory={memory.current} viewKey={'comparison:' + second.key + (comparisonScope ? ':' + comparisonScope.id : '')}/> : <div className="canvas-shell" aria-busy="true"><div className="atlas-loading" role="status">Loading</div></div>}</section>}
    </main> : <div className="empty">No local atlas is available.</div>)}
  </div>
}
function AtlasWorkspace({ atlas, memory, viewKey, startupContent, scope }: { atlas: AtlasEntry; scope?: AnatomyScope; memory: Map<string, ViewState>; viewKey: string; startupContent?: unknown }) {
  const compact = true
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [state, setState] = useState<ViewState | null>(null), [status, setStatus] = useState('Loading package…'), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [category, setCategory] = useState(CURRENT_GROUP)
  const [loadFailed, setLoadFailed] = useState(false)
  const [readySource, setReadySource] = useState<{ manifest: Manifest; base: string } | null>(null)
  const ready = !!manifest && readySource?.manifest === manifest && readySource.base === atlas.base_url
  const [drawer, setDrawer] = useState<'library' | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null), viewer = useRef<AtlasViewer | null>(null), stateRef = useRef<ViewState | null>(null)
  const lifecycle = useRef<ViewerLifecycle<ViewState> | null>(null)
  const scopeKey = useMemo(() => JSON.stringify(scope ?? null), [scope])
  const coverageKey = useMemo(() => JSON.stringify(atlas.coverage ?? []), [atlas.coverage])
  const backgroundMode = useRef<'surface' | 'volume'>('volume')
  function patch(change: Partial<ViewState>) { setState(s => {
    if (!s) return s
    const next = { ...s, ...change }
    return { ...next, surfaceCutaway: cursorCutaway(next.surfaceCutaway, next.position) }
  }) }
  useEffect(() => {
    const controller = new AbortController()
    setReadySource(null); setLoadFailed(false); setError(''); setStatus('Loading package…')
    async function load() {
      const response = await fetch(atlas.manifest_url, { signal: controller.signal })
      if (!response.ok) throw new Error('Could not open the local atlas manifest.')
      const m: Manifest = await response.json()
      if (!['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.8', '1.9', '1.10'].includes(m.schema_version)) throw new Error('Unsupported atlas schema version.')
      if (controller.signal.aborted) return
      let initial = memory.get(viewKey) ?? initialState(m, scope)
      if (!memory.has(viewKey)) initial = anatomyEntry(initial, m, scope)
      if (!memory.has(viewKey) && startupContent !== undefined) {
        try { initial = readScene(startupContent, m).state }
        catch (error) { setError(`The selected scene could not be opened. ${String(error)}`) }
      }
      initial = atlasDisplayView(initial)
      initial = reserveBrainBackground(initial, brainBackgroundIds(m.structures, atlas.coverage))
      // Retain the source/scene's background kind while its slider crosses zero.
      backgroundMode.current = initial.imageContext ? 'volume'
        : initial.surfaceContext || brainBackgroundIds(m.structures, atlas.coverage).length ? 'surface' : 'volume'
      setManifest(m); setState(initial); stateRef.current = initial
    }
    load().catch(e => { if (!controller.signal.aborted) { setLoadFailed(true); setStatus('Source loading failed'); setError(String(e)) } })
    return () => controller.abort()
    // Catalog refreshes can replace equivalent objects without changing this source.
  }, [atlas.manifest_url, memory, viewKey, startupContent, scopeKey, coverageKey])
  useEffect(() => {
    if (!manifest || !canvas.current || !stateRef.current) return
    let mounted = true
    let v: AtlasViewer | undefined
    let session: ViewerLifecycle<ViewState> | undefined
    setReadySource(null)
    void import('./viewer').then(async ({ AtlasViewer }) => {
    if (!mounted || !canvas.current || !stateRef.current) return
    v = new AtlasViewer(canvas.current, manifest, atlas.base_url, change => {
      if (!mounted) return
      setState(s => {
        if (!s) return s
        const visible = change.visible ?? s.visible
        const next = { ...s, ...change, visible }
        return { ...next, surfaceCutaway: cursorCutaway(next.surfaceCutaway, next.position) }
      })
    }, message => mounted && setStatus(message))
    viewer.current = v
    session = new ViewerLifecycle(v)
    lifecycle.current = session
    const initialized = await session.initialize(stateRef.current)
    if (mounted && initialized) setReadySource({ manifest, base: atlas.base_url })
    }).catch(e => { if (mounted) { setLoadFailed(true); setStatus('Viewer loading failed'); setError(`Viewer: ${String(e)}`) } })
    return () => {
      mounted = false
      session?.dispose()
      if (lifecycle.current === session) lifecycle.current = null
      if (viewer.current === v) viewer.current = null
    }
  }, [manifest, atlas.base_url])
  useEffect(() => {
    stateRef.current = state
    if (state) memory.set(viewKey, state)
    const session = lifecycle.current
    if (state && session) session.apply(state).catch(e => { if (session.active && lifecycle.current === session) setError(String(e)) })
  }, [state, ready, memory, viewKey])
  const selected = manifest?.structures.find(s => s.id === state?.selected)
  const cursorStructure = manifest?.structures.find(s => s.id === (state && ready ? viewer.current?.cursorStructureAt(state.position) : state?.selected))
  const scalarFields = manifest?.representation === 'scalar-fields'
  const imageOnly = scalarFields || manifest?.representation === 'mri-volume'
  const imageValue = state && ready ? viewer.current?.imageAt(state.position) : null
  const ctLabels = manifest?.representation === 'ct-labels'
  const labelModel = manifest?.representation === 'label-model'
  const streamlines = manifest?.representation === 'mri-streamlines'
  const independent = manifest?.representation === 'mri-regions'
  const derivedMask = selected?.mask?.origin === 'derived-from-probability'
  const probabilistic = manifest?.structures.some(s => s.probability)
  const probabilityValue = state && ready ? viewer.current?.probabilityAt(state.position, state.selected) : null
  function choose(structure: Structure) {
    if (!state) return
    viewer.current?.setCursorStructure(structure.target_ras_mm, structure.id)
    patch({ selected: structure.id, selectionEvidence: { kind: 'source-target', candidates: [structure.id] }, position: structure.target_ras_mm, visible: [...new Set([...state.visible, structure.id])] })
  }
  function locate(position: ViewState['position']) {
    const change = viewer.current?.locateCursor(position)
    if (change && state) patch(change)
  }
  function resetView() {
    if (!manifest || !state) return
    setCategory(CURRENT_GROUP)
    const initial = reserveBrainBackground(anatomyEntry(initialState(manifest, scope), manifest, scope), brainBackgroundIds(manifest.structures, atlas.coverage))
    backgroundMode.current = initial.imageContext ? 'volume'
      : initial.surfaceContext || brainBackgroundIds(manifest.structures, atlas.coverage).length ? 'surface' : 'volume'
    if (initial.selectionEvidence?.kind === 'teaching-marker') viewer.current?.locateCursor(initial.position)
    else viewer.current?.setCursorStructure(initial.position, initial.selected)
    setState({ ...initial, note: state.note, annotations: state.annotations })
  }
  const regional = !!scope && scope.id !== 'general-anatomy'
  const backgroundIds = brainBackgroundIds(manifest?.structures ?? [], atlas.coverage)
  const libraryBackgroundIds = manifest?.structures.map(s => s.id) ?? []
  const libraryGroup = librarySectionStructures(manifest?.structures ?? [], scope, [], CURRENT_GROUP)
  const libraryGroupIds = new Set(libraryGroup.map(s => s.id))
  const libraryGroupName = scope?.title ?? manifest?.title ?? atlas.title
  const libraryTargets = librarySectionStructures(manifest?.structures ?? [], scope, libraryBackgroundIds, category)
  const structures = [...libraryGroup, ...(manifest?.structures.filter(s => !libraryGroupIds.has(s.id)) ?? [])]
    .filter(s => `${s.name} ${s.source_name} ${s.id}`.toLowerCase().includes(query.toLowerCase()))
  const hasLibraryBackground = librarySectionStructures(manifest?.structures ?? [], scope, libraryBackgroundIds, BACKGROUND_STRUCTURES).length > 0
  const surfaceBackground = backgroundMode.current === 'surface'
  const background3DEnabled = surfaceBackground ? !!state?.surfaceContext?.enabled : !!state?.imageContext
  const background3D = state && (surfaceBackground || !labelModel) ? {
    enabled: background3DEnabled,
    opacity: surfaceBackground ? state.surfaceContext?.opacity ?? .15 : state.backgroundOpacity3D ?? 1,
    adjust: (opacity: number) => {
      const enabled = opacity > 0
      patch(surfaceBackground
        ? { surfaceContext: { enabled, opacity, structure_ids: backgroundIds.length ? backgroundIds : state.surfaceContext?.structure_ids ?? [] }, imageContext: false }
        : { backgroundOpacity3D: opacity, imageContext: enabled,
          ...(state.surfaceContext ? { surfaceContext: { ...state.surfaceContext, enabled: false } } : {}) })
    },
  } : undefined
  return <section className={`workspace ${compact ? 'compact' : ''} ${drawer ? 'showing-' + drawer : ''}`}>
    <aside id={viewKey + '-library'} aria-label="Structure library" className={`catalog ${drawer === 'library' ? 'drawer-open' : ''}`}>
      {imageOnly && manifest && state ? <NativeImageControls manifest={manifest} state={state} value={imageValue} ready={ready} base={atlas.base_url} patch={patch}/> : <>
      <label className="sr-only" htmlFor={viewKey + '-search'}>Search structures</label><input id={viewKey + '-search'} type="search" placeholder="Search name or structure ID…" value={query} onChange={e => setQuery(e.target.value)}/>
      <StructureVisibilityActions structures={libraryTargets} sourceStructures={manifest?.structures ?? []} visible={state?.visible ?? []} disabled={!ready} onChange={visible => patch({ visible })}>
        <LibrarySectionSelect id={viewKey + '-category'} label="Anatomy category" value={category} onChange={setCategory}
          groupName={libraryGroupName} hasBackground={hasLibraryBackground}/>
      </StructureVisibilityActions>
      <div className="structure-list" aria-label="Anatomical structures">
        {structures.map(s => <div key={s.id} className={`structure-row ${s.id === state?.selected ? 'selected' : ''}`}>
          <input type="checkbox" aria-label={`Show ${s.name}`} checked={state?.visible.includes(s.id) ?? false} disabled={!ready} onChange={e => state && patch({ visible: e.target.checked ? [...state.visible, s.id] : state.visible.filter(id => id !== s.id) })}/>
          <button onClick={() => choose(s)} disabled={!ready} title={s.id} aria-label={s.name} aria-description={libraryGroupIds.has(s.id) ? libraryGroupName : 'Background'}><span className="structure-color" style={{ background: `rgb(${s.color.join(',')})` }}/><span><span className="structure-name">{s.name}</span><small>{libraryGroupIds.has(s.id) ? libraryGroupName : 'Background'}</small></span></button>
        </div>)}
        {!structures.length && <p className="muted">Try another structure name or category.</p>}
      </div>
      </>}
    </aside>
    <section className="viewer-column">
      <div className="workspace-heading"><h1>{scope?.title ?? manifest?.title ?? atlas.title}</h1></div>
      {compact && <div className="compact-toolbar"><button className="library-toggle" aria-controls={viewKey + '-library'} aria-expanded={drawer === 'library'} onClick={() => setDrawer(drawer === 'library' ? null : 'library')}>Structure library</button></div>}
      <div className="cursor-readout" role="status" aria-label="Anatomy at cursor"><span className="coordinate-status">{cursorStructure?.name ?? (scalarFields ? 'Native statistical field observation' : imageOnly ? 'Native source image observation' : streamlines ? 'Choose a displayed trajectory' : 'Background')}</span></div>
      {scalarFields && manifest && state && <div className="evidence scalar-field-summary">{(() => { const field=manifest.volumes.find(v=>v.id===state.background)!; return `${field.name} · ${field.scalar!.units} · display ${state.window.join(" to ")} · no reference MRI`; })()}</div>}
      {error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      <div className="canvas-shell" data-ready={ready ? 'true' : 'false'} aria-busy={!ready && !loadFailed}><canvas ref={canvas} aria-label={scalarFields ? 'Linked scalar field sections and three-dimensional intensity display' : labelModel ? 'Linked categorical model sections and three-dimensional anatomy' : ctLabels ? 'Linked CT slices and three-dimensional anatomy' : 'Linked MRI slices and three-dimensional anatomy'} tabIndex={0}/>{!ready && !loadFailed && <div className="atlas-loading" role="status">Loading</div>}{loadFailed && <div className="load-error">{status}<button onClick={() => window.location.reload()}>Reload viewer</button></div>}</div>
      <div className="view-coordinate-bar">
        <div className="view-toolbar view-settings" role="group" aria-label="View settings"><label>{labelModel ? 'Model' : scalarFields ? 'Field' : 'Image'}<SelectField aria-label={labelModel ? 'Reference model' : scalarFields ? 'Scalar field' : ctLabels ? 'CT image' : 'MRI contrast'} value={state?.background ?? ''} disabled={!ready} onChange={e => { const image = manifest!.volumes.find(v => v.id === e.target.value)!; patch({ background: image.id, window: [image.cal_min, image.cal_max] }) }}>{manifest?.volumes.filter(v => v.kind === (labelModel ? 'labels' : scalarFields ? 'scalar' : 'image')).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</SelectField></label>
          <label>Layout<SelectField aria-label="View layout" value={state?.layout ?? 'quad'} disabled={!ready} onChange={e => patch({ layout: e.target.value as ViewState['layout'] })}>{[['quad', '2D + 3D'], ['axial', 'Axial'], ['coronal', 'Coronal'], ['sagittal', 'Sagittal'], ['3d', '3D anatomy']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</SelectField></label>
          {state?.layout === 'quad' && <label>Panels<SelectField aria-label="Image panel arrangement" value={state.tileLayout ?? 'grid'} disabled={!ready} onChange={event => patch({tileLayout:event.target.value as ViewState['tileLayout']})}><option value="auto">Fit window</option><option value="grid">2 × 2 grid</option><option value="row">Side by side</option></SelectField></label>}
        </div>
        <div className="coordinate-bar">{['R', 'A', 'S'].map((axis, i) => <label key={axis}>{axis}<input aria-label={`${axis} coordinate in millimeters`} type="number" step="1" value={Number((state?.position[i] ?? 0).toFixed(2))} disabled={!ready} onChange={e => { const value = Number(e.target.value); if (state && Number.isFinite(value)) { const position = [...state.position] as ViewState['position']; position[i] = value; locate(position) } }}/><span aria-hidden="true">mm</span></label>)}</div>
        <button className="reset-view" onClick={resetView} disabled={!ready}>Reset view</button>
      </div>
      <div className="display-controls atlas-display-sliders"><div className="atlas-slider-row">{!imageOnly && <label>2D overlay<FrameRange aria-label="2D overlay" min="0" max="1" step=".05" value={state?.labelOpacity ?? .5} onValueChange={value => patch({ labelOpacity: value })} disabled={!ready}/><output aria-label="2D overlay opacity value">{Math.round((state?.labelOpacity ?? .5) * 100)}%</output></label>}
        {!imageOnly && <label>3D opacity<FrameRange aria-label="3D opacity" min="0" max="1" step=".05" value={state?.meshOpacity ?? .5} onValueChange={value => patch({ meshOpacity: value })} disabled={!ready}/><output aria-label="3D opacity value">{Math.round((state?.meshOpacity ?? .5) * 100)}%</output></label>}
        <div className="zoom-controls" role="group" aria-label="View zoom">
          <label title="1× shows the complete source field of view; higher zoom centers on the cursor">2D zoom<FrameRange aria-label="2D zoom" min="1" max="10" step=".1" value={state?.pan[3] ?? 1} onValueChange={value => { const zoom = zoomFactor(value); if (state && manifest) patch({ pan: zoom === 1 ? [0, 0, 0, 1] : centeredSlicePan(manifest.volumes.find(v => v.id === state.background)!, state.position, zoom) }) }} disabled={!ready}/><output aria-label="2D zoom factor">{(state?.pan[3] ?? 1).toFixed(1)}×</output></label>
          <label title="Magnifies the displayed source geometry">3D zoom<FrameRange aria-label="3D zoom" min="1" max="10" step=".1" value={state ? viewZoom3D(state) : 1} onValueChange={value => { const change = viewer.current?.zoom3DChange(value); if (change) patch(change) }} disabled={!ready}/><output aria-label="3D zoom factor">{(state ? viewZoom3D(state) : 1).toFixed(1)}×</output></label>
        </div>
        {state && regional && <BackgroundControls disabled={!ready} className={background3D ? undefined : 'single-background-slider'}
          image={{enabled: state.background2D !== false, opacity: state.backgroundOpacity2D ?? 1,
            adjust: opacity => patch({background2D: opacity > 0, backgroundOpacity2D: opacity})}}
          model={background3D}/>}
        </div>
        {probabilistic && <label>2D evidence<SelectField aria-label="Evidence overlay" value={state?.overlay ?? 'labels'} onChange={e => patch({ overlay: e.target.value as ViewState['overlay'] })} disabled={!ready}><option value="probability">Selected probability channel</option><option value={independent ? "mask" : "labels"}>{independent ? (derivedMask ? "Project display mask" : "Selected binary mask") : "Source navigation labels"}</option></SelectField></label>}
        {!regional && !labelModel && <label className="check-control"><input type="checkbox" checked={state?.imageContext ?? false} onChange={e => patch({ imageContext: e.target.checked })} disabled={!ready}/>{imageOnly ? '3D intensity display' : ctLabels ? '3D CT context' : '3D MRI context'}</label>}
      </div>
      {state && <BackgroundControls disabled={!ready} className="cursor-section-controls"
        unavailable={regional && !background3D ? '3D background is unavailable in this source.' : undefined}>
        <label className="check-control cursor-control"><input type="checkbox" aria-label="Cursor" checked={state.showCursor ?? state.show3DCursor ?? true} disabled={!ready} onChange={event => patch({showCursor: event.target.checked})}/>Cursor</label>
        <div className="section-guide-controls" role="group" aria-label="3D section guides">{SECTION_PLANES.map(plane => <label key={plane} className="check-control"><input type="checkbox" aria-label={`Show ${plane} guide`} checked={state.sectionPlanes?.includes(plane) ?? false} disabled={!ready} onChange={event => patch({ sectionPlanes: event.target.checked ? [...(state.sectionPlanes ?? []), plane] : state.sectionPlanes?.filter(value => value !== plane) })}/>{plane[0].toUpperCase() + plane.slice(1)}</label>)}</div>
        {!imageOnly && !streamlines && <SurfaceCutawayControls state={state} ready={ready} patch={patch}/>}
      </BackgroundControls>}
      {probabilistic && <div className="probability-evidence"><div><strong>{state?.overlay === 'probability' ? 'Source probability' : independent ? (derivedMask ? 'Project display mask' : 'Selected binary mask') : 'Source navigation labels'}</strong><span>{selected?.name ?? 'Select a channel'}</span>{state?.overlay === 'probability' && <output aria-label="Source probability at cursor">{formatProbability(probabilityValue, selected?.probability)}</output>}</div>
        {state?.overlay === 'probability' && <div className="probability-scale"><span>{probabilityScale(selected?.probability)[0]}</span><i/><span>{probabilityScale(selected?.probability)[1]}</span></div>}
        <p>{state?.overlay === 'probability' ? 'Moving the cursor samples the selected channel. Choose a structure to change channels. ' : ''}{manifest && probabilityNavigationDescription(manifest.build)}</p>{selected?.probability && <p>{selected.probability.derivation}</p>}</div>}
      {independent && state && state.selectionEvidence?.kind === 'independent-mask' && <div className="independent-memberships" aria-label="Independent region memberships"><strong>Mask membership at cursor</strong><p className="small muted">{state.selectionEvidence.candidates.length} visible mask fields contain the nearest native voxel. Selecting a region changes the evidence field at this location.</p><div className="button-row">{state.selectionEvidence.candidates.map(id => <button key={id} disabled={!ready || id === state.selected} onClick={() => patch({ selected: id })}>{manifest?.structures.find(s => s.id === id)?.name}</button>)}</div></div>}
      {streamlines && manifest && state && <StreamlineControls manifest={manifest} state={state} ready={ready} patch={patch}/>}

    </section>
  </section>
}
