import { useSyncExternalStore } from 'react'

import type { PostLength } from '@/lib/feed'

export type Theme = 'light' | 'dark' | 'system'

export interface Prefs {
  len: PostLength
  size: 's' | 'm' | 'l'
  font: 'sans' | 'serif'
  theme: Theme
}

// Must match the inline script in index.html that applies the theme before first paint.
const KEY = 'doomreader:prefs'
const DEFAULTS: Prefs = { len: 'm', size: 'm', font: 'sans', theme: 'system' }

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
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
  html.dataset.size = prefs.size
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
