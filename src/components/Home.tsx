import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { useNavigate } from 'react-router'

import { BookAvatar } from '@/components/BookAvatar'
import { ago, handleOf, PostShell } from '@/components/PostCard'
import { Button } from '@/components/ui/button'
import { usePrefs } from '@/hooks/prefs'
import { getBook, getState, setPreview } from '@/lib/db'
import { openWithMorph } from '@/lib/morph'
import type { BookMeta, PostPreview } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Holding a preview this long opens it out in place, to read more of it without leaving Home. */
const HOLD_MS = 450
/** A finger that moves this far is scrolling, not holding. */
const SLOP_PX = 10

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
 * One book's next post. Tap it to open the book there, the card growing into the post (lib/morph); hold it to open it
 * out here and read the rest of the post first.
 */
function PreviewCard({ book, preview }: { book: BookMeta; preview: PostPreview | null }) {
  const navigate = useNavigate()
  const card = useRef<HTMLElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null)

  useLayoutEffect(() => {
    const el = text.current
    if (el && !open) setClipped(el.scrollHeight > el.clientHeight + 1)
  }, [preview, open])

  const go = () => {
    if (card.current) openWithMorph(card.current, book.id, () => navigate(`/read/${book.id}`))
  }
  const endHold = () => {
    if (hold.current) clearTimeout(hold.current.timer)
  }

  return (
    <PostShell
      ref={card}
      role="link"
      tabIndex={0}
      aria-label={`Continue ${book.title} at ${preview?.pct ?? book.progress}%`}
      author={{ title: book.title, handle: handleOf(book.author) }}
      avatar={<BookAvatar title={book.title} avatar={book.avatar} />}
      time={book.openedAt ? ago(book.openedAt) : undefined}
      context={
        <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-[13px] leading-4 text-muted-foreground">
          <BookOpen className="size-3.5 shrink-0" />
          <span className="truncate">{preview?.chapter || 'Continue reading'}</span>
        </div>
      }
      className="cursor-pointer select-none [-webkit-touch-callout:none]"
      onPointerDown={e => {
        hold.current = null
        if (e.button !== 0 || (!clipped && !open)) return
        const { clientX: x, clientY: y } = e
        hold.current = {
          x,
          y,
          fired: false,
          timer: window.setTimeout(() => {
            hold.current!.fired = true
            navigator.vibrate?.(10)
            setOpen(o => !o)
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
        // the hold already did something; this click is just its finger lifting
        if (hold.current?.fired) return void (hold.current = null)
        go()
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          go()
        }
      }}
    >
      {preview ? (
        <div
          ref={text}
          className={cn(
            'post-text',
            !open && 'max-h-[11.5em] overflow-hidden',
            !open && clipped && '[mask-image:linear-gradient(to_bottom,black_65%,transparent)]',
          )}
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
        {clipped && !open && <span className="max-[380px]:hidden">Hold to read more</span>}
        <span className="font-bold text-primary">Keep reading ›</span>
      </div>
    </PostShell>
  )
}

/** The Home tab: the post each book being read is at, the most recently read first. */
export function Home({ books, onLibrary }: { books: BookMeta[]; onLibrary: () => void }) {
  const { len } = usePrefs()
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
    <>
      {reading.map(b => (
        <PreviewCard key={b.id} book={b} preview={b.preview ?? made[b.id] ?? null} />
      ))}
    </>
  )
}
