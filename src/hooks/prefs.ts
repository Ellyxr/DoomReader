import { useSyncExternalStore } from 'react'

import type { PostLength } from '@/lib/feed'

export type Theme = 'light' | 'dark' | 'system'

export interface Prefs {
  len: PostLength
  /** Reading text size in px, FONT_SIZE.min–max. */
  size: number
  /** 'custom' is a font the reader uploaded (lib/fonts). */
  font: 'sans' | 'serif' | 'custom'
  theme: Theme
  /** Holding a word shows what it means. */
  define: boolean
  /** The browser tab takes the title and cover of the book read last. */
  tabBook: boolean
  /** The reading streak shows as a number on the installed app's icon. */
  streakBadge: boolean
}

// Must match public/theme.js, which applies the theme before first paint.
const KEY = 'doomreader:prefs'
export const FONT_SIZE = { min: 13, max: 26, default: 17 }
const DEFAULTS: Prefs = { len: 'm', size: FONT_SIZE.default, font: 'sans', theme: 'system', define: false, tabBook: true, streakBadge: false }

/** Sizes were once Small / Medium / Large; those carry over as the px they stood for. */
const LEGACY_SIZE: Record<string, number> = { s: 15, m: 17, l: 20 }

export const clampSize = (n: unknown) => {
  const v = typeof n === 'string' ? LEGACY_SIZE[n] : n
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, Math.round(v)))
    : FONT_SIZE.default
}

function load(): Prefs {
  try {
    const p = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
    return { ...p, size: clampSize(p.size) }
  } catch {
    return DEFAULTS
  }
}

let prefs = load()
const listeners = new Set<() => void>()
const dark = matchMedia('(prefers-color-scheme: dark)')

const resolved = (): 'light' | 'dark' => (prefs.theme === 'system' ? (dark.matches ? 'dark' : 'light') : prefs.theme)

function apply() {
  const html = document.documentElement
  const theme = resolved()
  html.classList.toggle('dark', theme === 'dark')
  html.style.colorScheme = theme
  html.style.setProperty('--fs', `${prefs.size}px`)
  html.dataset.font = prefs.font
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff')
}

dark.addEventListener('change', () => {
  apply()
  listeners.forEach(l => l())
})
apply()

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  if (prefs[key] === value) return
  prefs = { ...prefs, [key]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    /* private mode: prefs last for this session */
  }
  apply()
  listeners.forEach(l => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const usePrefs = () => useSyncExternalStore(subscribe, () => prefs)
export const useResolvedTheme = () => useSyncExternalStore(subscribe, resolved)
