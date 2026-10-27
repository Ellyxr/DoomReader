import { cleanState, int, mergeState, obj, str } from '@/lib/clean'
import { getState, saveState } from '@/lib/db'
import type { ReadingState } from '@/lib/types'

/**
 * A sync link carries a book's place (and, if wanted, its likes, bookmarks and notes) in the part of the URL after
 * "#", which browsers never send to a server. Opening it on another device that has the same file (books are keyed
 * by a hash of the file, so the id matches) moves that device to the same place. Nothing is stored anywhere else.
 */

export interface SyncPayload {
  id: string
  /** Shown when the book isn't on this device yet. */
  title: string
  /** 0–100, for the library's progress bar until the reader recomputes it. */
  pct: number
  state: ReadingState
}

const VERSION = 1
/** Links longer than this are refused, so a pasted link can't make the page decompress something huge. */
const MAX_LINK = 200_000
const MAX_JSON = 2_000_000

const b64url = (bytes: Uint8Array) => {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, max = Infinity) {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > max) {
      void reader.cancel()
      throw new Error('too big')
    }
    parts.push(value)
  }
  return new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer())
}

const canCompress = typeof CompressionStream !== 'undefined'

/** The part after "#/sync/": "z" + deflated JSON, or "j" + plain JSON where the browser can't compress. */
export async function encodeSync({ id, title, pct, state }: SyncPayload) {
  const s: Record<string, unknown> = { s: state.seg }
  if (state.likes.length) s.l = state.likes
  if (state.marks.length) s.m = state.marks
  if (state.notes?.length) s.n = state.notes
  if (state.notesCustom) s.c = true
  const json = new TextEncoder().encode(JSON.stringify({ v: VERSION, id, t: title, p: pct, ...s }))
  return canCompress ? 'z' + b64url(await pipe(json, new CompressionStream('deflate-raw'))) : 'j' + b64url(json)
}

export function syncLink(code: string) {
  return `${location.origin}${location.pathname}#/sync/${code}`
}

/**
 * The code inside a sync link (from a QR code or pasted), or null for anything else. Only the code is kept: the app
 * moves to its own sync page and never opens a link it was handed.
 */
export function syncCodeFrom(text: string) {
  return /#\/sync\/([zj][\w-]+)\s*$/.exec(text.trim())?.[1] ?? null
}

/** Reads a link's code back, treating it as untrusted. Returns null for anything that isn't a valid sync link. */
export async function decodeSync(code: string): Promise<SyncPayload | null> {
  try {
    if (code.length > MAX_LINK || !/^[zj][\w-]+$/.test(code)) return null
    const bytes = unb64url(code.slice(1))
    const json =
      code[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_JSON) : bytes.slice(0, MAX_JSON)
    const o = obj(JSON.parse(new TextDecoder().decode(json)))
    const id = str(o.id, 128)
    if (o.v !== VERSION || !/^[\w-]{1,128}$/.test(id)) return null
    const state = cleanState(id, { seg: o.s, likes: o.l, marks: o.m, notes: o.n, notesCustom: o.c })!
    return { id, title: str(o.t, 500) || 'this book', pct: Math.min(100, int(o.p)), state }
  } catch {
    return null
  }
}

/** Moves this device to the link's place, combining likes, bookmarks and notes with the ones already here. */
export async function applySync({ id, pct, state }: SyncPayload) {
  const here = await getState(id)
  await saveState({ ...mergeState(here, state), seg: state.seg }, pct)
}

/* ---------- a link opened before its book was added: applied the next time the book opens ---------- */

const PENDING = 'doomreader:pending-sync'

export function setPendingSync(code: string) {
  try {
    localStorage.setItem(PENDING, code)
  } catch {
    /* private mode: the link has to be opened again after adding the book */
  }
}

const taking = new Map<string, Promise<SyncPayload | null>>()

/** Applies a waiting link if it is for book `id`, and returns it so the reader can say so. */
export function takePendingSync(id: string) {
  // a second call while the first is still saving waits for it instead of reading the old place
  let t = taking.get(id)
  if (!t) {
    t = take(id).finally(() => taking.delete(id))
    taking.set(id, t)
  }
  return t
}

async function take(id: string) {
  let code: string | null = null
  try {
    code = localStorage.getItem(PENDING)
  } catch {
    return null
  }
  if (!code) return null
  const p = await decodeSync(code)
  if (!p) {
    localStorage.removeItem(PENDING)
    return null
  }
  if (p.id !== id) return null
  localStorage.removeItem(PENDING)
  await applySync(p)
  return p
}
