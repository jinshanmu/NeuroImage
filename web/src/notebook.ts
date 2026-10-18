import { makeScene, readScene } from './scene'
import type { Lesson, Manifest, SceneFile } from './types'

export const NOTEBOOK_SCENE_LIMIT = 50
export const NOTEBOOK_BYTE_LIMIT = 10 * 1024 * 1024

export interface NotebookEntry {
  id: string
  title: string
  prompt: string
  captured_utc: string
  scene: SceneFile
}
export interface TeachingNotebook {
  schema_version: '1.0'
  kind: 'neuroimage-teaching-notebook'
  id: string
  title: string
  author: string
  objective: string
  package_id: string
  package_version: string
  build_signature: string
  space_id: string
  review_status: 'user-authored-unreviewed'
  scenes: NotebookEntry[]
}

export function newNotebook(manifest: Manifest): TeachingNotebook {
  return {
    schema_version: '1.0', kind: 'neuroimage-teaching-notebook', id: crypto.randomUUID(),
    title: 'Teaching notebook', author: '', objective: '',
    package_id: manifest.package_id, package_version: manifest.package_version,
    build_signature: manifest.build.signature, space_id: manifest.space.id,
    review_status: 'user-authored-unreviewed', scenes: [],
  }
}

function text(value: unknown, maximum: number, required = false): value is string {
  return typeof value === 'string' && value.length <= maximum && (!required || !!value.trim())
}

export function readNotebook(input: unknown, manifest: Manifest, lessons: Lesson[] = []): TeachingNotebook {
  if (!input || typeof input !== 'object') throw new Error('This file is not a teaching notebook.')
  const book = input as TeachingNotebook
  if (book.kind !== 'neuroimage-teaching-notebook' || book.schema_version !== '1.0') throw new Error('Unsupported teaching notebook format.')
  if (book.package_id !== manifest.package_id || book.package_version !== manifest.package_version ||
      book.build_signature !== manifest.build.signature || book.space_id !== manifest.space.id)
    throw new Error('This notebook belongs to a different atlas version or native space. Open its matching package first.')
  if (!text(book.id, 100, true) || !text(book.title, 120, true) || !text(book.author, 200) || !text(book.objective, 2000))
    throw new Error('Notebook title, author or objective is invalid.')
  if (!Array.isArray(book.scenes) || book.scenes.length > NOTEBOOK_SCENE_LIMIT)
    throw new Error(`A teaching notebook supports up to ${NOTEBOOK_SCENE_LIMIT} scenes.`)
  const ids = new Set<string>()
  const scenes = book.scenes.map(entry => {
    if (!entry || !text(entry.id, 100, true) || ids.has(entry.id) || !text(entry.title, 120, true) ||
        !text(entry.prompt, 2000) || !text(entry.captured_utc, 40, true) || !Number.isFinite(Date.parse(entry.captured_utc)))
      throw new Error('Notebook has an invalid or duplicate scene entry.')
    ids.add(entry.id)
    // Validate every scene before accepting any part of an imported notebook.
    const scene = readScene(entry.scene, manifest, lessons)
    return { id: entry.id, title: entry.title, prompt: entry.prompt, captured_utc: entry.captured_utc, scene }
  })
  return { ...newNotebook(manifest), id: book.id, title: book.title, author: book.author, objective: book.objective, scenes }
}

export function appendNotebookScene(book: TeachingNotebook, scene: SceneFile, title: string): TeachingNotebook {
  if (book.scenes.length >= NOTEBOOK_SCENE_LIMIT) throw new Error(`This notebook already contains ${NOTEBOOK_SCENE_LIMIT} scenes.`)
  if (!text(title, 120, true)) throw new Error('Enter a scene title of 1 to 120 characters.')
  if (scene.package_id !== book.package_id || scene.package_version !== book.package_version ||
      scene.build_signature !== book.build_signature || scene.space_id !== book.space_id)
    throw new Error('The scene and notebook must use the same atlas version and native space.')
  return { ...book, scenes: [...book.scenes, {
    id: crypto.randomUUID(), title: title.trim(), prompt: '', captured_utc: scene.saved_utc, scene: structuredClone(scene),
  }] }
}

export function serializeNotebook(book: TeachingNotebook, manifest: Manifest, lessons: Lesson[]): string {
  const normalized = readNotebook(book, manifest, lessons)
  // Retain the author-reported capture times while refreshing source declarations
  // against the matching package. Import cannot confer expert review status.
  normalized.scenes.forEach(entry => {
    entry.scene = makeScene(manifest, entry.scene.state, entry.title)
    entry.scene.saved_utc = entry.captured_utc
  })
  const content = JSON.stringify(normalized, null, 2)
  if (new TextEncoder().encode(content).length > NOTEBOOK_BYTE_LIMIT)
    throw new Error('Notebook exceeds 10 MiB. Split it into smaller notebooks before saving or exporting.')
  return content
}
