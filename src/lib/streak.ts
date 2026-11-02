import { useSyncExternalStore } from 'react'

/**
 * Reading days. A day counts once GOAL posts were read on it, in any book; the streak is how many counted days run
 * back from today, or from yesterday while today is still open. Kept in localStorage as { "2026-11-02": posts }.
 * The widget service worker (public/widgets-sw.js) works the week out the same way: keep the two in step.
 */

export const GOAL = 5
const KEY = 'doomreader:days'
/** Days older than this are dropped; the longest streak shown is this long. */
const KEEP = 400

type Days = Record<string, number>

export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function load(): Days {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}')
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch {
    return {}
  }
}

let days = load()
const listeners = new Set<() => void>()

export interface DayView {
  key: string
  /** One letter, in the reader's language. */
  label: string
  posts: number
  met: boolean
  today: boolean
}

export interface Streak {
  count: number
  /** Posts read today. */
  today: number
  /** The last seven days, oldest first; the last is today. */
  week: DayView[]
}

const narrow = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' })

export function streakOf(d: Days, now = new Date()): Streak {
  const at = (back: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
  const posts = (back: number) => d[dayKey(at(back))] ?? 0
  let count = 0
  for (let back = posts(0) >= GOAL ? 0 : 1; back < KEEP && posts(back) >= GOAL; back++) count++
  const week = Array.from({ length: 7 }, (_, k) => {
    const back = 6 - k
    const date = at(back)
    return { key: dayKey(date), label: narrow.format(date), posts: posts(back), met: posts(back) >= GOAL, today: !back }
  })
  return { count, today: posts(0), week }
}

let snapshot = streakOf(days)

/** Counts one more post read today. Returns the streak when this post made today count, so it can be celebrated. */
export function notePostRead(): Streak | null {
  const today = dayKey(new Date())
  const before = days[today] ?? 0
  days = { ...days, [today]: before + 1 }
  const cutoff = dayKey(new Date(Date.now() - KEEP * 864e5))
  for (const k of Object.keys(days)) if (k < cutoff) delete days[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(days))
  } catch {
    /* private mode: the streak lasts for this session */
  }
  snapshot = streakOf(days)
  listeners.forEach(l => l())
  return before + 1 === GOAL ? snapshot : null
}

export const readingDays = () => days

const subscribe = (l: () => void) => {
  listeners.add(l)
  // the day can turn over while the app is open
  const t = setInterval(() => {
    const next = streakOf(days)
    if (next.week[6].key !== snapshot.week[6].key) {
      snapshot = next
      listeners.forEach(f => f())
    }
  }, 60_000)
  return () => {
    listeners.delete(l)
    clearInterval(t)
  }
}

export const useStreak = () => useSyncExternalStore(subscribe, () => snapshot)
export const onStreakChange = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
