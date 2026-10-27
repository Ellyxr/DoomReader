import { useSyncExternalStore } from 'react'

/** A link the reader keeps beside the floating buttons. Saved on this device only. */
export interface Shortcut {
  id: string
  url: string
  name: string
}

export const MAX_SHORTCUTS = 3
const KEY = 'doomreader:shortcuts'

/**
 * A web address typed or pasted by the reader, as an https/http URL, or null. A missing scheme means https; any other
 * scheme (javascript:, data:, file:…) is refused, so a shortcut can only ever open a web page.
 */
export function cleanUrl(input: string) {
  const s = input.trim()
  if (!s || s.length > 2000) return null
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:/i.test(s) ? s : `https://${s}`)
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname.includes('.') || u.username || u.password)
      return null
    return u.href
  } catch {
    return null
  }
}

export const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '')

/** The site's icon, from DuckDuckGo's icon service: the only outside address the page may load images from. */
export const faviconOf = (url: string) => `https://icons.duckduckgo.com/ip3/${new URL(url).hostname}.ico`

function load(): Shortcut[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .flatMap(o => {
        const url = typeof o?.url === 'string' ? cleanUrl(o.url) : null
        if (!url || typeof o.id !== 'string') return []
        return [{ id: o.id.slice(0, 64), url, name: typeof o.name === 'string' ? o.name.slice(0, 40) : hostOf(url) }]
      })
      .slice(0, MAX_SHORTCUTS)
  } catch {
    return []
  }
}

let shortcuts = load()
const listeners = new Set<() => void>()

function save(next: Shortcut[]) {
  shortcuts = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode: they last for this session */
  }
  listeners.forEach(l => l())
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)

/** Adds a shortcut; false when there are already three or the link isn't a web address. */
export function addShortcut(link: string, name: string) {
  const url = cleanUrl(link)
  if (!url || shortcuts.length >= MAX_SHORTCUTS) return false
  save([...shortcuts, { id: newId(), url, name: name.trim().slice(0, 40) || hostOf(url) }])
  return true
}

export function updateShortcut(id: string, link: string, name: string) {
  const url = cleanUrl(link)
  if (!url) return false
  save(shortcuts.map(s => (s.id === id ? { ...s, url, name: name.trim().slice(0, 40) || hostOf(url) } : s)))
  return true
}

export function removeShortcut(id: string) {
  save(shortcuts.filter(s => s.id !== id))
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const useShortcuts = () => useSyncExternalStore(subscribe, () => shortcuts)
