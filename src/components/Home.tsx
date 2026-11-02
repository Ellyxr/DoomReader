import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { useNavigate } from 'react-router'

import { BookAvatar } from '@/components/BookAvatar'
import { ago, handleOf, PostShell } from '@/components/PostCard'
import { Button } from '@/components/ui/button'
import { usePrefs } from '@/hooks/prefs'
import { getBook, getState, setPreview } from '@/lib/db'
import { leaveHome, openWithMorph } from '@/lib/morph'
import type { BookMeta, PostPreview } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Holding a preview this long goes into the book. */
const HOLD_MS = 600
/** The hold shows itself only after this, so an ordinary tap never flashes it. */
const HOLD_SHOW_MS = 120
/** A finger that moves this far is scrolling, not holding. */
const SLOP_PX = 10

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export const inProgress = (b: BookMeta) => !!b.openedAt && b.progress < 100

/**
 * The post a book is at, for books read before previews were saved with the place (or moved by a sync link). Worked
 * out once from the book itself, then kept.
 */
async function makePreview(b: BookMeta, len: ReturnType<typeof usePrefs>['len']): Promise<PostPreview | null> {
  const [book, state, feed] = await Promise.all([getBook(b.id), getState(b.id), import('@/lib/feed')])
  if (!book) return null
  const { posts } = feed.buildPosts(feed.buildSegments(book.chapters), len)
  const p = posts[feed.postIndexOfSeg(posts, state?.seg ?? 0)]
  if (!p) return null
  const preview = feed.previewOf(p, book.chapters[p.ch]?.title ?? '')
  await setPreview(b.id, preview)
  return preview
}

/**
 * One book's next post. A tap opens the rest of the post out downward, in place; a second tap, or holding it, goes into
 * the book there (onEnter). A post short enough to show whole goes straight in.
 */
function PreviewCard({
  book,
  preview,
  onEnter,
}: {
  book: BookMeta
  preview: PostPreview | null
  onEnter: (card: HTMLElement) => void
}) {
  const card = useRef<HTMLElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [clipped, setClipped] = useState(false)
  /** Opened out: the full height it grows to, then 'all' once it has (so a new text size still fits). */
  const [open, setOpen] = useState<number | 'all' | null>(null)
  const hold = useRef<{ timer: number; show: number; x: number; y: number; fired: boolean } | null>(null)
  /** Being held: the card sinks in a little and a bar fills along its foot until it goes into the book. */
  const [holding, setHolding] = useState(false)

  useLayoutEffect(() => {
    const el = text.current
    if (el && open === null) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [preview, open])

  const enter = () => card.current && onEnter(card.current)
  const tap = () => {
    if (clipped && open === null && text.current) {
      setOpen(text.current.scrollHeight)
      if (still()) setOpen('all')
    } else enter()
  }
  const endHold = () => {
    if (hold.current) {
      clearTimeout(hold.current.timer)
      clearTimeout(hold.current.show)
    }
    setHolding(false)
  }

  return (
    <PostShell
      ref={card}
      data-home-card
      role="link"
      tabIndex={0}
      aria-label={`${book.title}, ${preview?.pct ?? book.progress}%. ${clipped && open === null ? 'Tap to read the whole post' : 'Tap to keep reading'}`}
      aria-expanded={clipped ? open !== null : undefined}
      author={{ title: book.title, handle: handleOf(book.author) }}
      avatar={<BookAvatar title={book.title} avatar={book.avatar} />}
      time={book.openedAt ? ago(book.openedAt) : undefined}
      context={
        <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-4 text-muted-foreground">
          <BookOpen className="size-3.5 shrink-0" />
          <span className="truncate">{preview?.chapter || 'Continue reading'}</span>
        </div>
      }
      className={cn(
        'relative cursor-pointer overflow-hidden select-none [-webkit-touch-callout:none]',
        'transition-[transform,background-color] duration-200 ease-out motion-reduce:transition-none',
        holding && 'scale-[0.985] bg-primary/[0.06] hover:bg-primary/[0.06] motion-reduce:scale-100',
      )}
      onPointerDown={e => {
        hold.current = null
        if (e.button !== 0) return
        const { clientX: x, clientY: y } = e
        hold.current = {
          x,
          y,
          fired: false,
          show: window.setTimeout(() => setHolding(true), HOLD_SHOW_MS),
          timer: window.setTimeout(() => {
            hold.current!.fired = true
            navigator.vibrate?.(10)
            enter()
          }, HOLD_MS),
        }
      }}
      onPointerMove={e => {
        const h = hold.current
        if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > SLOP_PX) endHold()
      }}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onContextMenu={e => e.preventDefault()}
      onClick={() => {
        // the hold already went in; this click is just its finger lifting
        if (hold.current?.fired) return void (hold.current = null)
        tap()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          tap()
        }
      }}
    >
      {preview ? (
        <div
          ref={text}
          data-clipped={(clipped && open === null) || undefined}
          className="post-text preview-text overflow-hidden"
          style={{ maxHeight: open === 'all' ? 'none' : open === null ? '11.5em' : `${open}px` }}
          onTransitionEnd={e => {
            if (e.propertyName === 'max-height' && typeof open === 'number') setOpen('all')
          }}
          dangerouslySetInnerHTML={{ __html: preview.html }}
        />
      ) : (
        <div className="post-text text-muted-foreground">…</div>
      )}
      <div className="mt-2 mb-2.5 flex items-center gap-3 text-[13px] text-muted-foreground">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-primary" style={{ width: `${preview?.pct ?? book.progress}%` }} />
        </div>
        <span className="tabular-nums">{preview?.pct ?? book.progress}%</span>
        <span className="font-bold text-primary" aria-live="polite">
          {holding ? 'Keep holding…' : clipped && open === null ? 'Read more' : 'Keep reading ›'}
        </span>
      </div>
      {/* fills over the rest of the hold; drains quickly if the finger lifts early */}
      <i
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-primary ease-linear"
        style={{
          transform: `scaleX(${holding ? 1 : 0})`,
          transitionProperty: 'transform',
          transitionDuration: holding ? `${HOLD_MS - HOLD_SHOW_MS}ms` : '150ms',
        }}
      />
    </PostShell>
  )
}

/** The Home tab: the post each book being read is at, the most recently read first. */
export function Home({ books, onLibrary }: { books: BookMeta[]; onLibrary: () => void }) {
  const { len } = usePrefs()
  const navigate = useNavigate()
  const reading = books.filter(inProgress)
  // previews worked out here for books that had none: one book per run, newest first, so a big library doesn't load
  // every book at once; each one done starts the next
  const [made, setMade] = useState<Record<string, PostPreview | null>>({})
  useEffect(() => {
    const b = books.find(b => inProgress(b) && !b.preview && !(b.id in made))
    if (!b) return
    let live = true
    void makePreview(b, len)
      .catch(() => null)
      .then(p => live && setMade(m => ({ ...m, [b.id]: p })))
    return () => {
      live = false
    }
  }, [books, made, len])

  const list = useRef<HTMLDivElement>(null)
  const entering = useRef(false)
  /** The other previews ease away, then the card goes into its book (lib/morph). */
  const enter = async (card: HTMLElement, id: string) => {
    if (entering.current) return
    entering.current = true
    await leaveHome(card, [...(list.current?.querySelectorAll<HTMLElement>('[data-home-card]') ?? [])])
    openWithMorph(card, id, () => navigate(`/read/${id}`))
  }

  if (!reading.length)
    return (
      <div className="mx-auto max-w-[420px] px-8 py-12">
        <h3 className="mb-2 text-[31px] leading-[1.1] font-extrabold tracking-tight">Nothing in progress</h3>
        <p className="mb-5 text-muted-foreground">
          Books you start reading show up here, each at the post you're on. Tap one to pick up where you left off.
        </p>
        <Button className="rounded-full font-bold" onClick={onLibrary}>
          Open your library
        </Button>
      </div>
    )

  return (
    <div ref={list}>
      {reading.map(b => (
        <PreviewCard
          key={b.id}
          book={b}
          preview={b.preview ?? made[b.id] ?? null}
          onEnter={card => void enter(card, b.id)}
        />
      ))}
    </div>
  )
}
