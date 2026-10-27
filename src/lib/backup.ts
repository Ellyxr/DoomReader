import JSZip from 'jszip'

import { addBook, exportBook, getState, hasBook, listBooks, putState } from '@/lib/db'
import { cleanState, int, mergeState, num, obj, str } from '@/lib/clean'
import { safeInline } from '@/lib/parse/html'
import type { Block, BookFormat, BookImage, BookMeta, Chapter, ReadingState } from '@/lib/types'

/**
 * A backup is a zip: `doomreader-backup.json` holds every book's text, place, likes, bookmarks and notes, and
 * `images/<book id>/<key>` holds its pictures. Restoring treats the file as untrusted, because a backup can come
 * from anywhere: every field is type-checked and rebuilt, and all markup is cut back to <em>, <strong> and <br>.
 */

const MANIFEST = 'doomreader-backup.json'
const VERSION = 1
const MAX_BACKUP_BYTES = 1024 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'])

interface BackupImage {
  key: string
  type: string
  w: number
  h: number
}

interface BackupBook {
  meta: BookMeta
  chapters: Chapter[]
  state?: ReadingState
  images: BackupImage[]
}

export async function createBackup(onProgress?: (done: number, total: number) => void) {
  const zip = new JSZip()
  const books: BackupBook[] = []
  const list = await listBooks()
  for (const [n, { id }] of list.entries()) {
    const b = await exportBook(id)
    if (!b) continue
    const images: BackupImage[] = []
    for (const img of b.images) {
      const key = img.id.slice(id.length + 1)
      images.push({ key, type: img.blob.type, w: img.w, h: img.h })
      zip.file(`images/${id}/${key}`, img.blob, { compression: 'STORE' })
    }
    books.push({ meta: b.meta, chapters: b.chapters, state: b.state, images })
    onProgress?.(n + 1, list.length)
  }
  zip.file(MANIFEST, JSON.stringify({ app: 'doomreader', version: VERSION, exportedAt: Date.now(), books }))
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE' })
  return { blob, count: books.length }
}

export function downloadBackup(blob: Blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `doomreader-backup-${new Date().toISOString().slice(0, 10)}.zip`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}

/* ---------- validation ---------- */

const dataImage = (v: unknown) =>
  typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(v) ? v : null
const FORMATS = new Set<BookFormat>(['epub', 'pdf', 'sample'])
const ID = /^[\w-]{1,128}$/
const IMG_KEY = /^i\d{1,6}$/

function cleanChapters(v: unknown, images: Set<string>): Chapter[] {
  if (!Array.isArray(v)) return []
  return v
    .map(c => {
      const o = obj(c)
      const blocks = (Array.isArray(o.blocks) ? o.blocks : []).flatMap((b): Block[] => {
        const x = obj(b)
        const html = safeInline(str(x.html, 100_000))
        if (x.k === 'i') {
          const img = str(x.img)
          return images.has(img) ? [{ k: 'i', html, img, w: int(x.w), h: int(x.h) }] : []
        }
        return x.k === 'p' || x.k === 'h' || x.k === 'q' ? [{ k: x.k, html }] : []
      })
      return { title: str(o.title, 500), blocks }
    })
    .filter(c => c.blocks.length)
}

function cleanMeta(id: string, v: unknown, chapters: Chapter[]): BookMeta {
  const o = obj(v)
  const format = FORMATS.has(o.format as BookFormat) ? (o.format as BookFormat) : 'epub'
  const openedAt = num(o.openedAt, -1)
  return {
    id,
    title: str(o.title, 500) || 'Untitled',
    author: str(o.author, 500) || 'Unknown author',
    format,
    cover: dataImage(o.cover),
    avatar: dataImage(o.avatar),
    fileName: str(o.fileName, 500),
    fileSize: int(o.fileSize),
    chapterCount: chapters.length,
    addedAt: num(o.addedAt, Date.now()),
    openedAt: openedAt < 0 ? null : openedAt,
    progress: Math.min(100, int(o.progress)),
  }
}

/* ---------- restore ---------- */

export async function restoreBackup(file: File, onProgress?: (done: number, total: number) => void) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('That backup is over 1 GB, too big to restore here.')
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error('That file is not a DoomReader backup.')
  }
  const text = await zip.file(MANIFEST)?.async('string')
  let data: Record<string, unknown> = {}
  try {
    data = obj(text ? JSON.parse(text) : null)
  } catch {
    /* falls through to the check below */
  }
  if (data.app !== 'doomreader' || !Array.isArray(data.books))
    throw new Error('That file is not a DoomReader backup.')
  if (num(data.version) > VERSION) throw new Error('This backup was made by a newer DoomReader. Update the app first.')

  let added = 0
  let merged = 0
  const list = data.books as unknown[]
  for (const [n, raw] of list.entries()) {
    const b = obj(raw)
    const id = str(obj(b.meta).id, 200)
    if (!ID.test(id)) continue
    const state = cleanState(id, b.state)

    if (await hasBook(id)) {
      if (state) await putState(mergeState(await getState(id), state))
      merged++
    } else {
      const images: Record<string, BookImage> = {}
      for (const im of Array.isArray(b.images) ? b.images : []) {
        const o = obj(im)
        const key = str(o.key)
        const type = str(o.type)
        const f = IMG_KEY.test(key) && IMAGE_TYPES.has(type) ? zip.file(`images/${id}/${key}`) : null
        if (f) images[key] = { blob: new Blob([await f.async('arraybuffer')], { type }), w: int(o.w), h: int(o.h) }
      }
      const chapters = cleanChapters(b.chapters, new Set(Object.keys(images)))
      if (chapters.length) {
        await addBook(cleanMeta(id, b.meta, chapters), chapters, images, state)
        added++
      }
    }
    onProgress?.(n + 1, list.length)
  }
  return { added, merged }
}
