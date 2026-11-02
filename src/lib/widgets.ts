import { plainText, type Post } from '@/lib/feed'
import { onStreakChange, readingDays, GOAL } from '@/lib/streak'
import type { BookMeta } from '@/lib/types'

/**
 * Widgets (Windows 11 Widgets Board, through Edge) are drawn by the service worker, which can't see the page. So the
 * page leaves small JSON snapshots in Cache Storage for it and asks it to redraw (public/widgets-sw.js). Everything
 * stays on the device. Browsers without widgets just keep a few unused kilobytes.
 */

const CACHE = 'doomreader-widgets'
/** Upcoming posts the post widget can step through before it asks to open the book. */
const QUEUE = 5
const MAX_TEXT = 320

export type WidgetTag = 'streak' | 'continue' | 'post'

const dataUrl = (tag: WidgetTag) => new URL(`widgets/data/${tag}.json`, document.baseURI).href

async function put(tag: WidgetTag, data: unknown) {
  if (!('caches' in window)) return
  try {
    const c = await caches.open(CACHE)
    await c.put(dataUrl(tag), new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
    navigator.serviceWorker?.controller?.postMessage({ type: 'doomreader:widgets', tag })
  } catch {
    /* storage full or blocked: the widget keeps its last picture */
  }
}

// reading moves the place every few hundred ms; the widgets only need the last one
const timers = new Map<WidgetTag, number>()
function putSoon(tag: WidgetTag, data: () => unknown, wait = 1500) {
  clearTimeout(timers.get(tag))
  timers.set(tag, window.setTimeout(() => void put(tag, data()), wait))
}

const clip = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT).replace(/\s+\S*$/, '') + '…' : s)

/** The book being read and the posts from the current one on, for "Continue reading" and the post widget. */
export function publishReading(meta: BookMeta, posts: Post[], cur: number, chapterTitle: (ch: number) => string) {
  putSoon('continue', () => ({ id: meta.id, title: meta.title, author: meta.author, pct: posts[cur]?.pct ?? 0 }))
  putSoon('post', () => {
    const queue: { text: string; chapter: string; pct: number }[] = []
    for (let i = cur; i < posts.length && queue.length < QUEUE; i++) {
      const text = plainText(posts[i]).trim()
      if (text) queue.push({ text: clip(text), chapter: chapterTitle(posts[i].ch), pct: posts[i].pct })
    }
    return { id: meta.id, title: meta.title, queue, idx: 0 }
  })
}

/** After the library changes: the book read last, or nothing once it is gone. */
export function publishLibrary(books: BookMeta[]) {
  const last = books.find(b => b.openedAt) ?? null
  void caches
    ?.open(CACHE)
    .then(c => c.match(dataUrl('continue')))
    .then(r => r?.json())
    .then(async (shown: { id?: string; title?: string; pct?: number } | undefined) => {
      if (shown?.id && shown.id === last?.id) {
        if (shown.title === last.title) return
        // renamed: same book, new title on both widgets
        void put('continue', { ...shown, title: last.title })
        const c = await caches.open(CACHE)
        const post = await (await c.match(dataUrl('post')))?.json()
        if (post?.id === last.id) void put('post', { ...post, title: last.title })
        return
      }
      void put('continue', last && { id: last.id, title: last.title, author: last.author, pct: last.progress })
      // the post widget's text belongs to the old book; the reader fills it in again
      void put('post', null)
    })
    .catch(() => {})
}

const publishStreak = () => putSoon('streak', () => ({ days: readingDays(), goal: GOAL }), 300)

/* ---------- the number on the app icon ---------- */

let badgeOn = false
let badgeCount = 0
function applyBadge() {
  if (!('setAppBadge' in navigator)) return
  if (badgeOn && badgeCount > 0) void navigator.setAppBadge(badgeCount).catch(() => {})
  else void navigator.clearAppBadge().catch(() => {})
}
export const canBadge = () => 'setAppBadge' in navigator

export function setStreakBadge(on: boolean, count: number) {
  if (on === badgeOn && count === badgeCount) return
  badgeOn = on
  badgeCount = count
  applyBadge()
}

let started = false
/** Keeps the streak widget current; called once at startup. */
export function startWidgets() {
  if (started) return
  started = true
  publishStreak()
  onStreakChange(publishStreak)
}
