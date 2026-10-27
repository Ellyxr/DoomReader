import { useEffect, useMemo, useState } from 'react'
import { Copy, Share, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { encodeSync, syncLink, type SyncPayload } from '@/lib/sync'

/** Past this a QR code gets too dense for most phone cameras; the link still works. */
const MAX_QR = 1200

/** A QR code of `text` as an SVG data URL. The encoder loads only when a code is shown. */
async function qrImage(text: string) {
  const { renderSVG } = await import('uqr')
  return `data:image/svg+xml,${encodeURIComponent(renderSVG(text, { border: 2 }))}`
}

/**
 * "Continue on another device": a link (and QR code) holding this book's place, and optionally its likes, bookmarks
 * and notes. `payload` is null while closed.
 */
export function SyncDialog({ payload, onClose }: { payload: SyncPayload | null; onClose: () => void }) {
  const [withNotes, setWithNotes] = useState(true)
  const [made, setMade] = useState<{ for: SyncPayload; url: string; qr: string | null } | null>(null)

  const shared = useMemo(
    () =>
      payload && !withNotes
        ? { ...payload, state: { id: payload.id, seg: payload.state.seg, likes: [], marks: [] } }
        : payload,
    [payload, withNotes],
  )
  // a link made for an earlier payload or switch setting is not shown
  const link = made && made.for === shared ? made : null

  const extras = payload ? payload.state.likes.length + payload.state.marks.length + (payload.state.notes?.length ?? 0) : 0

  useEffect(() => {
    if (!shared) return
    const p = shared
    let live = true
    void (async () => {
      const url = syncLink(await encodeSync(p))
      const qr = url.length <= MAX_QR ? await qrImage(url).catch(() => null) : null
      if (live) setMade({ for: p, url, qr })
    })()
    return () => {
      live = false
    }
  }, [shared])

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      toast('Link copied')
    } catch {
      toast('Copying is not available here')
    }
  }
  const share = async () => {
    if (!link || !payload) return
    try {
      await navigator.share({ title: `Continue ${payload.title}`, url: link.url })
    } catch {
      /* cancelled */
    }
  }

  return (
    <Dialog.Root open={!!payload} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-[rgba(91,112,131,0.4)]" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-[51] grid w-[min(360px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-2xl bg-background p-4 shadow-pop outline-none"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <div className="flex items-center gap-2">
            <Dialog.Title className="flex-1 text-[17px] font-bold">Continue on another device</Dialog.Title>
            <Dialog.Close aria-label="Close" className="-mr-2 grid size-9 place-items-center rounded-full hover:bg-accent">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-[13px] leading-4 text-muted-foreground">
            Scan or open this on a device that has the same book file. It opens at {payload?.pct ?? 0}%. Your place is
            inside the link itself; nothing is uploaded.
          </Dialog.Description>

          <div className="grid aspect-square place-items-center rounded-xl border bg-white p-2">
            {link?.qr ? (
              <img src={link.qr} alt="QR code for the link" className="size-full [image-rendering:pixelated]" />
            ) : (
              <p className="px-6 text-center text-[13px] text-neutral-500">
                {link ? 'Too much to fit in a QR code. Copy or share the link instead.' : 'Making the link…'}
              </p>
            )}
          </div>

          {extras > 0 && (
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-[15px] leading-5">Include likes, bookmarks and notes</span>
              <Switch checked={withNotes} onCheckedChange={setWithNotes} />
            </label>
          )}

          <div className="flex gap-2">
            <Button className="flex-1 rounded-full font-bold" onClick={() => void copy()} disabled={!link}>
              <Copy />
              Copy link
            </Button>
            {'share' in navigator && (
              <Button variant="outline" className="flex-1 rounded-full font-bold" onClick={() => void share()} disabled={!link}>
                <Share />
                Share
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
