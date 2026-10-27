import { useSyncExternalStore } from 'react'
import { openDB } from 'idb'

/**
 * A typeface of the reader's own, uploaded once and kept on this device in a database of its own (apart from the
 * library, and not part of backups). It is handed to the browser as bytes through the FontFace API, so nothing is
 * fetched and the Content-Security-Policy stays as it is. Browsers check font files before using them.
 */

/** The family name posts use for it; see `html[data-font='custom']` in index.css. */
const FAMILY = 'DoomReader Custom'
export const MAX_FONT_BYTES = 10 * 1024 * 1024
export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2'

interface Stored {
  id: 'custom'
  name: string
  data: ArrayBuffer
}

const dbp = openDB<{ fonts: { key: string; value: Stored } }>('doomreader-fonts', 1, {
  upgrade(db) {
    db.createObjectStore('fonts', { keyPath: 'id' })
  },
})

let current: { name: string } | null = null
let face: FontFace | null = null
const listeners = new Set<() => void>()
const set = (v: { name: string } | null) => {
  current = v
  listeners.forEach(l => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
/** The uploaded font's name, or null when there is none. */
export const useCustomFont = () => useSyncExternalStore(subscribe, () => current)

/** TrueType, OpenType (CFF) and WOFF 1/2, by their first four bytes. Collections (.ttc) aren't supported by FontFace. */
function isFont(data: ArrayBuffer) {
  const b = new Uint8Array(data, 0, Math.min(4, data.byteLength))
  const tag = String.fromCharCode(...b)
  return tag === 'wOFF' || tag === 'wOF2' || tag === 'OTTO' || tag === 'true' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)
}

/** Loads the bytes as the custom family, replacing any earlier one. Throws if the browser can't use them. */
async function applyFont(data: ArrayBuffer, name: string) {
  const next = new FontFace(FAMILY, data)
  await next.load()
  if (face) document.fonts.delete(face)
  document.fonts.add(next)
  face = next
  set({ name })
}

/** Checks, loads and keeps an uploaded font file. Throws an Error with a message for the reader when it can't. */
export async function addCustomFont(file: File) {
  if (file.size > MAX_FONT_BYTES) throw new Error(`That font is over ${MAX_FONT_BYTES >> 20} MB.`)
  const data = await file.arrayBuffer()
  if (!isFont(data)) throw new Error('That file isn’t a font. Use a TTF, OTF, WOFF or WOFF2 file.')
  const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 40) || 'Custom'
  try {
    await applyFont(data, name)
  } catch {
    throw new Error('This browser couldn’t read that font. Try another file.')
  }
  await (await dbp).put('fonts', { id: 'custom', name, data })
}

export async function removeCustomFont() {
  await (await dbp).delete('fonts', 'custom')
  if (face) document.fonts.delete(face)
  face = null
  set(null)
}

// on start: put the saved font back
void (async () => {
  try {
    const f = await (await dbp).get('fonts', 'custom')
    if (f) await applyFont(f.data, f.name)
  } catch {
    /* no storage, or the saved font no longer loads: posts fall back to the system font */
  }
})()
