import { openDB, type DBSchema } from 'idb'

import type { BookImage, BookMeta, Chapter, ReadingState } from '@/lib/types'

/**
 * Everything lives in this browser's IndexedDB. Nothing leaves the device; the library is gone only
 * when the user clears this site's data (or the browser evicts it, which `persist()` guards against).
 */
interface Schema extends DBSchema {
  books: { key: string; value: BookMeta }
  content: { key: string; value: { id: string; chapters: Chapter[] } }
  state: { key: string; value: ReadingState }
  /** Book pictures, keyed "<book id>/<image key>". */
  images: { key: string; value: BookImage & { id: string } }
}

const dbp = openDB<Schema>('doomreader', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('books', { keyPath: 'id' })
      db.createObjectStore('content', { keyPath: 'id' })
      db.createObjectStore('state', { keyPath: 'id' })
    }
    if (oldVersion < 2) db.createObjectStore('images', { keyPath: 'id' })
  },
})

const imagesOf = (book: string) => IDBKeyRange.bound(`${book}/`, `${book}/￿`)

const CHANGED = 'doomreader:library-changed'
const changed = () => window.dispatchEvent(new Event(CHANGED))

export function onLibraryChange(fn: () => void) {
  window.addEventListener(CHANGED, fn)
  return () => window.removeEventListener(CHANGED, fn)
}

export async function listBooks() {
  const books = await (await dbp).getAll('books')
  return books.sort((a, b) => (b.openedAt ?? b.addedAt) - (a.openedAt ?? a.addedAt))
}

export async function getBook(id: string) {
  const db = await dbp
  const [meta, content] = await Promise.all([db.get('books', id), db.get('content', id)])
  return meta && content ? { meta, chapters: content.chapters } : null
}

export async function hasBook(id: string) {
  return (await (await dbp).getKey('books', id)) !== undefined
}

export async function addBook(
  meta: BookMeta,
  chapters: Chapter[],
  images: Record<string, BookImage> = {},
  state?: ReadingState,
) {
  const db = await dbp
  const tx = db.transaction(['books', 'content', 'images', 'state'], 'readwrite')
  const store = tx.objectStore('images')
  await Promise.all([
    tx.objectStore('books').put(meta),
    tx.objectStore('content').put({ id: meta.id, chapters }),
    ...Object.entries(images).map(([k, img]) => store.put({ ...img, id: `${meta.id}/${k}` })),
    state && tx.objectStore('state').put(state),
    tx.done,
  ])
  changed()
}

export async function deleteBook(id: string) {
  const db = await dbp
  const tx = db.transaction(['books', 'content', 'state', 'images'], 'readwrite')
  await Promise.all([
    tx.objectStore('books').delete(id),
    tx.objectStore('content').delete(id),
    tx.objectStore('state').delete(id),
    tx.objectStore('images').delete(imagesOf(id)),
    tx.done,
  ])
  changed()
}

export async function getImage(book: string, key: string) {
  return (await dbp).get('images', `${book}/${key}`)
}

/** Everything stored for one book, for a backup. */
export async function exportBook(id: string) {
  const db = await dbp
  const [meta, content, state, images] = await Promise.all([
    db.get('books', id),
    db.get('content', id),
    db.get('state', id),
    db.getAll('images', imagesOf(id)),
  ])
  if (!meta || !content) return null
  return { meta, chapters: content.chapters, state, images }
}

export async function getState(id: string) {
  return (await dbp).get('state', id)
}

export async function putState(state: ReadingState) {
  await (await dbp).put('state', state)
}

/** Saves the reading position and marks, and the progress shown in the library. */
export async function saveState(state: ReadingState, progress: number) {
  const db = await dbp
  const tx = db.transaction(['books', 'state'], 'readwrite')
  const books = tx.objectStore('books')
  const meta = await books.get(state.id)
  await tx.objectStore('state').put(state)
  if (meta) await books.put({ ...meta, progress, openedAt: Date.now() })
  await tx.done
}

export async function markOpened(id: string) {
  const db = await dbp
  const meta = await db.get('books', id)
  if (meta) await db.put('books', { ...meta, openedAt: Date.now() })
}

/* ---------- storage quota and persistence ---------- */

export interface StorageInfo {
  usage: number
  quota: number
  persisted: boolean
  supported: boolean
}

export async function storageInfo(): Promise<StorageInfo> {
  const s = navigator.storage
  if (!s?.estimate) return { usage: 0, quota: 0, persisted: false, supported: false }
  const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([s.estimate(), s.persisted?.() ?? false])
  return { usage, quota, persisted, supported: true }
}

/** Asks the browser not to evict the library when the disk is low. Chrome grants this silently for installed or engaged sites; Firefox asks. */
export async function requestPersistence() {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
