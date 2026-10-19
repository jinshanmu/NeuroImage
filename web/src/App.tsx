import { LessonEvidence } from './LessonEvidence'
import { StudyRecord } from './LearningProgress'
import { SelectField } from './SelectField'
import { StructureVisibilityActions } from './StructureVisibilityActions'
import { centeredSlicePan } from './independentRegions'
import { navigate } from './appNavigation'
import { anatomyGroup, browseTargets, targetScope } from './anatomyNavigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { readBrowserContent, saveBrowserContent } from './browserStorage'
import type { AtlasViewer } from './viewer'
import { exportScene, initialState, makeScene, readScene } from './scene'
import { exportTeachingImage } from './export'
import { formatProbability, probabilityNavigationDescription, probabilityScale } from './probability'
import { StreamlineControls } from './StreamlineControls'
import { NativeImageControls } from './NativeImageControls'
import { SurfaceCutawayControls } from './SurfaceCutawayControls'
import { focusStructure3D, setSurfaceOpacity, surfaceOpacity } from './display'
import { SECTION_PLANES, PLANE_COLORS } from './sectionPlanes'
import { TeachingNotebook } from './TeachingNotebook'
import { EvidenceTopics } from './EvidenceTopics'
import { WorkspacePanel } from './WorkspacePanel'
import { TeachingLibrary } from './TeachingLibrary'
import { CoursePresentation } from './CoursePresentation'
import type { SavedCourse } from './course'
import { workspacePost } from './workspaceApi'
import { AnatomyHome } from './AnatomyHome'
import type { ModelNotebookDraft } from './ModelTeachingNotebook'
import { SurfaceModelWorkspace } from './SurfaceModelWorkspace'
import { initialModelView } from './modelScene'
import type { ModelView, SurfaceManifest } from './modelTypes'
import type { AnatomyScope } from './anatomyNavigation'
import { anatomyEntry } from './anatomyEntry'
import { locateSourceStructure } from './navigation'
import { readNotebook } from './notebook'
import type { NotebookDraft } from './TeachingNotebook'
import type { Annotation, AtlasEntry, Lesson, Manifest, Structure, TeachingState, ViewState } from './types'

export default function App() {
  const [atlases, setAtlases] = useState<AtlasEntry[]>([]), [active, setActive] = useState(''), [error, setError] = useState('')
  const [comparing, setComparing] = useState(false), [comparison, setComparison] = useState('')
  const [startup, setStartup] = useState<{ atlas_key: string; content: unknown; content_key?: string } | null>(null)
  const [comparisonStartup,setComparisonStartup]=useState<{atlas_key:string;content:unknown;content_key:string;entry_id:string;title:string}|null>(null)
  const [showTeaching, setShowTeaching] = useState(false)
  const [course,setCourse]=useState<SavedCourse|null>(null),[coursePosition,setCoursePosition]=useState(0)
  const [courseBusy,setCourseBusy]=useState(false),[courseError,setCourseError]=useState(''),[requestedCourse,setRequestedCourse]=useState<string|undefined>()
  const courseVisit=useRef(0)
  const [home, setHome] = useState(true), [dataset, setDataset] = useState<string | null>(null)
  const [homeGroup, setHomeGroup] = useState<string | null>(null)
  const [scope, setScope] = useState<AnatomyScope | undefined>()
  const [workspaceEnabled, setWorkspaceEnabled] = useState(false), [showWorkspace, setShowWorkspace] = useState(false)
  const [routeVisit, setRouteVisit] = useState(0), [loadingCatalog, setLoadingCatalog] = useState(true)
  const memory = useRef(new Map<string, ViewState>())
  const modelMemory = useRef(new Map<string, ModelView>())
  const modelNotebooks = useRef(new Map<string, ModelNotebookDraft>())
  const notebooks = useRef(new Map<string, NotebookDraft>())
  const updateAtlases=useCallback((next:AtlasEntry[])=>setAtlases(previous=>next.map(entry=>{
    const current=previous.find(item=>item.key===entry.key)
    return current&&JSON.stringify(current)===JSON.stringify(entry)?current:entry
  })),[])
  useEffect(() => {
    const restoreRoute = () => setRouteVisit(value => value + 1)
    window.addEventListener('popstate', restoreRoute)
    return () => window.removeEventListener('popstate', restoreRoute)
  }, [])
  useEffect(() => {
    let cancelled = false
    setError(''); setLoadingCatalog(true)
    async function load() {
      const requestedUrl=location.pathname+location.search
      const response = await fetch('/api/atlases')
      if (!response.ok) throw new Error('The local atlas service is unavailable.')
      let data = await response.json(), selected: { atlas_key: string; content: unknown; content_key?: string } | null = null
      if (!cancelled) { setWorkspaceEnabled(!!data.workspace); setShowWorkspace(false) }
      const parameters = new URLSearchParams(location.search)
      const prepared = parameters.get('workspace-content')
      const saved = parameters.get('teaching-content')
      const courseId = parameters.get('course')
      const library = parameters.get('view') === 'teaching' && !!data.workspace
      const managing = parameters.get('view') === 'workspace' && !!data.workspace
      const requestedAtlas = parameters.get('view') === 'atlas' ? parameters.get('atlas') : null
      if (requestedAtlas && data.workspace && !data.atlases.some((entry:AtlasEntry)=>entry.key===requestedAtlas)) {
        const restored=await fetch('/api/workspace/atlases/'+encodeURIComponent(requestedAtlas))
        const value=await restored.json()
        if(!restored.ok)throw Error(value.error??'The bookmarked source package could not be opened.')
        data=await(await fetch('/api/atlases')).json()
      }
      const overview = parameters.get('view') === 'anatomy' || library || managing || !!requestedAtlas
      let loadedCourse: SavedCourse | null = null
      if(courseId&&data.workspace&&!overview) {
        const response=await fetch('/api/workspace/courses/'+encodeURIComponent(courseId)),savedCourse:SavedCourse&{error?:string}=await response.json()
        if(!response.ok)throw Error(savedCourse.error)
        const entry=savedCourse.course.entries[savedCourse.position]
        if(!entry)throw Error('Add a source view to this course before presenting it.')
        selected=await workspacePost('/api/workspace/courses/'+encodeURIComponent(courseId)+'/open',{entry_id:entry.id,revision:savedCourse.revision})
        data=await(await fetch('/api/atlases')).json()
        loadedCourse=savedCourse
      } else if (saved && data.workspace && !overview) {
        const result = await fetch('/api/workspace/teaching/' + encodeURIComponent(saved)), value = await result.json()
        if (!result.ok) throw Error(value.error ?? 'Restore this teaching file in your local library.')
        selected = value; data = await (await fetch('/api/atlases')).json()
      } else if (prepared && data.workspace && !overview) {
        const result = await fetch('/api/workspace/content/' + encodeURIComponent(prepared))
        const value = await result.json()
        if (!result.ok) throw new Error(value.error ?? 'The prepared teaching notebook is unavailable.')
        selected = {...value, content_key: 'prepared-' + prepared}
        data = await (await fetch('/api/atlases')).json()
      } else if (data.startup && !overview) {
        const result = await fetch(data.startup.content_url)
        if (!result.ok) throw new Error('The selected teaching file is unavailable from this local service.')
        selected = { atlas_key: data.startup.atlas_key, content: await result.json() }
      }
      if (cancelled || location.pathname+location.search!==requestedUrl) return
      const requestedEntry: AtlasEntry | undefined = data.atlases.find((entry: AtlasEntry) => entry.key === requestedAtlas)
      if (requestedAtlas && !requestedEntry) throw Error('The selected source is unavailable. Open it from Browse anatomy.')
      const requestedGroup = anatomyGroup(parameters.get('group'))
      setScope(requestedEntry && requestedGroup ? targetScope(requestedGroup, browseTargets([requestedEntry])[0]) : undefined)
      setDataset(parameters.get('dataset')); setCourse(loadedCourse)
      setHomeGroup(parameters.get('view')==='anatomy'?parameters.get('group'):null)
      if (loadedCourse) setCoursePosition(loadedCourse.position)
      setWorkspaceEnabled(!!data.workspace); setShowWorkspace(managing); setHome(!selected && !library && !requestedEntry); setShowTeaching(library)
      setRequestedCourse(library ? parameters.get('edit-course') ?? undefined : undefined)
      setStartup(selected); updateAtlases(data.atlases); setActive(selected?.atlas_key ?? requestedEntry?.key ?? data.atlases[0]?.key ?? '')
      setComparison(data.atlases[1]?.key ?? data.atlases[0]?.key ?? '')
    }
    void load().catch(error => !cancelled && setError(String(error))).finally(() => !cancelled && setLoadingCatalog(false))
    return () => { cancelled = true }
  }, [routeVisit])
  const openWorkspaceAtlas = useCallback(async (key: string, structureId?: string, anatomyScope?: AnatomyScope, signal?: AbortSignal) => {
    const response = await fetch('/api/atlases',{signal})
    if (!response.ok) throw new Error('The local atlas catalog is unavailable.')
    const data = await response.json()
    const entry = data.atlases.find((entry: AtlasEntry) => entry.key === key)
    if (!entry) throw new Error('Open and verify this atlas from the local library first.')
    if (structureId) {
      const response = await fetch(entry.manifest_url,{signal})
      if (!response.ok) throw new Error('The verified source manifest is unavailable.')
      const manifest = await response.json(), viewKey = 'primary:' + key
      if (entry.representation === 'surface-model') {
        const model = manifest as SurfaceManifest, item = model.structures.find(item => item.id === structureId)
        if (!item) throw Error('The source model object is unavailable.')
        const previous = modelMemory.current.get(viewKey) ?? initialModelView(model)
        modelMemory.current.set(viewKey, { ...previous, selected: item.id, position_native_mm: [...item.target_native_mm], visible: [...new Set([...previous.visible, item.id])] })
      } else memory.current.set(viewKey, locateSourceStructure(memory.current.get(viewKey) ?? initialState(manifest), manifest, structureId))
      setStartup(null)
    }
    if (anatomyScope) setStartup(null)
    signal?.throwIfAborted()
    updateAtlases(data.atlases); setActive(key); setComparison(value => value || key); setShowWorkspace(false); setShowTeaching(false); setHome(false); setScope(anatomyScope);setCourse(null);setError('');navigate({view:'atlas',atlas:key,group:anatomyScope?.id})
  }, [])
  const openTeaching = useCallback(async (key:string) => {
    const response=await fetch('/api/workspace/teaching/'+encodeURIComponent(key)), value=await response.json()
    if(!response.ok)throw Error(value.error)
    const catalog=await fetch('/api/atlases');if(!catalog.ok)throw Error('The local source catalogue is unavailable.')
    const data=await catalog.json()
    setStartup(value);updateAtlases(data.atlases);setActive(value.atlas_key);setScope(undefined);setShowTeaching(false);setHome(false);setShowWorkspace(false);setCourse(null);setRequestedCourse(undefined);setError('');navigate({teaching:key})
  },[])
  const showCourseView=useCallback(async(saved:SavedCourse,position:number)=>{
    const entry=saved.course.entries[position];if(!entry)throw Error('Choose a recorded course view.')
    const value=await workspacePost<{atlas_key:string;content:unknown;content_key:string}>('/api/workspace/courses/'+encodeURIComponent(saved.course.id)+'/open',{entry_id:entry.id,revision:saved.revision})
    const response=await fetch('/api/atlases'),data=await response.json();if(!response.ok)throw Error('The local source catalogue is unavailable.')
    setStartup({...value,content_key:value.content_key+':visit:'+(++courseVisit.current)});updateAtlases(data.atlases);setActive(value.atlas_key);setScope(undefined);setShowTeaching(false);setHome(false);setShowWorkspace(false);setCourse(saved);setCoursePosition(position)
    navigate({course:saved.course.id})
  },[])
  const openCourse=useCallback(async(id:string)=>{
    const response=await fetch('/api/workspace/courses/'+encodeURIComponent(id)),saved=await response.json();if(!response.ok)throw Error(saved.error)
    await showCourseView(saved,saved.position)
  },[showCourseView])
  async function changeCoursePosition(position:number){if(!course)return;setCourseBusy(true);setCourseError('');try{await showCourseView(course,position)}catch(error){setCourseError(String(error))}finally{setCourseBusy(false)}}
  async function compareCourseView(entryId:string){if(!course)return;setCourseBusy(true);setCourseError('');try{
    const entry=course.course.entries.find(item=>item.id===entryId);if(!entry)throw Error('Choose a recorded comparison view.')
    const value=await workspacePost<{atlas_key:string;content:unknown;content_key:string}>('/api/workspace/courses/'+encodeURIComponent(course.course.id)+'/preview',{entry_id:entryId,revision:course.revision})
    const response=await fetch('/api/atlases'),data=await response.json();if(!response.ok)throw Error('Open the local source catalogue to continue.')
    updateAtlases(data.atlases);setComparison(value.atlas_key);setComparisonStartup({...value,entry_id:entryId,title:entry.title,content_key:value.content_key+':comparison:'+(++courseVisit.current)});setComparing(true)
  }catch(error){setCourseError(String(error))}finally{setCourseBusy(false)}}
  function openAnatomyHome() {
    setHome(true); setDataset(null); setHomeGroup(null); setShowWorkspace(false); setShowTeaching(false); setCourse(null);setError('')
    navigate({view:'anatomy'})
  }
  function openTeachingLibrary(courseId?: string) {
    setRequestedCourse(courseId); setShowTeaching(true); setHome(false); setShowWorkspace(false)
    setError(''); navigate({view:'teaching',editCourse:courseId})
  }
  const atlas = atlases.find(a => a.key === active)
  const second = atlases.find(a => a.key === comparison)
  const contentSuffix = course ? ':course:' + course.course.id : startup?.atlas_key === active && startup.content_key ? ':content:' + startup.content_key : ''
  const comparisonSuffix=comparisonStartup?.atlas_key===comparison?(course?':course:'+course.course.id:':content:'+comparisonStartup.content_key):''
  const atlasLabel = (entry: AtlasEntry) => atlases.some(other => other.key !== entry.key && other.title === entry.title)
    ? `${entry.title} · ${entry.package_version}` : entry.title
  return <div className={`app ${comparing && !showWorkspace && !showTeaching && !home ? 'comparing' : ''} ${course&&!showWorkspace&&!showTeaching&&!home?'course-active':''}`}>
    <header className="app-header"><a className="brand" href="/?view=anatomy" aria-label="NeuroImage home" onClick={event => { event.preventDefault(); openAnatomyHome() }}><span className="brand-mark">N</span><span>NeuroImage<small>ANATOMY WORKSPACE</small></span></a>
      <button className="workspace-toggle" aria-pressed={home && !dataset && !showTeaching} onClick={openAnatomyHome}>Browse anatomy</button>
      {workspaceEnabled && <button className="workspace-toggle" aria-pressed={showTeaching} onClick={() => openTeachingLibrary()}>Teaching library</button>}
      {showWorkspace && <button onClick={() => { setShowWorkspace(false); setHome(true); navigate({view:'anatomy',dataset:dataset??undefined}) }}>Back to dataset</button>}
      {!showWorkspace && !showTeaching && !home && <div className="dataset-picker"><label htmlFor="atlas">Source</label><SelectField id="atlas" disabled={!!course||courseBusy} value={active} onChange={e => { setActive(e.target.value); setScope(undefined);setStartup(null);navigate({view:'atlas',atlas:e.target.value}) }}>{atlases.map(a => <option key={a.key} value={a.key}>{atlasLabel(a)}</option>)}</SelectField></div>}
      {!showWorkspace && !showTeaching && !home && <label className="check-control"><input type="checkbox" checked={comparing} disabled={!atlas} onChange={e => setComparing(e.target.checked)}/>Compare sources</label>}
      {comparing && !showWorkspace && !showTeaching && !home && <div className="dataset-picker comparison-picker"><label htmlFor="comparison-atlas">Compare with</label><SelectField id="comparison-atlas" value={comparison} onChange={e => {setComparison(e.target.value);setComparisonStartup(null)}}>{atlases.map(a => <option key={a.key} value={a.key}>{atlasLabel(a)}</option>)}</SelectField></div>}
      <div className="header-note"><span className="status-dot"/>Local workspace<span className="version">v{__NEUROIMAGE_VIEWER__.version} · Research & teaching</span></div>
    </header>
    {loadingCatalog && <p role="status" className="catalog-status">Loading local sources…</p>}
    {error && <div role="alert" className="error">{error}<button onClick={()=>setRouteVisit(value=>value+1)}>Retry</button></div>}
    {comparing && !showWorkspace && !showTeaching && !home && <div className="comparison-note">Independent native spaces · Each panel keeps its own coordinates, structure selection and scene. Compare source definitions before interpreting similarities.</div>}
    {workspaceEnabled && showWorkspace && <WorkspacePanel onOpen={openWorkspaceAtlas} dataset={dataset ?? undefined}/>}
    {showTeaching && <TeachingLibrary onOpen={openTeaching} onPresentCourse={openCourse} requestedCourse={requestedCourse}/>}
    {course&&!showWorkspace&&!showTeaching&&!home&&<CoursePresentation saved={course} position={coursePosition} busy={courseBusy} error={courseError} comparisonId={comparing?comparisonStartup?.entry_id:undefined} onCompare={id=>void compareCourseView(id)} onPosition={position=>void changeCoursePosition(position)} onEdit={()=>openTeachingLibrary(course.course.id)} onClose={()=>{setCourse(null);navigate({view:'atlas',atlas:active})}}/>}
    {home && !showWorkspace && !showTeaching && !loadingCatalog && <AnatomyHome atlases={atlases} workspace={workspaceEnabled} dataset={dataset} group={homeGroup} onGroup={value=>{setHomeGroup(value);navigate({view:'anatomy',dataset:dataset??undefined,group:value??undefined})}} onDataset={value=>{setDataset(value);setHomeGroup(null);navigate({view:'anatomy',dataset:value??undefined})}} onManage={value => { setDataset(value); setHomeGroup(null); setShowWorkspace(true);navigate({view:'workspace',dataset:value}) }} onOpen={openWorkspaceAtlas}/>}
    {!home && !showWorkspace && !showTeaching && (atlas ? <main className={`workspace-pair ${comparing ? 'comparison-active' : ''}`}>
      <section className="atlas-slot" aria-label="Primary atlas workspace">{atlas.representation === 'surface-model' ? <SurfaceModelWorkspace key={atlas.key + (scope?.id ?? '') + contentSuffix} atlas={atlas} scope={scope} memory={modelMemory.current} notebooks={modelNotebooks.current} viewKey={'primary:' + atlas.key + (scope ? ':' + scope.id : '') + contentSuffix} startupContent={!course&&startup?.atlas_key === atlas.key ? startup.content : undefined} recordedScene={course&&startup?.atlas_key === atlas.key ? startup.content : undefined}/> : <AtlasWorkspace key={atlas.key + (scope?.id ?? '') + contentSuffix} atlas={atlas} scope={scope} compact={comparing} memory={memory.current} notebooks={notebooks.current} viewKey={'primary:' + atlas.key + (scope ? ':' + scope.id : '') + contentSuffix} startupContent={!course&&startup?.atlas_key === atlas.key ? startup.content : undefined} recordedScene={course&&startup?.atlas_key === atlas.key ? startup.content : undefined}/>}</section>
      {comparing && second && <section className="atlas-slot" aria-label="Comparison atlas workspace">{second.representation === 'surface-model' ? <SurfaceModelWorkspace key={second.key+comparisonSuffix} atlas={second} memory={modelMemory.current} notebooks={modelNotebooks.current} viewKey={'comparison:' + second.key+comparisonSuffix} startupContent={!course&&comparisonStartup?.atlas_key===second.key?comparisonStartup.content:undefined} recordedScene={course&&comparisonStartup?.atlas_key===second.key?comparisonStartup.content:undefined}/> : <AtlasWorkspace key={second.key+comparisonSuffix} atlas={second} compact memory={memory.current} notebooks={notebooks.current} viewKey={'comparison:' + second.key+comparisonSuffix} startupContent={!course&&comparisonStartup?.atlas_key===second.key?comparisonStartup.content:undefined} recordedScene={course&&comparisonStartup?.atlas_key===second.key?comparisonStartup.content:undefined}/>}</section>}
    </main> : <div className="empty">Loading the local atlas catalog…<p>Build a package and run <code>neuroimage serve --atlas path/to/manifest.json</code> to begin.</p></div>)}
  </div>
}
function AtlasWorkspace({ atlas, memory, notebooks, viewKey, startupContent, recordedScene, scope }: { atlas: AtlasEntry; compact: boolean; scope?: AnatomyScope; memory: Map<string, ViewState>; notebooks: Map<string, NotebookDraft>; viewKey: string; startupContent?: unknown; recordedScene?: unknown }) {
  const [expanded, setExpanded] = useState(false), compact = true
  const [groupOnly, setGroupOnly] = useState(!!scope?.structure_ids.length)
  const workspaceElement = useRef<HTMLElement>(null), expandButton = useRef<HTMLButtonElement>(null)
  const expansionScroll = useRef(0)
  const [manifest, setManifest] = useState<Manifest | null>(null), [lessons, setLessons] = useState<Lesson[]>([])
  const [state, setState] = useState<ViewState | null>(null), [status, setStatus] = useState('Loading package…'), [error, setError] = useState('')
  const [query, setQuery] = useState(''), [category, setCategory] = useState('All structures')
  const teaching = state?.teaching, tab = state?.panel ?? 'inspect'
  const lessonId = teaching?.lesson_id ?? '', step = teaching?.step ?? 0, quiz = teaching?.practice ?? false, answer = teaching?.answer ?? '', revealed = teaching?.revealed ?? false
  const [loadFailed, setLoadFailed] = useState(false)
  const [annotation, setAnnotation] = useState(''), [saved, setSaved] = useState(false), [ready, setReady] = useState(false), [exporting, setExporting] = useState(false)
  const [drawer, setDrawer] = useState<'library' | 'tools' | null>(null)
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
  const [presentStartup, setPresentStartup] = useState(false)
  const [notebookPresenting, setNotebookPresenting] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null), viewer = useRef<AtlasViewer | null>(null), stateRef = useRef<ViewState | null>(null), upload = useRef<HTMLInputElement>(null)
  const practice = useRef(false)
  practice.current = quiz
  const storageKey = `neuroimage:scene:${viewKey.startsWith('comparison:') ? 'comparison:' : ''}${atlas.key}`
  const requestedScene = useRef(recordedScene), appliedScene = useRef<unknown>(undefined)
  requestedScene.current = recordedScene
  function patch(change: Partial<ViewState>) { setState(s => s ? { ...s, ...change } : s) }
  function patchTeaching(change: Partial<TeachingState>) { setState(s => s?.teaching ? { ...s, teaching: { ...s.teaching, ...change } } : s) }
  useEffect(() => { let cancelled = false
    async function load() {
      const response = await fetch(atlas.manifest_url)
      if (!response.ok) throw new Error('Could not open the local atlas manifest.')
      const m: Manifest = await response.json()
      if (!['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.8', '1.9', '1.10'].includes(m.schema_version)) throw new Error('Unsupported atlas schema version.')
      const lessonResponse = await fetch(atlas.base_url + m.lessons_file)
      if (!lessonResponse.ok) throw new Error('Could not open the lesson package.')
      const l = await lessonResponse.json()
      if (cancelled) return
      const bookKey = `neuroimage:notebook:${viewKey}`
      if (!notebooks.has(bookKey)) {
        try {
          const stored = await readBrowserContent(bookKey)
          if (cancelled) return
          if (stored) {
            const book = readNotebook(JSON.parse(stored), m, l.lessons)
            notebooks.set(bookKey, { book, dirty: false, activeId: book.scenes[0]?.id ?? null })
          }
        } catch (error) { if (!cancelled) setError(`The saved notebook could not be opened. Its stored copy has been retained. ${String(error)}`) }
      }
      if (cancelled) return
      let initial = memory.get(viewKey) ?? initialState(m)
      if (!memory.has(viewKey) && scope && scope.id !== 'general-anatomy' && scope.structure_ids.length) {
        const matching = m.structures.filter(item => scope.structure_ids.includes(item.id))
        if (matching.length) initial = { ...locateSourceStructure(initial, m, matching[0].id), pan: [0, 0, 0, 1],
          ...(anatomyGroup(scope.id)?.parentId ? { fitVisible3D: true } : {}) }
      }
      if (!memory.has(viewKey)) initial = anatomyEntry(initial, m, scope)
      if (!memory.has(viewKey) && startupContent !== undefined) {
        try {
          if ((startupContent as { kind?: string })?.kind === 'neuroimage-teaching-notebook') {
            const book = readNotebook(startupContent, m, l.lessons)
            notebooks.set(`neuroimage:notebook:${viewKey}`, { book, dirty: true, activeId: book.scenes[0]?.id ?? null })
            initial = { ...(book.scenes[0]?.scene.state ?? initial), panel: 'learn' }
            setPresentStartup(!!book.scenes.length)
            if (book.scenes.length) setDrawer('tools')
          } else initial = readScene(startupContent, m, l.lessons).state
        } catch (error) { setError(`The selected teaching file could not be opened. Your saved browser notebook was retained. ${String(error)}`) }
      }
      if (requestedScene.current !== undefined) {
        initial = readScene(requestedScene.current, m, l.lessons).state
        appliedScene.current = requestedScene.current
      }
      setManifest(m); setState(initial); stateRef.current = initial; setLessons(l.lessons)
      try { const saved = !!(await readBrowserContent(storageKey)); if (!cancelled) setSaved(saved) } catch { /* Saving remains optional. */ }
    }
    load().catch(e => { if (!cancelled) { setLoadFailed(true); setStatus('Source loading failed'); setError(String(e)) } })
    return () => { cancelled = true }
  }, [atlas, storageKey, memory, notebooks, viewKey, startupContent, scope])
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
        const visible = !practice.current && change.selected && !s.visible.includes(change.selected) ? [...s.visible, change.selected] : s.visible
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
  useEffect(() => {
    if (!ready || !manifest || recordedScene === undefined || appliedScene.current === recordedScene) return
    let current = true
    try {
      const restored = readScene(recordedScene, manifest, lessons).state
      appliedScene.current = recordedScene
      stateRef.current = restored; setState(restored); setError(''); setStatus('Restoring recorded view…')
      void viewer.current?.apply(restored).then(() => { if (current) setStatus('Ready') })
        .catch(error => { if (current) setError(String(error)) })
    } catch (error) { setError(String(error)) }
    return () => { current = false }
  }, [recordedScene, manifest, lessons, ready])
  const selected = manifest?.structures.find(s => s.id === state?.selected)
  const lesson = lessons.find(l => l.id === lessonId)
  const hidden = quiz && !revealed
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
  function startStep(l: Lesson, index: number) {
    if (!manifest) return
    const target = manifest.structures.find(s => s.id === l.steps[index].structure_id)!
    patch({ selected: target.id, selectionEvidence: { kind: 'source-target', candidates: [target.id] }, position: target.target_ras_mm, visible: quiz ? [target.id] : [...l.structure_ids],
      panel: 'learn', teaching: { lesson_id: l.id, step: index, practice: quiz, answer: '', revealed: false } })
  }
  function snapshot() { return viewer.current && state ? viewer.current.snapshot(state) : state! }
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
    try { const scene = readScene(JSON.parse(await readBrowserContent(storageKey) ?? 'null'), manifest!, lessons); setState(scene.state); setStatus('Saved scene restored') } catch (e) { setError(String(e)) }
  }
  async function importScene(file?: File) {
    if (!file) return
    try { if (file.size > 2 * 1024 * 1024) throw new Error('Scene file exceeds the 2 MiB limit.'); const scene = readScene(JSON.parse(await file.text()), manifest!, lessons); setState(scene.state); setStatus('Scene file restored') } catch (e) { setError(String(e)) }
    if (upload.current) upload.current.value = ''
  }
  async function screenshot() {
    setExporting(true)
    try { const current = await settled(); setStatus('Preparing image, source credits and licenses…'); await exportTeachingImage(current.viewer.capture(), manifest!, current.state, atlas.base_url); setStatus('Teaching export prepared') } catch (e) { setError(String(e)) }
    finally { setExporting(false) }
  }
  function locate(position: ViewState['position']) {
    const change = viewer.current?.locate(position)
    if (change && state) patch({ ...change, visible: !quiz && change.selected ? [...new Set([...state.visible, change.selected])] : state.visible })
  }
  function togglePractice(enabled: boolean) {
    if (lesson && manifest) {
      const target = manifest.structures.find(s => s.id === lesson.steps[step].structure_id)!
      patch({ selected: target.id, selectionEvidence: { kind: 'source-target', candidates: [target.id] }, position: target.target_ras_mm, visible: enabled ? [target.id] : [...lesson.structure_ids],
        teaching: { lesson_id: lesson.id, step, practice: enabled, answer: '', revealed: false } })
    }
  }
  function addAnnotation() {
    if (!state || !annotation.trim()) return
    const current = snapshot()
    patch({ annotations: [...state.annotations, { id: crypto.randomUUID(), text: annotation.trim(), position_ras_mm: current.position, structure_id: current.selected }] }); setAnnotation('')
  }
  function jumpAnnotation(marker: Annotation) {
    if (!state) return
    patch({ position: marker.position_ras_mm, selected: marker.structure_id,
      selectionEvidence: { kind: 'teaching-marker', candidates: marker.structure_id ? [marker.structure_id] : [] },
      visible: marker.structure_id ? [...new Set([...state.visible, marker.structure_id])] : state.visible })
  }
  const structures = manifest?.structures.filter(s => (!groupOnly || !scope || scope.structure_ids.includes(s.id)) && (category === 'All structures' || s.category === category) && `${s.name} ${s.source_name} ${s.id}`.toLowerCase().includes(query.toLowerCase())) ?? []
  return <section ref={workspaceElement} className={`workspace ${compact ? 'compact' : ''} ${expanded ? 'expanded' : ''} ${drawer ? 'showing-' + drawer : ''}`} role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? 'Expanded atlas viewer' : undefined}>
    <aside className={`catalog ${drawer === 'library' ? 'drawer-open' : ''}`}><div className="panel-title"><span>{imageOnly ? 'Source image' : 'Structure library'}</span><span className="count">{imageOnly ? '1' : manifest?.structures.length ?? '—'}</span>{compact && <button aria-label="Close structure library" onClick={() => setDrawer(null)}>Close</button>}</div>
      <p className="muted">Explore the anatomy in its native space.</p>{scope && !!scope.structure_ids.length && <label className="check-control anatomy-scope"><input type="checkbox" checked={groupOnly} onChange={event => setGroupOnly(event.target.checked)}/>{scope.title} only</label>}
      {imageOnly && manifest && state ? <NativeImageControls manifest={manifest} state={state} value={imageValue} ready={ready} base={atlas.base_url} patch={patch}/> : <>
      <label className="sr-only" htmlFor={viewKey + '-search'}>Search structures</label><input id={viewKey + '-search'} type="search" placeholder="Search name or structure ID…" value={query} onChange={e => setQuery(e.target.value)} disabled={hidden}/>
      <label className="sr-only" htmlFor={viewKey + '-category'}>Anatomy category</label><SelectField id={viewKey + '-category'} value={category} onChange={e => setCategory(e.target.value)} disabled={hidden}>{['All structures', ...new Set(manifest?.structures.map(s => s.category))].map(c => <option key={c}>{c}</option>)}</SelectField>
      <div className="library-actions"><button onClick={() => state && patch({ visible: selected ? [selected.id] : [] })} disabled={!ready || quiz}>Isolate selected</button><button onClick={() => patch({ visible: [] })} disabled={!ready || quiz}>Hide all</button></div>
      <StructureVisibilityActions structures={structures} visible={state?.visible ?? []} disabled={!ready || quiz} onChange={visible => patch({ visible })}/>
      <details className="surface-context-controls"><summary>{streamlines ? '3D bundle context' : 'Surface context'} · {structures.length} matches</summary><p className="small muted">Apply to the current search and category. Only 3D opacity changes.</p><div className="button-row"><button disabled={!ready || quiz || !structures.length} onClick={() => state && patch({ surfaceOpacity: setSurfaceOpacity(state, structures.map(s => s.id), .2) })}>Translucent matches</button><button disabled={!ready || quiz || !structures.length} onClick={() => state && patch({ surfaceOpacity: setSurfaceOpacity(state, structures.map(s => s.id), 1) })}>Opaque matches</button></div><button disabled={!ready || quiz} onClick={() => patch({ surfaceOpacity: {}, meshOpacity: 1 })}>Reset surface opacities</button></details>
      <div className="structure-list" aria-label="Anatomical structures">
        {hidden ? <p className="quiz-mask">Names are hidden during identification. Use the slices and surface to inspect the target, then reveal the answer.</p> : structures.map(s => <div key={s.id} className={`structure-row ${s.id === state?.selected ? 'selected' : ''}`}>
          <input type="checkbox" aria-label={`Show ${s.name}`} checked={state?.visible.includes(s.id) ?? false} disabled={!ready} onChange={e => state && patch({ visible: e.target.checked ? [...state.visible, s.id] : state.visible.filter(id => id !== s.id) })}/>
          <button onClick={() => choose(s)} disabled={!ready} title={s.id}><span className="structure-color" style={{ background: `rgb(${s.color.join(',')})` }}/><span>{s.name}<small>{s.laterality} · {s.category}</small></span></button>
        </div>)}
        {!hidden && !structures.length && <p className="muted">Try another structure name or category.</p>}
      </div>
      </>}
      <div className="catalog-footer"><span className="status-dot"/>{imageOnly ? 'Original source samples' : <>{state?.visible.length ?? 0} visible · {streamlines ? 'Trajectories' : 'Surfaces'} load on demand</>}</div>
    </aside>
    <section className="viewer-column">
      <div className="workspace-heading"><h1>{scope?.title ?? manifest?.title ?? 'Opening atlas'}</h1></div>
      {compact && <div className="compact-toolbar"><button aria-expanded={drawer === 'library'} onClick={() => setDrawer(drawer === 'library' ? null : 'library')}>Structure library</button><span className="compact-selection">{hidden ? 'Identification target' : selected?.name ?? (scalarFields ? 'Native statistical field observation' : imageOnly ? 'Native source image observation' : streamlines ? 'Choose a displayed trajectory' : 'Source background at cursor')}</span><button aria-expanded={drawer === 'tools'} onClick={() => setDrawer(drawer === 'tools' ? null : 'tools')}>Learning tools</button></div>}
      <div className="view-toolbar"><label>{labelModel ? 'Model' : scalarFields ? 'Field' : 'Image'}<SelectField aria-label={labelModel ? 'Reference model' : scalarFields ? 'Scalar field' : ctLabels ? 'CT image' : 'MRI contrast'} value={state?.background ?? ''} disabled={!ready} onChange={e => { const image = manifest!.volumes.find(v => v.id === e.target.value)!; patch({ background: image.id, window: [image.cal_min, image.cal_max] }) }}>{manifest?.volumes.filter(v => v.kind === (labelModel ? 'labels' : scalarFields ? 'scalar' : 'image')).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</SelectField></label>
        <button className="expand-view" ref={expandButton} aria-pressed={expanded} disabled={!ready} onClick={() => { if (!expanded) expansionScroll.current = window.scrollY; setDrawer(null); setExpanded(value => !value) }}>{expanded ? 'Exit expanded view' : 'Expand viewer'}</button>
        <label>Layout<SelectField aria-label="View layout" value={state?.layout ?? 'quad'} disabled={!ready} onChange={e => patch({ layout: e.target.value as ViewState['layout'] })}>{[['quad', '2D + 3D'], ['anatomy', 'Equal 2D + 3D'], ['axial', 'Axial'], ['coronal', 'Coronal'], ['sagittal', 'Sagittal'], ['3d', '3D anatomy']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}</SelectField></label>
        {state?.layout === 'quad' && <label>Panels<SelectField aria-label="Image panel arrangement" value={state.tileLayout ?? 'grid'} disabled={!ready} onChange={event => patch({tileLayout:event.target.value as ViewState['tileLayout']})}><option value="auto">Fit window</option><option value="grid">2 × 2 grid</option><option value="row">Side by side</option></SelectField></label>}
        <label className="check-control"><input type="checkbox" checked={state?.radiological ?? true} onChange={e => patch({ radiological: e.target.checked })} disabled={!ready}/>Radiological</label>
        <button onClick={() => manifest && state && setState({ ...initialState(manifest), note: state.note, annotations: state.annotations })} disabled={!ready}>Reset view</button>
      </div>
      <div className="section-navigation" role="group" aria-label="Section field of view">
        <button disabled={!ready} onClick={() => patch({ pan: [0, 0, 0, 1] })}>Full sections</button>
        <button disabled={!ready} onClick={() => state && manifest && patch({ pan: centeredSlicePan(manifest.volumes.find(v => v.id === state.background)!, state.position, Math.max(3, state.pan[3])) })}>Magnify at cursor</button>
        <label title="1× shows the complete source field of view; higher zoom centers on the cursor">2D zoom<input aria-label="2D zoom" type="range" min="1" max="10" step=".1" value={state?.pan[3] ?? 1} onChange={e => { const zoom = Number(e.target.value); if (state && manifest) patch({ pan: zoom === 1 ? [0, 0, 0, 1] : centeredSlicePan(manifest.volumes.find(v => v.id === state.background)!, state.position, zoom) }) }} disabled={!ready}/><output aria-label="2D zoom factor">{(state?.pan[3] ?? 1).toFixed(1)}×</output></label>
      </div>
      {scalarFields && manifest && state && <div className="evidence scalar-field-summary">{(() => { const field=manifest.volumes.find(v=>v.id===state.background)!; return `${field.name} · ${field.scalar!.units} · display ${state.window.join(" to ")} · no reference MRI`; })()}</div>}
      <div className="canvas-shell"><canvas ref={canvas} aria-label={scalarFields ? 'Linked scalar field sections and three-dimensional intensity display' : labelModel ? 'Linked categorical model sections and three-dimensional anatomy' : ctLabels ? 'Linked CT slices and three-dimensional anatomy' : 'Linked MRI slices and three-dimensional anatomy'} tabIndex={0}/>{!ready && <div className="loading" role="status">{status}{loadFailed && <button onClick={() => window.location.reload()}>Reload viewer</button>}</div>}</div>
      <div className="coordinate-bar"><span>RAS · mm</span>{['R', 'A', 'S'].map((axis, i) => <label key={axis}>{axis}<input aria-label={`${axis} coordinate in millimeters`} type="number" step="1" value={Number((state?.position[i] ?? 0).toFixed(2))} disabled={!ready} onChange={e => { const value = Number(e.target.value); if (state && Number.isFinite(value)) { const position = [...state.position] as ViewState['position']; position[i] = value; locate(position) } }}/></label>)}<span className="coordinate-status">{hidden ? 'Identification target' : selected?.name ?? (scalarFields ? 'Native statistical field observation' : imageOnly ? 'Native source image observation' : streamlines ? 'Choose a displayed trajectory' : 'Source background at cursor')}</span></div>
      <div className="display-controls">{!imageOnly && <label>{streamlines ? 'Section trajectories' : labelModel ? 'Model section opacity' : state?.overlay === 'probability' ? 'Probability opacity' : independent ? 'Selected mask opacity' : 'Label overlay'}<input aria-label={streamlines ? 'Streamline section opacity' : 'Label opacity'} type="range" min="0" max="1" step=".05" value={state?.labelOpacity ?? .45} onChange={e => patch({ labelOpacity: Number(e.target.value) })} disabled={!ready}/></label>}
        {probabilistic && <label>2D evidence<SelectField aria-label="Evidence overlay" value={state?.overlay ?? 'labels'} onChange={e => patch({ overlay: e.target.value as ViewState['overlay'] })} disabled={!ready}><option value="probability">Selected probability channel</option><option value={independent ? "mask" : "labels"}>{independent ? (derivedMask ? "Project display mask" : "Selected binary mask") : "Source navigation labels"}</option></SelectField></label>}
        {!imageOnly && <label>{streamlines ? '3D trajectory opacity' : 'Surface opacity'}<input aria-label={streamlines ? '3D trajectory opacity' : 'Surface opacity'} type="range" min="0" max="1" step=".05" value={state?.meshOpacity ?? 1} onChange={e => patch({ meshOpacity: Number(e.target.value) })} disabled={!ready}/></label>}
        <label title="Magnifies the displayed source geometry">3D zoom<input aria-label="3D zoom" type="range" min=".1" max="20" step=".01" value={state?.camera[2] ?? 2} onChange={e => state && patch({ fitVisible3D: false, camera: [state.camera[0], state.camera[1], Number(e.target.value)] })} disabled={!ready}/><output aria-label="3D zoom factor">{(state?.camera[2] ?? 2).toFixed(2)}×</output></label>
        {!imageOnly && <label className="check-control"><input type="checkbox" aria-label="Fit visible 3D" checked={state?.fitVisible3D ?? state?.layout === 'anatomy'} disabled={!ready || !!state?.imageContext} onChange={event => patch({ fitVisible3D: event.target.checked })}/>Fit visible 3D</label>}
        <button disabled={!ready || !selected} onClick={() => state && selected && manifest && patch({ ...focusStructure3D(selected, manifest.volumes.find(volume => volume.id === state.background)!, state.camera), fitVisible3D: false })}>Focus selected 3D</button>
        <button disabled={!ready} onClick={() => state && patch({ fitVisible3D: false, focus3D: [...state.position] })}>Center 3D on cursor</button>
        <button disabled={!ready} onClick={() => state && patch({ fitVisible3D: false, focus3D: undefined, camera: [state.camera[0], state.camera[1], .8] })}>Full 3D context</button>
        {!labelModel && <label className="check-control"><input type="checkbox" checked={state?.imageContext ?? false} onChange={e => patch({ imageContext: e.target.checked })} disabled={!ready}/>{imageOnly ? '3D intensity display' : ctLabels ? '3D CT context' : '3D MRI context'}</label>}
      </div>
      <details className="section-guide-controls"><summary>3D section guides{state?.sectionPlanes?.length ? ` · ${state.sectionPlanes.length} shown` : ''}</summary><div role="group" aria-label="3D section guides">{SECTION_PLANES.map(plane => <label key={plane} className="check-control"><input type="checkbox" aria-label={`Show ${plane} guide`} checked={state?.sectionPlanes?.includes(plane) ?? false} disabled={!ready} onChange={event => patch({ sectionPlanes: event.target.checked ? [...(state?.sectionPlanes ?? []), plane] : state?.sectionPlanes?.filter(value => value !== plane) })}/><span style={{ color: `rgb(${PLANE_COLORS[plane].map(value => Math.round(value * 255)).join(',')})` }}>{plane[0].toUpperCase() + plane.slice(1)}</span></label>)}</div><p className="small muted">Colored planes mark the current RAS sections within the source image field of view. The linked image panels show the corresponding source image texture.</p></details>
      {probabilistic && <div className="probability-evidence"><div><strong>{state?.overlay === 'probability' ? 'Source probability' : independent ? (derivedMask ? 'Project display mask' : 'Selected binary mask') : 'Source navigation labels'}</strong><span>{hidden ? 'Identification target' : selected?.name ?? 'Select a channel'}</span>{state?.overlay === 'probability' && <output aria-label="Source probability at cursor">{formatProbability(probabilityValue, selected?.probability)}</output>}</div>
        {state?.overlay === 'probability' && <div className="probability-scale"><span>{probabilityScale(selected?.probability)[0]}</span><i/><span>{probabilityScale(selected?.probability)[1]}</span></div>}
        <p>{state?.overlay === 'probability' ? 'Moving the cursor samples the selected channel. Choose a structure to change channels. ' : ''}{manifest && probabilityNavigationDescription(manifest.build)}</p>{!hidden && selected?.probability && <p>{selected.probability.derivation}</p>}</div>}
      {independent && state && !hidden && state.selectionEvidence?.kind === 'independent-mask' && <div className="independent-memberships" aria-label="Independent region memberships"><strong>Mask membership at cursor</strong><p className="small muted">{state.selectionEvidence.candidates.length} visible mask fields contain the nearest native voxel. Selecting a region changes the evidence field at this location.</p><div className="button-row">{state.selectionEvidence.candidates.map(id => <button key={id} disabled={!ready || id === state.selected} onClick={() => patch({ selected: id })}>{manifest?.structures.find(s => s.id === id)?.name}</button>)}</div></div>}
      {streamlines && manifest && state && <StreamlineControls manifest={manifest} state={state} ready={ready} patch={patch}/>}
      {state?.surfaceCutaway && <p className="cutaway-active"><span>3D surface cutaway active · {state.surfaceCutaway.structures.length} source surfaces</span><button onClick={() => { patch({ panel: 'inspect' }); if (compact) setDrawer('tools') }}>Edit cutaway</button></p>}
      <div className="scene-toolbar"><button onClick={save} disabled={!ready}>Save scene</button><button onClick={restore} disabled={!ready || !saved}>Restore saved</button><button onClick={sceneExport} disabled={!ready || exporting}>Export scene</button><button onClick={() => upload.current?.click()} disabled={!ready}>Import scene</button><button className="primary" onClick={screenshot} disabled={!ready || exporting}>Export teaching image</button><input ref={upload} aria-label="Import scene file" type="file" accept=".json,application/json" hidden onChange={e => importScene(e.target.files?.[0])}/></div>
      <p className="interaction-hint">Click slices to locate · Scroll to move through slices · Drag 3D to rotate · Double-click {imageOnly ? 'the intensity view for approximate volume location' : streamlines ? 'a trajectory to locate' : 'a surface to locate'}{!labelModel && ' · Right-drag slices to adjust contrast'}</p>
      <div className="live-status" role="status">{ready ? status : ""}</div>
      {error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    </section>
    <aside className={`inspector ${drawer === 'tools' ? 'drawer-open' : ''}`}>{compact && <button className="drawer-close" aria-label="Close learning tools" onClick={() => setDrawer(null)}>Close learning tools</button>}<nav className="inspector-tabs" aria-label="Learning tools">{(['inspect', 'learn', 'sources'] as const).map(t => <button key={t} className={tab === t ? 'active' : ''} onClick={() => patch({ panel: t })}>{t === 'inspect' ? 'Inspect' : t === 'learn' ? 'Learn' : 'Sources'}</button>)}</nav>
      <div className="inspector-content">
      {tab === 'inspect' && state && <div className="cursor-display-control"><label className="check-control"><input type="checkbox" aria-label="Show 3D cursor" checked={state.show3DCursor !== false} disabled={!ready} onChange={event => patch({show3DCursor: event.target.checked})}/>Show 3D cursor</label><p className="small muted">Hide this guide when it covers a small structure. Slice cursors and the physical location stay unchanged.</p></div>}
      {tab === 'inspect' && !imageOnly && !streamlines && state && <SurfaceCutawayControls state={state} matches={structures.map(s => s.id)} ready={ready && !quiz} patch={patch}/>}
      {tab === 'inspect' && selected && state && !hidden && <details className="selected-surface-control"><summary>{streamlines ? 'Selected bundle display' : 'Selected surface display'}</summary><label>Opacity multiplier<input aria-label="Selected surface opacity" type="range" min="0" max="1" step=".05" value={state.surfaceOpacity?.[selected.id] ?? 1} onChange={e => patch({ surfaceOpacity: setSurfaceOpacity(state, [selected.id], Number(e.target.value)) })} disabled={!ready}/></label><output aria-label="Selected effective surface opacity">{Math.round(surfaceOpacity(state, selected.id) * 100)}% effective opacity</output><p className="small muted">Multiplied by the overall 3D opacity. The 2D section display and source geometry are unchanged.</p></details>}
      {tab === 'inspect' && <>{selected && !hidden ? <><div className="eyebrow">SELECTED STRUCTURE</div><h2>{selected.name}</h2><div className="meta-line">{selected.laterality} · {selected.category}</div>{selected.kind === 'streamline-bundle' ? <><div className="metric-row"><div><strong>{selected.streamlines.source_streamline_count.toLocaleString()}</strong><span>Source trajectories</span></div><div><strong>{selected.streamlines.source_point_count.toLocaleString()}</strong><span>Retained source vertices</span></div></div><a href={atlas.base_url + selected.streamlines.levels.find(level => level.id === 'full')!.file} download>Download complete source trajectories (TCK)</a></> : <div className="metric-row"><div><strong>{(selected.volume_mm3 / 1000).toFixed(2)} mL</strong><span>{independent ? (derivedMask ? 'Project display mask volume' : 'Independent source mask volume') : selected.probability ? 'Navigation label volume' : 'Source label volume'}</span></div><div><strong>{selected.voxel_count.toLocaleString()}</strong><span>Labelled voxels</span></div></div>}<p className="evidence">{selected.evidence}</p>{selected.probability && <div className="evidence"><p>{selected.probability.interpretation}</p><p>{selected.probability.derivation}</p></div>}{state?.selectionEvidence?.kind === 'visible-streamline' && <div className="evidence"><p>Nearby displayed source trajectories within 1 mm{state.selectionEvidence.candidates.length > 1 ? '; multiple bundles overlap here' : ''}. This identifies the nearby displayed computational estimates; overlapping candidates remain individually selectable.</p>{state.selectionEvidence.candidates.length > 1 && <div className="button-row">{state.selectionEvidence.candidates.map(id => <button key={id} onClick={() => patch({ selected: id })}>{manifest?.structures.find(s => s.id === id)?.name}</button>)}</div>}</div>}{state?.selectionEvidence?.kind === 'visible-surface' && <p className="small muted">Selected by proximity to a visible source surface within one voxel. {state.selectionEvidence.candidates.length > 1 ? 'Multiple visible boundaries coincide or lie nearby; confirm the intended region in adjacent sections.' : 'Surface points lie between voxel centers; the nearest label voxel can belong to a neighboring region.'}</p>}<details><summary>Source definition & coverage</summary><p>Source {streamlines ? 'bundle' : 'label'}: {selected.source_name}</p><code className="break-word">{selected.id}</code>{selected.source_notes.map((n, i) => <p key={i}>{n}</p>)}</details></> : <p className="muted">{hidden ? 'Identify the target before revealing its name.' : imageOnly ? 'Observe the original image in complete sections, adjust contrast, then magnify at the same physical point. Add markers to record your image observations.' : streamlines ? 'Select a bundle or click near a displayed trajectory.' : 'Select a structure or click a labelled location.'}</p>}
        <div className="divider"/><h3>Teaching notes</h3><textarea aria-label="Scene teaching notes" placeholder="Notes for this scene…" maxLength={10000} rows={4} value={state?.note ?? ''} onChange={e => patch({ note: e.target.value })}/>
        <h3>Location markers</h3><textarea aria-label="New location annotation" placeholder="Describe the current crosshair location…" maxLength={2000} rows={2} value={annotation} onChange={e => setAnnotation(e.target.value)}/><button onClick={addAnnotation} disabled={!ready || !annotation.trim() || (state?.annotations.length ?? 0) >= 200}>Add marker at cursor</button>
        {!!state?.annotations.length && <><label className="check-control marker-toggle"><input type="checkbox" checked={state.showMarkers !== false} onChange={e => patch({ showMarkers: e.target.checked })}/>Show teaching markers</label><p className="small muted">Numbers identify your notes. 2D markers appear on matching slices; 3D markers project through anatomy. Markers are hidden during unrevealed practice.</p></>}
        {state?.annotations.map((a, index) => <div key={a.id} className="annotation"><button onClick={() => jumpAnnotation(a)}>{index + 1}. {a.text}<small>{a.position_ras_mm.map(v => v.toFixed(1)).join(', ')} mm</small></button><button aria-label={`Remove marker ${a.text}`} onClick={() => patch({ annotations: state.annotations.filter(x => x.id !== a.id) })}>×</button></div>)}
      </>}
      {tab === 'learn' && !notebookPresenting && <><div className="eyebrow">GUIDED EXPLORATION</div><h2>{imageOnly ? 'Image observations' : streamlines ? 'Tract lessons' : labelModel ? 'Model lessons' : 'Lessons'}</h2><p className="muted">{imageOnly ? 'Use image-anchored notebooks and teaching markers to study the original source image.' : `${lessons.length} lessons.`}</p>{!imageOnly && <><label htmlFor={viewKey + '-lesson'}>Lesson</label><SelectField id={viewKey + '-lesson'} value={lessonId} onChange={e => { const l = lessons.find(l => l.id === e.target.value); if (l) startStep(l, 0); else patch({ teaching: undefined }) }} disabled={!ready}><option value="">Choose a lesson…</option>{lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</SelectField></>}
        {lesson && <><h3>{lesson.title}</h3><p>{lesson.objective}</p><p className="evidence">{lesson.instruction}</p><div className="lesson-progress">Step {step + 1} of {lesson.steps.length}</div><p>{lesson.steps[step].prompt}</p><div className="button-row"><button disabled={step === 0} onClick={() => startStep(lesson, step - 1)}>Previous</button><button disabled={step >= lesson.steps.length - 1} onClick={() => startStep(lesson, step + 1)}>Next structure</button></div><label className="check-control quiz-toggle"><input type="checkbox" checked={quiz} onChange={e => togglePractice(e.target.checked)}/>Identification practice</label>{quiz && <div className="quiz"><p>Identify the highlighted source {streamlines ? 'bundle' : 'region'} for this step. You may move the cursor to inspect its surroundings.</p><button onClick={() => startStep(lesson, step)}>Return to target</button><input aria-label="Identification answer" placeholder="Your answer…" maxLength={2000} value={answer} onChange={e => patchTeaching({ answer: e.target.value })}/><button onClick={() => patchTeaching({ revealed: true })}>Reveal and compare</button>{revealed && <p className="answer">Source answer: <strong>{manifest?.structures.find(s => s.id === lesson.steps[step].structure_id)?.name}</strong><small>Compare your answer with the source {streamlines ? 'bundle definition' : 'label'}. Discuss synonyms and anatomical interpretation with your instructor.</small></p>}</div>}{!quiz&&<div className="lesson-response"><p>{lesson.steps[step].question}</p><label>Response<textarea aria-label="Lesson response" rows={3} maxLength={2000} value={answer} onChange={event=>patchTeaching({answer:event.target.value})}/></label>{lesson.steps[step].answer&&<details><summary>Compare reasoning</summary><p>{lesson.steps[step].answer}</p></details>}</div>}{manifest&&<StudyRecord binding={{package_id:manifest.package_id,package_version:manifest.package_version,build_signature:manifest.build.signature,space_id:manifest.space.id}} lessons={lessons} lesson={lesson} step={step} answer={answer} onRestore={answer=>patchTeaching({answer})} onStep={index=>startStep(lesson,index)}/>}<LessonEvidence lesson={lesson}/></>}
      </>}
      {tab === 'sources' && manifest && <><div className="eyebrow">EVIDENCE & PROVENANCE</div><h2>Sources and coordinates</h2><dl><dt>Representation</dt><dd>{scalarFields ? 'Original statistical fields in their native source grid' : imageOnly ? 'Original native MRI and source-intensity rendering' : streamlines ? 'Reference MRI and source computational streamline bundles' : labelModel ? 'Categorical label model · Original source tissue classes' : independent ? (derivedMasks ? 'Source MRI and probabilities with explicitly derived display masks' : 'Source MRI, independent probabilities and overlapping source masks') : probabilistic ? 'Source MRI, probability evidence and categorical navigation labels' : ctLabels ? 'Original temporal-bone CT and source fluid-space labels' : 'Measured MRI and source labels'}</dd><dt>Native space</dt><dd>{manifest.space.name}</dd><dt>Package version</dt><dd><code>{manifest.package_version}</code></dd></dl><p className="evidence">{manifest.space.correspondence}</p>{imageEvidence && <section aria-label="Image acquisition evidence"><h3>{imageEvidence.modality} acquisition and sampling</h3><p>{imageEvidence.acquisition}</p><p>{imageEvidence.sampling}</p><p>{imageEvidence.intensity_units}. {imageEvidence.calibration}</p><p className="small muted">Original source array: <code>{imageEvidence.source_dataset}</code></p></section>}<details><summary>Source coverage and interpretation</summary>{[...new Set([...manifest.validation.warnings.filter(warning => !/expert review|anatomical review|unreviewed/i.test(warning)), ...(manifest.build.recipe?.scope_notes ?? [])])].map((warning, index) => <p className="small muted" key={index}>{warning}</p>)}</details>{manifest.sources.map(s => <section key={s.id} className="source"><h3>{s.title}</h3><p>{s.citation}</p><a href={s.url} target="_blank" rel="noreferrer">Official source ↗</a><p><a href={atlas.base_url + s.license_file} target="_blank" rel="noreferrer">{s.license_name} · local license</a></p></section>)}<p className="small muted">Each source retains its native coordinates. Use the comparison panels to inspect source definitions side by side. Exported images include licenses, source versions and processing records.</p></>}
      {tab === 'learn' && manifest && !notebookPresenting && <EvidenceTopics source={manifest.dataset_id}/>}
      {manifest && <div hidden={tab !== 'learn'}><TeachingNotebook manifest={manifest} lessons={lessons} ready={ready}
        startPresenting={presentStartup} onPresentationChange={setNotebookPresenting}
        storageKey={`neuroimage:notebook:${viewKey}`} drafts={notebooks}
        capture={async () => { const current = await settled(); return makeScene(manifest, current.state) }}
        restore={scene => { setState({ ...structuredClone(scene.state), panel: 'learn' }); setStatus('Notebook scene restored') }}/></div>}
      </div><div className="inspector-footer">Normal anatomy & anatomical variation</div>
    </aside>
  </section>
}
