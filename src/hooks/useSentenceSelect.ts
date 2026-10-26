import { useCallback, useEffect, useRef, useState } from 'react'

import { wordAt } from '@/lib/dictionary'
import type { Post } from '@/lib/feed'
import { domText, quoteOf, sentences, type PostText, type Range } from '@/lib/highlight'

export interface TextSelection {
  /** Post index, plus its first segment to tell when posts were regrouped underneath it. */
  post: number
  s: number
  a: number
  b: number
  quote: string
  /** Sentences selected (touch only). */
  count: number
  /** A mouse selection drawn by the browser itself, rather than a finger selection drawn as marks. */
  native: boolean
  /** The finger is still down. */
  dragging: boolean
}

/** A word held to look it up, as character offsets in its post. */
export interface HeldWord {
  post: number
  s: number
  a: number
  b: number
  word: string
}

const HOLD_MS = 420
const SLOP = 10 // px a finger may wander before a hold counts as a scroll
const EDGE = 72 // px from the top or bottom where dragging scrolls the page

/** Character boxes of a post body, relative to the element, cached when a hold starts. */
interface Cache {
  el: HTMLElement
  post: number
  pt: PostText
  units: Range[]
  boxes: { i: number; l: number; t: number; r: number; b: number }[]
}

function measure(el: HTMLElement, post: number): Cache {
  const pt = domText(el)
  const o = el.getBoundingClientRect()
  const boxes: Cache['boxes'] = []
  const r = document.createRange()
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let i = 0
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const s = n.nodeValue ?? ''
    for (let k = 0; k < s.length; k++, i++) {
      if (/\s/.test(s[k])) continue
      r.setStart(n, k)
      r.setEnd(n, k + 1)
      const b = r.getClientRects()[0]
      if (b) boxes.push({ i, l: b.left - o.left, t: b.top - o.top, r: b.right - o.left, b: b.bottom - o.top })
    }
  }
  return { el, post, pt, units: sentences(pt), boxes }
}

/** The character under a point, or the nearest one; works the same whether or not the text is selectable. */
function charAt(c: Cache, x: number, y: number) {
  const o = c.el.getBoundingClientRect()
  x -= o.left
  y -= o.top
  let best = 0
  let score = Infinity
  for (const b of c.boxes) {
    const dy = y < b.t ? b.t - y : y > b.b ? y - b.b : 0
    const dx = x < b.l ? b.l - x : x > b.r ? x - b.r : 0
    const s = dy * 1000 + dx // the right line first, then the closest character on it
    if (s < score) {
      score = s
      best = b.i
    }
  }
  return best
}

function unitAt(units: Range[], i: number) {
  let best = 0
  let dist = Infinity
  units.forEach((u, k) => {
    const d = i < u.a ? u.a - i : i >= u.b ? i - u.b + 1 : 0
    if (d < dist) {
      dist = d
      best = k
    }
  })
  return best
}

const vibrate = (ms: number) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not on this device */
  }
}

/**
 * Selecting passages to quote. On touch screens: hold a sentence to select it, keep holding and drag to grow the
 * selection sentence by sentence (the page doesn't scroll meanwhile, except near the top and bottom edges), and while
 * it's selected, tap another sentence in the post to extend to it. The browser's own long-press selection is turned
 * off in post text (see `html.touch-ui` in index.css), since it works word by word with fiddly handles.
 * With a mouse, ordinary text selection is used.
 *
 * With `define` on, holding still on a word picks that word instead (to show its meaning); dragging on from there turns
 * it into a sentence selection as above. A mouse held still on a word does the same.
 */
export function useSentenceSelect(posts: Post[], define: boolean) {
  const [sel, setSel] = useState<TextSelection | null>(null)
  const [word, setWord] = useState<HeldWord | null>(null)
  const live = useRef({ posts, sel, word, define })
  useEffect(() => {
    live.current = { posts, sel, word, define }
  })

  const clear = useCallback(() => {
    setSel(null)
    if (live.current.sel?.native) getSelection()?.removeAllRanges()
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (matchMedia('(pointer: coarse)').matches) root.classList.add('touch-ui')

    let cache: Cache | null = null
    let pending: { x: number; y: number; el: HTMLElement; post: number; timer: number } | null = null
    let drag: { anchor: number; focus: number; x: number; y: number } | null = null
    // where a hold picked a word: the finger may rest there without starting a selection
    let look: { x: number; y: number } | null = null
    let frame = 0

    /** Picks the word at character `i`, if there is one there. */
    const pickWord = (c: Cache, i: number) => {
      const r = wordAt(c.pt.text, i)
      const post = live.current.posts[c.post]
      if (!r || !post) return false
      setSel(null)
      setWord({ post: c.post, s: post.s, a: r[0], b: r[1], word: c.pt.text.slice(r[0], r[1]) })
      return true
    }

    const emit = (dragging: boolean) => {
      if (!cache || !drag) return
      const lo = Math.min(drag.anchor, drag.focus)
      const hi = Math.max(drag.anchor, drag.focus)
      const range = { a: cache.units[lo].a, b: cache.units[hi].b }
      const post = live.current.posts[cache.post]
      if (!post) return
      setSel({
        post: cache.post,
        s: post.s,
        ...range,
        quote: quoteOf(cache.pt, range),
        count: hi - lo + 1,
        native: false,
        dragging,
      })
    }

    const follow = () => {
      if (!cache || !drag) return
      const f = unitAt(cache.units, charAt(cache, drag.x, drag.y))
      if (f !== drag.focus) {
        drag.focus = f
        vibrate(6)
        emit(true)
      }
    }

    // scroll while the finger rests near an edge, so a selection can run past the screen
    const edgeScroll = () => {
      frame = 0
      if (!drag) return
      const top = (document.querySelector('header')?.getBoundingClientRect().bottom ?? 0) + EDGE / 2
      const dy = drag.y < top ? -(top - drag.y) / 4 : drag.y > innerHeight - EDGE ? (drag.y - innerHeight + EDGE) / 4 : 0
      if (dy) {
        scrollBy(0, Math.max(-24, Math.min(24, dy)))
        follow()
        frame = requestAnimationFrame(edgeScroll)
      }
    }

    const bodyAt = (target: EventTarget | null) => {
      const el = (target as Element | null)?.closest?.<HTMLElement>('main article[data-i] .post-text')
      const post = el ? Number(el.closest<HTMLElement>('article')!.dataset.i) : -1
      return el ? { el, post } : null
    }

    // Follow-up events are heard on the touched element itself: drawing the selection rewrites the post's HTML, which
    // detaches that element, and events for a touch keep going to it but no longer bubble up to the document.
    let target: EventTarget | null = null
    const opts = { passive: false } as const
    const attach = (t: EventTarget) => {
      detach()
      target = t
      t.addEventListener('touchmove', onMove as EventListener, opts)
      t.addEventListener('touchend', onEnd as EventListener, opts)
      t.addEventListener('touchcancel', onCancel)
    }
    function detach() {
      target?.removeEventListener('touchmove', onMove as EventListener)
      target?.removeEventListener('touchend', onEnd as EventListener)
      target?.removeEventListener('touchcancel', onCancel)
      target = null
    }

    const onStart = (e: TouchEvent) => {
      root.classList.add('touch-ui')
      if (e.touches.length !== 1) {
        if (pending) clearTimeout(pending.timer)
        pending = null
        return
      }
      const hit = bodyAt(e.target)
      if (!hit || !e.target) return
      attach(e.target)
      const { clientX: x, clientY: y } = e.touches[0]
      const timer = window.setTimeout(() => {
        if (!pending) return
        cache = measure(pending.el, pending.post)
        if (!cache.units.length) return
        const at = charAt(cache, pending.x, pending.y)
        const u = unitAt(cache.units, at)
        drag = { anchor: u, focus: u, x: pending.x, y: pending.y }
        look = live.current.define && pickWord(cache, at) ? { x: pending.x, y: pending.y } : null
        pending = null
        vibrate(12)
        if (!look) emit(true)
      }, HOLD_MS)
      pending = { x, y, ...hit, timer }
    }

    function onMove(e: TouchEvent) {
      const t = e.touches[0]
      if (pending && Math.hypot(t.clientX - pending.x, t.clientY - pending.y) > SLOP) {
        clearTimeout(pending.timer)
        pending = null
      }
      if (!drag) return
      if (e.cancelable) e.preventDefault() // the finger is selecting, not scrolling
      drag.x = t.clientX
      drag.y = t.clientY
      if (look) {
        if (Math.hypot(t.clientX - look.x, t.clientY - look.y) <= SLOP) return
        // dragging away from a looked-up word selects sentences instead
        look = null
        setWord(null)
        emit(true)
      }
      follow()
      if (!frame) frame = requestAnimationFrame(edgeScroll)
    }

    function onEnd(e: TouchEvent) {
      detach()
      if (drag) {
        e.preventDefault() // no click after a hold
        if (!look) emit(false)
        drag = null
        look = null
        return
      }
      if (!pending) return
      // a tap (the hold never fired)
      clearTimeout(pending.timer)
      const tap = pending
      pending = null
      const cur = live.current.sel
      if (!cur || cur.native || cur.dragging) return
      if (tap.post === cur.post) {
        // extend the selection to the tapped sentence
        if (!cache || cache.el !== tap.el || cache.post !== tap.post) cache = measure(tap.el, tap.post)
        const anchor = unitAt(cache.units, cur.a)
        const end = unitAt(cache.units, cur.b - 1)
        const t = unitAt(cache.units, charAt(cache, tap.x, tap.y))
        drag = { anchor: t < anchor ? end : anchor, focus: t, x: tap.x, y: tap.y }
        emit(false)
        drag = null
        e.preventDefault()
      }
    }

    // tapping anywhere outside the post and the action bar lets go of the selection
    const onTapOutside = (e: TouchEvent) => {
      const cur = live.current.sel
      if (!cur || cur.native || drag) return
      const t = e.target as Element
      if (t.closest?.('[data-selbar], [role=dialog]')) return
      if (bodyAt(t)?.post === cur.post) return
      setSel(null)
    }

    function onCancel() {
      detach()
      if (pending) clearTimeout(pending.timer)
      pending = null
      if (drag && !look) emit(false)
      drag = null
      look = null
    }

    // the context menu a long press opens on Android would cover the selection
    const onMenu = (e: Event) => {
      if (root.classList.contains('touch-ui') && bodyAt(e.target)) e.preventDefault()
    }
    // a mouse held still on a word looks it up; the click that ends the hold is swallowed, so it doesn't open a note
    let mouse: { x: number; y: number; timer: number } | null = null
    let swallowClick = false
    const cancelMouse = () => {
      if (mouse) clearTimeout(mouse.timer)
      mouse = null
    }
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      // a mouse brings ordinary text selection back (laptops with touch screens)
      root.classList.remove('touch-ui')
      cancelMouse()
      swallowClick = false
      const hit = e.button === 0 && live.current.define ? bodyAt(e.target) : null
      if (!hit) return
      const { clientX: x, clientY: y } = e
      const timer = window.setTimeout(() => {
        mouse = null
        const s = getSelection()
        if (s && !s.isCollapsed && s.toString().trim()) return // the mouse is selecting text
        const c = measure(hit.el, hit.post)
        if (pickWord(c, charAt(c, x, y))) swallowClick = true
      }, HOLD_MS)
      mouse = { x, y, timer }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (mouse && Math.hypot(e.clientX - mouse.x, e.clientY - mouse.y) > SLOP) cancelMouse()
    }
    const onClick = (e: MouseEvent) => {
      if (!swallowClick) return
      swallowClick = false
      e.stopPropagation()
      e.preventDefault()
    }

    // mouse selection: the browser draws it; this only reports what's selected
    let clearTimer = 0
    const onSelection = () => {
      if (root.classList.contains('touch-ui')) return
      clearTimeout(clearTimer)
      const s = getSelection()
      const text = s && !s.isCollapsed ? s.toString().replace(/[ \t]+/g, ' ').trim() : ''
      const range = s?.rangeCount ? s.getRangeAt(0) : null
      const node = range?.commonAncestorContainer
      const el = node && (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)
      const article = el?.closest<HTMLElement>('main article[data-i]')
      const body = article?.querySelector('.post-text')
      if (text.length >= 2 && range && body && body.contains(range.startContainer)) {
        const post = Number(article!.dataset.i)
        const p = live.current.posts[post]
        if (p) {
          const r = document.createRange()
          r.setStart(body, 0)
          r.setEnd(range.startContainer, range.startOffset)
          const a = r.toString().length
          setSel({ post, s: p.s, a, b: a + range.toString().length, quote: text.slice(0, 2000), count: 0, native: true, dragging: false })
          return
        }
      }
      // delayed, so the action bar is still there to receive the click that collapsed the selection
      clearTimer = window.setTimeout(() => {
        if (live.current.sel?.native) setSel(null)
      }, 400)
    }

    // Chrome decides when a finger lands whether that touch may block scrolling, from the listeners that already
    // exist. This standing one makes touches cancelable, so a drag that turns into a selection can stop the scroll.
    const blockScroll = (e: TouchEvent) => {
      if (drag && e.cancelable) e.preventDefault()
    }
    document.addEventListener('touchmove', blockScroll, opts)
    document.addEventListener('touchstart', onTapOutside, { passive: true })
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('contextmenu', onMenu)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('pointerup', cancelMouse)
    window.addEventListener('click', onClick, true)
    document.addEventListener('selectionchange', onSelection)
    return () => {
      if (pending) clearTimeout(pending.timer)
      cancelMouse()
      cancelAnimationFrame(frame)
      clearTimeout(clearTimer)
      detach()
      document.removeEventListener('touchmove', blockScroll)
      document.removeEventListener('touchstart', onTapOutside)
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('contextmenu', onMenu)
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', cancelMouse)
      window.removeEventListener('click', onClick, true)
      document.removeEventListener('selectionchange', onSelection)
    }
  }, [])

  const clearWord = useCallback(() => setWord(null), [])

  /** Turns the looked-up word into a selection of its sentence, ready to quote. */
  const quoteWord = useCallback(() => {
    const { word: w, posts } = live.current
    setWord(null)
    const el = w && document.querySelector<HTMLElement>(`main article[data-i="${w.post}"] .post-text`)
    const post = w && posts[w.post]
    if (!w || !el || !post) return
    const c = measure(el, w.post)
    const u = c.units[unitAt(c.units, w.a)]
    if (!u) return
    getSelection()?.removeAllRanges()
    setSel({ post: w.post, s: post.s, ...u, quote: quoteOf(c.pt, u), count: 1, native: false, dragging: false })
  }, [])

  // a selection in a post that was regrouped (new post length) no longer points at the same words
  const valid = sel && posts[sel.post]?.s === sel.s ? sel : null
  const validWord = word && posts[word.post]?.s === word.s ? word : null
  return { sel: valid, clear, word: validWord, clearWord, quoteWord }
}
