import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Dialog } from 'radix-ui'

import { getImage } from '@/lib/db'
import type { Segment } from '@/lib/feed'
import { textOf } from '@/lib/parse/html'
import { cn } from '@/lib/utils'

/** An object URL for a stored book picture, revoked when the component goes away. */
function useImageUrl(book: string, key: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    let u: string | null = null
    void getImage(book, key).then(r => {
      if (!live || !r) return
      u = URL.createObjectURL(r.blob)
      setUrl(u)
    })
    return () => {
      live = false
      if (u) URL.revokeObjectURL(u)
    }
  }, [book, key])
  return url
}

function Picture({ book, seg, className }: { book: string; seg: Segment; className?: string }) {
  const url = useImageUrl(book, seg.img ?? '')
  return url ? (
    <img src={url} alt={textOf(seg.html)} draggable={false} className={cn('block size-full', className)} />
  ) : (
    <span className={cn('block size-full bg-secondary', className)} />
  )
}

/** A picture's shape as shown: its own, kept within these limits (beyond them it is trimmed, as on X). */
const shapeOf = (s: Segment, min = 0.75, max = 2) => Math.min(max, Math.max(min, s.w && s.h ? s.w / s.h : 1))

/** The avatar column and its gap (PostShell): where the text, and each snapped picture, starts. Also 52px below. */
const GUTTER = 52

/**
 * Two or more pictures as a row to swipe through, as on X: all the same height, each whole in its own card, the next
 * one peeking in. The row reaches past the text into the avatar column on the left and to the edge on the right, so
 * the picture before peeks in there too; each card snaps to where the text starts. Arrows where there is a mouse.
 */
function Carousel({ book, images, onOpen }: { book: string; images: Segment[]; onOpen: (s: Segment) => void }) {
  const row = useRef<HTMLDivElement>(null)
  const [ends, setEnds] = useState({ start: true, end: false })
  const measure = () => {
    const el = row.current
    if (el) setEnds({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 })
  }
  useEffect(measure, [])
  /** Moves one card along; snapping settles it at the text's edge. */
  const step = (by: 1 | -1) => {
    const el = row.current
    if (!el) return
    const cards = [...el.children] as HTMLElement[]
    const at = el.scrollLeft
    const target =
      by > 0 ? cards.find(c => c.offsetLeft - GUTTER > at + 4) : cards.findLast(c => c.offsetLeft - GUTTER < at - 4)
    el.scrollTo({ left: target ? target.offsetLeft - GUTTER : by > 0 ? el.scrollWidth : 0, behavior: 'smooth' })
  }
  const arrow =
    'absolute top-1/2 z-[1] hidden size-9 -translate-y-1/2 place-items-center rounded-full bg-black/70 text-white backdrop-blur-sm transition-colors hover:bg-black/85 pointer-fine:grid'
  return (
    <div className="relative mt-3 -mr-4 -ml-[52px]">
      <div
        ref={row}
        onScroll={measure}
        className="relative flex h-[clamp(200px,62vw,340px)] snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain scroll-pl-[52px] pr-4 pl-[52px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((s, i) => (
          <button
            key={i}
            onClick={() => onOpen(s)}
            aria-label={`View picture ${i + 1} of ${images.length}`}
            className="h-full max-w-[calc(100%-68px)] shrink-0 snap-start overflow-hidden rounded-2xl border bg-secondary"
            style={{ aspectRatio: shapeOf(s, 0.5) }}
          >
            <Picture book={book} seg={s} className="object-cover" />
          </button>
        ))}
      </div>
      {!ends.start && (
        <button aria-label="Previous picture" onClick={() => step(-1)} className={cn(arrow, 'left-[60px]')}>
          <ChevronLeft className="size-5" />
        </button>
      )}
      {!ends.end && (
        <button aria-label="Next picture" onClick={() => step(1)} className={cn(arrow, 'right-6')}>
          <ChevronRight className="size-5" />
        </button>
      )}
    </div>
  )
}

/**
 * Pictures under a post: one keeps its shape (within limits), more scroll sideways (Carousel). The size is fixed
 * before the picture loads, so the feed never jumps while scrolling.
 */
export function PostMedia({ book, images }: { book: string; images: Segment[] }) {
  const [open, setOpen] = useState<Segment | null>(null)
  if (!images.length) return null

  let media: React.ReactNode
  if (images.length === 1) {
    const s = images[0]
    const shown = shapeOf(s)
    media = (
      <div className="mt-3 overflow-hidden rounded-2xl border bg-secondary">
        <button
          onClick={() => setOpen(s)}
          aria-label="View picture"
          className="block overflow-hidden"
          style={{ aspectRatio: shown, width: `min(100%, ${Math.round(510 * shown)}px)` }}
        >
          {/* within the limits nothing is cropped; beyond them it is trimmed, as on X, and shown whole when tapped */}
          <Picture book={book} seg={s} className="object-cover" />
        </button>
      </div>
    )
  } else media = <Carousel book={book} images={images} onOpen={setOpen} />

  return (
    <>
      {media}
      <Dialog.Root open={!!open} onOpenChange={o => !o && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content
            className="fixed inset-0 z-[51] grid place-items-center p-4 outline-none"
            onClick={() => setOpen(null)}
          >
            <Dialog.Title className="sr-only">Picture</Dialog.Title>
            <Dialog.Description className="sr-only">{open ? textOf(open.html) || 'A picture from the book' : ''}</Dialog.Description>
            {open && <Picture book={book} seg={open} className="max-h-[92vh] max-w-full size-auto! object-contain" />}
            <Dialog.Close
              aria-label="Close"
              className="fixed top-[max(12px,env(safe-area-inset-top))] left-3 grid size-9 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
            >
              <X className="size-5" />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
