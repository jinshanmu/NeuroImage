import { useEffect, useRef, useState } from 'react'
import { saveBrowserContent } from './browserStorage'
import { download } from './scene'
import { appendNotebookScene, newNotebook, NOTEBOOK_BYTE_LIMIT, NOTEBOOK_SCENE_LIMIT, readNotebook, serializeNotebook } from './notebook'
import type { NotebookEntry, TeachingNotebook as NotebookFile } from './notebook'
import type { Lesson, Manifest, SceneFile } from './types'

export interface NotebookDraft { book: NotebookFile; dirty: boolean; activeId: string | null }
interface Props {
  manifest: Manifest
  lessons: Lesson[]
  ready: boolean
  storageKey: string
  drafts: Map<string, NotebookDraft>
  capture: () => Promise<SceneFile>
  restore: (scene: SceneFile) => void
  startPresenting?: boolean
  onPresentationChange?: (presenting: boolean) => void
}

export function TeachingNotebook({ manifest, lessons, ready, storageKey, drafts, capture, restore, startPresenting = false, onPresentationChange }: Props) {
  const [initial] = useState(() => {
    const memory = drafts.get(storageKey)
    if (memory) return { draft: memory, error: '' }
    const book = newNotebook(manifest)
    return { draft: { book, dirty: false, activeId: null }, error: '' }
  })
  const [draft, setDraft] = useState<NotebookDraft>(initial.draft)
  const [error, setError] = useState(initial.error), [message, setMessage] = useState('')
  const [title, setTitle] = useState(''), [busy, setBusy] = useState(false)
  const [presenting, setPresenting] = useState(startPresenting)
  useEffect(() => { onPresentationChange?.(presenting) }, [presenting, onPresentationChange])
  const [removed, setRemoved] = useState<{ entry: NotebookEntry; index: number } | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const { book, activeId, dirty } = draft
  const activeIndex = book.scenes.findIndex(entry => entry.id === activeId)
  const active = book.scenes[activeIndex]
  function remember(next: NotebookDraft) { drafts.set(storageKey, next); setDraft(next) }
  function edit(next: NotebookFile, selection = activeId) {
    remember({ book: next, dirty: true, activeId: selection }); setMessage(''); setError('')
  }
  function editEntry(change: Partial<NotebookEntry>) {
    edit({ ...book, scenes: book.scenes.map(entry => entry.id === activeId ? { ...entry, ...change } : entry) })
  }
  function open(entry: NotebookEntry) {
    restore(entry.scene)
    remember({ ...draft, activeId: entry.id })
    setMessage(`Opened scene ${book.scenes.indexOf(entry) + 1}: ${entry.title}`)
  }
  async function captureView(replace = false) {
    setBusy(true); setError('')
    try {
      const scene = await capture()
      if (replace && active) {
        editEntry({ scene, captured_utc: scene.saved_utc })
        setMessage('The selected scene now contains the current view and notes.')
      } else {
        const next = appendNotebookScene(book, scene, title.trim() || `Scene ${book.scenes.length + 1}`)
        edit(next, next.scenes.at(-1)!.id); setTitle('')
        setMessage('Current view and notes added to the notebook.')
      }
    } catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  function move(direction: number) {
    const destination = activeIndex + direction
    if (activeIndex < 0 || destination < 0 || destination >= book.scenes.length) return
    const scenes = [...book.scenes]
    ;[scenes[activeIndex], scenes[destination]] = [scenes[destination], scenes[activeIndex]]
    edit({ ...book, scenes })
  }
  function remove() {
    if (!active) return
    setRemoved({ entry: active, index: activeIndex })
    const scenes = book.scenes.filter(entry => entry.id !== active.id)
    edit({ ...book, scenes }, scenes[Math.min(activeIndex, scenes.length - 1)]?.id ?? null)
  }
  function undoRemove() {
    if (!removed || book.scenes.length >= NOTEBOOK_SCENE_LIMIT) return
    const scenes = [...book.scenes]
    scenes.splice(Math.min(removed.index, scenes.length), 0, removed.entry)
    edit({ ...book, scenes }, removed.entry.id); setRemoved(null)
  }
  async function save() {
    setBusy(true)
    try {
      const content = serializeNotebook(book, manifest, lessons)
      await saveBrowserContent(storageKey, content)
      remember({ ...draft, dirty: false }); setMessage('Notebook saved in this browser. Export a file for backup or sharing.'); setError('')
    } catch (error) { setError(`Could not save the notebook. Your current work remains open; export a file if browser storage is full. ${String(error)}`) }
    finally { setBusy(false) }
  }
  function exportFile() {
    try {
      download(serializeNotebook(book, manifest, lessons), `${manifest.package_id}-teaching-notebook.json`, 'application/json')
      setMessage('Notebook file exported with source and processing records.'); setError('')
    } catch (error) { setError(String(error)) }
  }
  async function importFile(file?: File) {
    if (!file) return
    try {
      if (file.size > NOTEBOOK_BYTE_LIMIT) throw new Error('Notebook file exceeds the 10 MiB limit.')
      const imported = readNotebook(JSON.parse(await file.text()), manifest, lessons)
      edit(imported, imported.scenes[0]?.id ?? null); setRemoved(null); setPresenting(false)
      setMessage('Notebook imported. Open a scene to restore its view; save to keep it in this browser.')
    } catch (error) { setError(String(error)) }
    if (upload.current) upload.current.value = ''
  }
  return <details className="teaching-notebook" aria-label="Teaching notebook editor" open={startPresenting || undefined}>
    <summary>Teaching notebook <span>{book.scenes.length} scenes{dirty ? ' · unsaved' : ''}</span></summary>
    {!presenting && <p className="muted">Arrange your own source-bound views for a class. Scenes retain coordinates, visibility, camera, notes and practice state. Save your own prompts alongside exact atlas scenes.</p>}
    {presenting && active ? <section className="notebook-presentation" aria-label="Notebook presentation">
      <h3>{book.title}</h3>
      {book.objective && <p>{book.objective}</p>}
      <div className="lesson-progress">Scene {activeIndex + 1} of {book.scenes.length}</div>
      <h3>{active.title}</h3><p className="notebook-prompt">{active.prompt || 'Explore the recorded view and its teaching notes.'}</p>
      <div className="button-row"><button disabled={!ready || busy || activeIndex === 0} onClick={() => open(book.scenes[activeIndex - 1])}>Previous view</button><button disabled={!ready || busy || activeIndex === book.scenes.length - 1} onClick={() => open(book.scenes[activeIndex + 1])}>Next view</button></div>
      <div className="button-row"><button disabled={!ready || busy} onClick={() => open(active)}>Return to recorded view</button>
      <button onClick={() => setPresenting(false)}>Edit notebook</button></div>
    </section> : <button disabled={!ready || busy || !book.scenes.length} onClick={() => { open(active ?? book.scenes[0]); setPresenting(true) }}>Present notebook</button>}
    <div hidden={presenting}>
    <label>Notebook title<input aria-label="Notebook title" maxLength={120} value={book.title} disabled={busy} onChange={event => edit({ ...book, title: event.target.value })}/></label>
    <label>Author<input aria-label="Notebook author" maxLength={200} value={book.author} disabled={busy} onChange={event => edit({ ...book, author: event.target.value })}/></label>
    <label>Learning objective<textarea aria-label="Notebook learning objective" rows={3} maxLength={2000} value={book.objective} disabled={busy} onChange={event => edit({ ...book, objective: event.target.value })}/></label>
    <label>New scene title<input aria-label="New notebook scene title" maxLength={120} placeholder={`Scene ${book.scenes.length + 1}`} value={title} disabled={busy} onChange={event => setTitle(event.target.value)}/></label>
    <button disabled={!ready || busy || book.scenes.length >= NOTEBOOK_SCENE_LIMIT} onClick={() => captureView()}>Add current view to notebook</button>
    {!!book.scenes.length && <ol className="notebook-scenes" aria-label="Notebook scenes">{book.scenes.map((entry, index) => <li key={entry.id}><button aria-label={`Open notebook scene ${index + 1}: ${entry.title}`} aria-pressed={entry.id === activeId} disabled={!ready || busy} onClick={() => open(entry)}>{index + 1}. {entry.title}</button></li>)}</ol>}
    {active && <section className="notebook-entry" aria-label="Selected notebook scene">
      <p className="small muted">Scene {activeIndex + 1} of {book.scenes.length}. Edits to the live view are captured only when you update this scene.</p>
      <label>Scene title<input aria-label="Selected notebook scene title" maxLength={120} value={active.title} disabled={busy} onChange={event => editEntry({ title: event.target.value })}/></label>
      <label>Discussion prompt<textarea aria-label="Notebook discussion prompt" maxLength={2000} rows={3} value={active.prompt} disabled={busy} onChange={event => editEntry({ prompt: event.target.value })}/></label>
      <div className="button-row"><button disabled={!ready || busy || activeIndex === 0} onClick={() => open(book.scenes[activeIndex - 1])}>Previous scene</button><button disabled={!ready || busy || activeIndex === book.scenes.length - 1} onClick={() => open(book.scenes[activeIndex + 1])}>Next scene</button></div>
      <button disabled={!ready || busy} onClick={() => captureView(true)}>Update scene from current view</button>
      <div className="button-row"><button disabled={busy || activeIndex === 0} onClick={() => move(-1)}>Move earlier</button><button disabled={busy || activeIndex === book.scenes.length - 1} onClick={() => move(1)}>Move later</button><button disabled={busy} onClick={remove}>Remove scene</button></div>
    </section>}
    {removed && <button disabled={busy || book.scenes.length >= NOTEBOOK_SCENE_LIMIT} onClick={undoRemove}>Undo scene removal</button>}
    </div>
    <div className="notebook-files"><button disabled={busy} onClick={save}>Save notebook</button><button disabled={busy} onClick={exportFile}>Export notebook</button><button disabled={busy} onClick={() => upload.current?.click()}>Import notebook</button></div>
    <input ref={upload} aria-label="Import teaching notebook file" type="file" accept=".json,application/json" hidden onChange={event => importFile(event.target.files?.[0])}/>
    {!presenting && <p className="small muted">Up to {NOTEBOOK_SCENE_LIMIT} scenes in this exact atlas version. Exported notebooks contain view states and source records; recipients need their own matching local atlas.</p>}
    {message && <p className="notebook-message" role="status">{message}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </details>
}
