import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
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

/**
 * Pictures under a post, laid out like X: one keeps its shape (within limits), two to four share a 16:9 grid.
 * The size is fixed before the picture loads, so the feed never jumps while scrolling.
 */
export function PostMedia({ book, images }: { book: string; images: Segment[] }) {
  const [open, setOpen] = useState<Segment | null>(null)
  if (!images.length) return null

  let grid: React.ReactNode
  if (images.length === 1) {
    const s = images[0]
    const ratio = s.w && s.h ? s.w / s.h : 1
    const shown = Math.min(2, Math.max(0.75, ratio))
    grid = (
      <button
        onClick={() => setOpen(s)}
        aria-label="View picture"
        className="block overflow-hidden"
        style={{ aspectRatio: shown, width: `min(100%, ${Math.round(510 * shown)}px)` }}
      >
        {/* within the limits nothing is cropped; beyond them it is trimmed, as on X, and shown whole when tapped */}
        <Picture book={book} seg={s} className="object-cover" />
      </button>
    )
  } else {
    grid = (
      <div className="grid aspect-video grid-cols-2 grid-rows-2 gap-0.5">
        {images.map((s, i) => (
          <button
            key={i}
            onClick={() => setOpen(s)}
            aria-label={`View picture ${i + 1} of ${images.length}`}
            className={cn(
              'overflow-hidden',
              (images.length === 2 || (images.length === 3 && i === 0)) && 'row-span-2',
            )}
          >
            <Picture book={book} seg={s} className="object-cover" />
          </button>
        ))}
      </div>
    )
  }

  return (
    <>
      <div className="mt-3 overflow-hidden rounded-2xl border bg-secondary">{grid}</div>
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
