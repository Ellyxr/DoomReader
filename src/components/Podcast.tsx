import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react'

import { BookAvatar } from '@/components/BookAvatar'
import { RATES } from '@/hooks/useSpeech'
import { bookColor, NEUTRAL, type BookColor } from '@/lib/color'
import { speechChunks, type Post } from '@/lib/feed'
import type { BookMeta } from '@/lib/types'
import { cn } from '@/lib/utils'

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The sentence `by` places from sentence `chunk` of post `post` (text '' past either end of the book), with a key that
 * names that sentence wherever it is shown, so it keeps its element as it moves from next to current to previous.
 */
function sentenceAt(posts: Post[], post: number, chunk: number, by: number) {
  let p = post
  let c = chunk + by
  while (c < 0 && p > 0) c += speechChunks(posts[--p]).length
  while (p < posts.length && c >= speechChunks(posts[p]).length) c -= speechChunks(posts[p++]).length
  return { key: `${p}:${c}`, text: (c >= 0 && posts[p] && speechChunks(posts[p])[c]) || '' }
}

/** Smaller type for longer sentences, so most fit without scrolling. */
function sizeFor(text: string) {
  const n = text.length
  if (n <= 60) return 'text-[34px] leading-[1.18]'
  if (n <= 120) return 'text-[30px] leading-[1.2]'
  if (n <= 200) return 'text-[26px] leading-[1.25]'
  if (n <= 320) return 'text-[22px] leading-[1.3]'
  return 'text-[19px] leading-[1.35]'
}

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)' // quick start, soft landing

/**
 * The sentence being read, large, between the ones before and after it, small and faint. Each sentence keeps its
 * element as it moves from next to current to previous, and glides there: its new size and place are drawn at once,
 * then it is shown at its old ones and transformed back (FLIP), so it grows into the reading spot and shrinks out of it
 * without the text reflowing frame by frame. A sentence that just arrived fades up into place.
 */
function Lyrics({
  posts,
  post,
  chunk,
  faint,
  onSkip,
  onToggle,
}: {
  posts: Post[]
  post: number
  chunk: number
  faint: string
  onSkip: (by: number) => void
  onToggle: () => void
}) {
  const lines = [-1, 0, 1].map(by => ({ by, ...sentenceAt(posts, post, chunk, by) })).filter(l => l.text)
  const els = useRef(new Map<string, HTMLElement>())
  const was = useRef(new Map<string, { x: number; y: number; size: number }>())
  const keys = lines.map(l => l.key).join()

  useLayoutEffect(() => {
    const now = new Map<string, { x: number; y: number; size: number }>()
    // offsets ignore transforms, so a skip in the middle of an animation still measures true places
    for (const [k, el] of els.current)
      now.set(k, { x: el.offsetLeft, y: el.offsetTop, size: parseFloat(getComputedStyle(el).fontSize) })
    if (!reduceMotion())
      for (const [k, el] of els.current) {
        const a = was.current.get(k)
        const b = now.get(k)!
        if (!a) {
          // waits for the sentence growing into place to clear the way
          el.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], {
            duration: 380,
            delay: 220,
            easing: EASE,
            fill: 'backwards',
          })
          continue
        }
        const scale = a.size / b.size
        const move = `translate(${a.x - b.x}px, ${a.y - b.y}px)`
        if (Math.abs(a.y - b.y) < 1 && Math.abs(scale - 1) < 0.01) continue
        if (scale < 1)
          // becoming the sentence being read: grows from its small size into place
          el.animate([{ transform: `${move} scale(${scale})` }, { transform: 'none' }], { duration: 520, easing: EASE })
        // stepping aside: it has already re-wrapped small, so scaling it up would spill off the screen; it glides
        // to its place and fades in there instead
        else el.animate([{ transform: move, opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 520, easing: EASE })
      }
    was.current = now
  }, [keys])

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-6 overflow-hidden py-4">
      {lines.map(({ key, text, by }) => {
        const active = by === 0
        return (
          <button
            key={key}
            ref={el => {
              els.current.set(key, el!)
              return () => void els.current.delete(key)
            }}
            onClick={() => (active ? onToggle() : onSkip(by))}
            aria-current={active || undefined}
            title={active ? 'Play or pause' : by < 0 ? 'Go back to this sentence' : 'Skip to this sentence'}
            className={cn(
              'block w-full origin-top-left text-left font-read text-pretty transition-colors duration-500',
              active
                ? cn('max-h-[55dvh] overflow-y-auto font-bold text-white', sizeFor(text))
                : 'line-clamp-2 text-[15px] leading-snug font-medium',
            )}
            style={active ? undefined : { color: faint }}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}

/** Keeps the screen on while listening here, since some phones stop speaking once the screen locks. */
function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let gone = false
    const get = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock.request('screen').then(
        l => (gone ? void l.release() : (lock = l)),
        () => {},
      )
    }
    get()
    document.addEventListener('visibilitychange', get)
    return () => {
      gone = true
      document.removeEventListener('visibilitychange', get)
      void lock?.release()
    }
  }, [on])
}

interface Props {
  open: boolean
  playing: boolean
  post: number | null
  chunk: number
  posts: Post[]
  rate: number
  meta: BookMeta
  chapter: string
  onToggle: () => void
  onSkip: (by: number) => void
  onRate: (r: number) => void
  onMinimize: () => void
  onStop: () => void
}

/**
 * Podcast mode: read-aloud as a full screen in the book's colour, one sentence at a time, large, with the sentences
 * either side small and dim (tap them to go back or ahead). It slides up over the feed and back down when minimized
 * or stopped, and keeps showing the last sentence while it slides away.
 */
export function Podcast(props: Props) {
  const { open, meta, post, chunk } = props
  // mounted until the slide-away animation ends
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  if (open && (!mounted || closing)) {
    setMounted(true)
    setClosing(false)
  } else if (!open && mounted && !closing) {
    if (reduceMotion()) setMounted(false)
    else setClosing(true)
  }
  // the last sentence read, still shown while the screen slides away after stopping clears the position
  const [last, setLast] = useState({ post: post ?? 0, chunk })
  if (post !== null && (post !== last.post || chunk !== last.chunk)) setLast({ post, chunk })

  const [color, setColor] = useState<BookColor>(NEUTRAL)
  useEffect(() => {
    let live = true
    void bookColor(meta).then(c => live && setColor(c))
    return () => {
      live = false
    }
  }, [meta])

  const visible = mounted
  // the page underneath doesn't scroll, and the browser bar takes the book's colour
  useEffect(() => {
    if (!visible) return
    const root = document.documentElement
    const meta = document.querySelector('meta[name="theme-color"]')
    const was = meta?.getAttribute('content')
    root.style.overflow = 'hidden'
    meta?.setAttribute('content', color.bg)
    return () => {
      root.style.overflow = ''
      if (was) meta?.setAttribute('content', was)
    }
  }, [visible, color.bg])

  useWakeLock(open && props.playing)

  // latest callbacks for the key handler
  const live = useRef(props)
  useEffect(() => {
    live.current = props
  })

  const playRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) playRef.current?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const p = live.current
      if (e.key === 'Escape') p.onMinimize()
      else if (e.key === 'ArrowLeft') p.onSkip(-1)
      else if (e.key === 'ArrowRight') p.onSkip(1)
      else if (e.key === ' ' && !(e.target as Element).closest?.('button')) p.onToggle()
      else return
      e.preventDefault()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open])

  if (!mounted) return null
  const { playing, posts, rate, chapter, onToggle, onSkip, onRate, onMinimize, onStop } = props
  const at = last.post
  const pct = posts[at]?.pct ?? 0
  const nextRate = RATES[(RATES.indexOf(rate as (typeof RATES)[number]) + 1) % RATES.length]
  const ghost = 'grid place-items-center rounded-full transition-colors hover:bg-white/10 active:bg-white/15'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Podcast mode"
      className={cn(
        'fixed inset-0 z-40 text-white duration-300 motion-reduce:animate-none',
        closing ? 'animate-out ease-in slide-out-to-bottom' : 'animate-in ease-out slide-in-from-bottom',
      )}
      style={{ background: `linear-gradient(180deg, ${color.bg} 0%, ${color.bg} 35%, ${color.deep} 100%)`, animationFillMode: 'forwards' }}
      onAnimationEnd={e => {
        if (closing && e.target === e.currentTarget) {
          setMounted(false)
          setClosing(false)
        }
      }}
    >
      <div className="mx-auto flex h-dvh max-w-[600px] flex-col px-safe pt-[env(safe-area-inset-top,0px)] pb-[calc(16px+env(safe-area-inset-bottom,0px))]">
        <header className="flex h-14 shrink-0 items-center gap-2">
          <button onClick={onMinimize} aria-label="Minimize" title="Minimize (Esc)" className={cn(ghost, '-ml-2 size-11')}>
            <ChevronDown className="size-7" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="text-[11px] font-bold tracking-[0.08em] uppercase" style={{ color: color.dim }}>
              {playing ? 'Reading aloud' : 'Paused'}
            </div>
            <div className="truncate text-[14px] font-bold">{chapter}</div>
          </div>
          <span className="size-11 shrink-0" />
        </header>

        <Lyrics posts={posts} post={at} chunk={last.chunk} faint={color.faint} onSkip={onSkip} onToggle={onToggle} />

        <div className="shrink-0">
          <div className="mb-4 flex items-center gap-3">
            <BookAvatar title={meta.title} avatar={meta.avatar} className="size-12 rounded-lg" />
            <div className="min-w-0">
              <div className="truncate text-[17px] font-bold">{meta.title}</div>
              <div className="truncate text-[14px]" style={{ color: color.dim }}>
                {meta.author}
              </div>
            </div>
          </div>

          <div
            role="progressbar"
            aria-label="Progress through the book"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1 overflow-hidden rounded-full bg-white/25"
          >
            <i className="block h-full rounded-full bg-white transition-[width] duration-300" style={{ width: pct + '%' }} />
          </div>
          <div className="mt-1.5 mb-3 flex justify-between text-[12px] tabular-nums" style={{ color: color.dim }}>
            <span>{pct}%</span>
            <span>100%</span>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => onRate(nextRate)}
              aria-label={`Speed ${rate}×, change to ${nextRate}×`}
              className={cn(ghost, 'h-11 min-w-12 px-2 text-[15px] font-bold tabular-nums')}
            >
              {rate}×
            </button>
            <button onClick={() => onSkip(-1)} aria-label="Previous sentence" className={cn(ghost, 'size-14')}>
              <SkipBack className="size-7 fill-current" />
            </button>
            <button
              ref={playRef}
              onClick={onToggle}
              aria-label={playing ? 'Pause' : 'Play'}
              className="grid size-[72px] place-items-center rounded-full bg-white shadow-lg transition-transform outline-offset-4 active:scale-95"
              style={{ color: color.bg }}
            >
              {playing ? <Pause className="size-8 fill-current" /> : <Play className="ml-1 size-8 fill-current" />}
            </button>
            <button onClick={() => onSkip(1)} aria-label="Next sentence" className={cn(ghost, 'size-14')}>
              <SkipForward className="size-7 fill-current" />
            </button>
            <button onClick={onStop} aria-label="Stop and return to the feed" title="Stop" className={cn(ghost, 'size-11')}>
              <Square className="size-5 fill-current" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
