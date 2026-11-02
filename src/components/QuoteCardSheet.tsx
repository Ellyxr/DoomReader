import { useEffect, useState } from 'react'
import { Copy, Download, Share, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { CARD_SIZES, cardFileName, drawCard, type CardBook, type CardSize, type CardTheme } from '@/lib/quoteCard'
import { cn } from '@/lib/utils'

export interface CardRequest {
  quote: string
  /** Text for the Copy button; without it there is no Copy button. */
  copy?: string
}

// the last size and look chosen, so a reader who posts to one place doesn't pick it every time
const KEY = 'doomreader:card'
function loadChoice(): { size: CardSize; theme: CardTheme | null } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { size: v.size in CARD_SIZES ? v.size : 'instagram', theme: v.theme === 'light' || v.theme === 'dark' ? v.theme : null }
  } catch {
    return { size: 'instagram', theme: null }
  }
}

/** Share a passage as a picture: pick the network's size and a light or dark card, then share or download it. */
export function QuoteCardSheet({
  card,
  book,
  onClose,
}: {
  card: CardRequest | null
  book: CardBook
  onClose: () => void
}) {
  return (
    <Dialog.Root open={!!card} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-[rgba(91,112,131,0.4)]" />
        {card && <Body card={card} book={book} onClose={onClose} />}
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Body({ card, book, onClose }: { card: CardRequest; book: CardBook; onClose: () => void }) {
  const [size, setSize] = useState<CardSize>(() => loadChoice().size)
  const [theme, setTheme] = useState<CardTheme>(
    () => loadChoice().theme ?? (document.documentElement.classList.contains('dark') ? 'dark' : 'light'),
  )
  // the picture last drawn, and the choice it was drawn for
  const [drawn, setDrawn] = useState<{ for: string; blob: Blob; url: string } | null>(null)
  const want = `${size}/${theme}`
  const blob = drawn?.for === want ? drawn.blob : null
  const url = drawn?.url ?? null

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ size, theme }))
    } catch {
      /* no storage: the choice lasts until the sheet closes */
    }
    let gone = false
    drawCard(card.quote, book, size, theme).then(
      b => !gone && setDrawn({ for: `${size}/${theme}`, blob: b, url: URL.createObjectURL(b) }),
      () => !gone && toast('Could not draw the card'),
    )
    return () => {
      gone = true
    }
  }, [card.quote, book, size, theme])
  // the last picture stays up, dimmed, while the next is drawn; it is let go once replaced
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])

  const file = blob && new File([blob], cardFileName(book.title, size), { type: 'image/png' })
  const canShare = !!file && !!navigator.canShare?.({ files: [file] })

  const share = async () => {
    if (!file) return
    try {
      await navigator.share({ files: [file], title: book.title })
      onClose()
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('Sharing is not available here', { description: 'Download the picture instead.' })
    }
  }
  const download = () => {
    if (!url || !file) return
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.append(a)
    a.click()
    a.remove()
    toast('Picture saved', { description: file.name })
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(card.copy!)
      toast('Copied to clipboard')
      onClose()
    } catch {
      toast('Copying is not available here')
    }
  }

  const { w, h } = CARD_SIZES[size]
  const chip = 'rounded-full px-3 py-1.5 text-[13px] font-bold transition-colors'
  return (
    <Dialog.Content
      className="fixed inset-x-0 bottom-0 z-[51] mx-auto flex max-h-[100dvh] w-full max-w-[600px] flex-col gap-3 rounded-t-2xl bg-background p-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] shadow-pop outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-8 data-[state=open]:fade-in-0 min-[601px]:top-1/2 min-[601px]:bottom-auto min-[601px]:-translate-y-1/2 min-[601px]:rounded-2xl"
      onOpenAutoFocus={e => e.preventDefault()}
    >
      <div className="flex items-center gap-2">
        <Dialog.Title className="flex-1 text-[17px] font-bold">Share as image</Dialog.Title>
        <Dialog.Close aria-label="Close" className="-mr-2 grid size-9 place-items-center rounded-full hover:bg-accent">
          <X className="size-5" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="sr-only">
        A picture of this passage with the book’s cover, title and author, sized for the network you choose.
      </Dialog.Description>

      <div className="grid h-[min(46dvh,420px)] shrink-0 place-items-center rounded-xl bg-secondary p-3">
        {url ? (
          <img
            src={url}
            alt="Preview of the quote card"
            className={cn('block max-h-full max-w-full rounded-lg border shadow-sm transition-opacity', !blob && 'opacity-50')}
          />
        ) : (
          <span className="block h-full animate-pulse rounded-lg bg-muted" style={{ aspectRatio: `${w} / ${h}` }} />
        )}
      </div>

      <div role="radiogroup" aria-label="Size" className="flex flex-wrap gap-1.5">
        {(Object.keys(CARD_SIZES) as CardSize[]).map(k => (
          <button
            key={k}
            role="radio"
            aria-checked={size === k}
            onClick={() => setSize(k)}
            className={cn(chip, size === k ? 'bg-pill text-pill-foreground' : 'bg-secondary hover:bg-accent')}
          >
            {CARD_SIZES[k].name} <span className="font-normal opacity-70">{CARD_SIZES[k].ratio}</span>
          </button>
        ))}
        <span className="mx-1 w-px self-stretch bg-border" />
        {(['light', 'dark'] as const).map(t => (
          <button
            key={t}
            role="radio"
            aria-checked={theme === t}
            aria-label={`${t === 'light' ? 'Light' : 'Dark'} card`}
            onClick={() => setTheme(t)}
            className={cn(chip, theme === t ? 'bg-pill text-pill-foreground' : 'bg-secondary hover:bg-accent')}
          >
            {t === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </div>
      <p className="-mt-1 text-[12px] text-muted-foreground tabular-nums">
        {w} × {h} px PNG
      </p>

      <div className="flex gap-2">
        {canShare && (
          <Button className="flex-1 rounded-full font-bold" onClick={() => void share()}>
            <Share />
            Share
          </Button>
        )}
        <Button
          variant={canShare ? 'outline' : 'default'}
          className="flex-1 rounded-full font-bold"
          disabled={!blob}
          onClick={download}
        >
          <Download />
          Download
        </Button>
        {card.copy && (
          <Button variant="outline" className="rounded-full font-bold" onClick={() => void copy()}>
            <Copy />
            Copy text
          </Button>
        )}
      </div>
    </Dialog.Content>
  )
}
