// Widgets for the Windows 11 Widgets Board (installed through Edge). Loaded into the generated service worker with
// importScripts (vite.config.ts). The page leaves JSON snapshots in Cache Storage (src/lib/widgets.ts); this draws
// them into the Adaptive Card templates in /widgets and answers taps. Does nothing where there are no widgets.
/* global self, caches, clients */

const CACHE = 'doomreader-widgets'

const dayKey = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Same rule as src/lib/streak.ts: keep the two in step.
function streakData(raw) {
  const days = (raw && raw.days) || {}
  const goal = (raw && raw.goal) || 5
  const now = new Date()
  const at = back => new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
  const posts = back => days[dayKey(at(back))] || 0
  let count = 0
  for (let back = posts(0) >= goal ? 0 : 1; back < 400 && posts(back) >= goal; back++) count++
  const narrow = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' })
  const week = Array.from({ length: 7 }, (_, k) => {
    const back = 6 - k
    const met = posts(back) >= goal
    const started = !back && posts(0) > 0
    return {
      mark: met ? '●' : started ? '◐' : '○',
      color: met ? 'Accent' : 'Default',
      label: narrow.format(at(back)),
      weight: back ? 'Default' : 'Bolder',
    }
  })
  const left = Math.max(0, goal - posts(0))
  return {
    headline: count ? `${count}-day streak` : 'Start a streak',
    subline: !left
      ? 'Today counts. Nice.'
      : posts(0)
        ? `${left} more ${left === 1 ? 'post' : 'posts'} today`
        : count
          ? `Read ${goal} posts today to keep it`
          : `Read ${goal} posts to start one`,
    week,
  }
}

function continueData(raw) {
  if (!raw) return { has: false }
  const pct = Math.max(0, Math.min(100, Math.round(raw.pct || 0)))
  return { has: true, title: raw.title, author: raw.author || '', pct, done: pct, left: 100 - pct }
}

function postData(raw) {
  const queue = (raw && raw.queue) || []
  if (!queue.length) return { has: false }
  const idx = Math.min(raw.idx || 0, queue.length - 1)
  const p = queue[idx]
  return {
    has: true,
    title: raw.title,
    chapter: p.chapter || '',
    text: p.text,
    where: `${p.pct}%`,
    hasNext: idx < queue.length - 1,
  }
}

const SHAPE = { streak: streakData, continue: continueData, post: postData }

const dataKey = def => new URL(def.data, self.registration.scope).href

async function readRaw(def) {
  const r = await (await caches.open(CACHE)).match(dataKey(def))
  return r ? r.json() : null
}

// the templates are precached (their keys carry a revision query), so widgets draw offline too
const template = async url => ((await caches.match(url, { ignoreSearch: true })) || (await fetch(url))).text()

async function render(widget) {
  const def = widget && widget.definition
  if (!def || !SHAPE[def.tag] || !widget.instances.length) return
  const url = new URL(def.msAcTemplate, self.registration.scope).href
  const [tpl, raw] = await Promise.all([template(url), readRaw(def).catch(() => null)])
  await self.widgets.updateByTag(def.tag, { template: tpl, data: JSON.stringify(SHAPE[def.tag](raw)) })
}

async function renderTag(tag) {
  const w = await self.widgets.getByTag(tag)
  if (w) await render(w)
}

/** Brings the app forward at `hash`, reusing an open window when there is one. */
async function openApp(hash) {
  const url = new URL(`./${hash}`, self.registration.scope).href
  const open = await clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const c of open) {
    if ('focus' in c) {
      await c.focus()
      return c.navigate ? c.navigate(url) : undefined
    }
  }
  return clients.openWindow(url)
}

async function next(widget) {
  const def = widget.definition
  const raw = await readRaw(def)
  const queue = (raw && raw.queue) || []
  // the last post's "Next" means: carry on in the book itself
  if (!raw || (raw.idx || 0) >= queue.length - 1) return openApp('#/continue')
  raw.idx = (raw.idx || 0) + 1
  await (await caches.open(CACHE)).put(dataKey(def), new Response(JSON.stringify(raw)))
  await render(widget)
}

if ('widgets' in self) {
  self.addEventListener('widgetinstall', e => e.waitUntil(render(e.widget)))
  self.addEventListener('widgetresume', e => e.waitUntil(render(e.widget)))
  // the manifest asks for an hourly redraw, so the streak notices a new day without the app being opened
  self.addEventListener('periodicsync', e => {
    if (SHAPE[e.tag]) e.waitUntil(renderTag(e.tag))
  })
  self.addEventListener('widgetclick', e => {
    const action = e.action
    e.waitUntil(
      action === 'next'
        ? next(e.widget)
        : action === 'library'
          ? openApp('#/')
          : openApp('#/continue'),
    )
  })
  self.addEventListener('message', e => {
    if (e.data && e.data.type === 'doomreader:widgets' && SHAPE[e.data.tag]) e.waitUntil(renderTag(e.data.tag))
  })
  self.addEventListener('activate', e => e.waitUntil(Promise.all(Object.keys(SHAPE).map(t => renderTag(t).catch(() => {})))))
}
