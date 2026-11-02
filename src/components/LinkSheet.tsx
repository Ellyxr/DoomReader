import { useEffect, useState } from 'react'
import { Copy, ExternalLink, Mail, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { safeHref } from '@/lib/parse/html'

interface Pending {
  href: string
  /** The words the book shows for the link, when they aren't simply its address. */
  label: string | null
}

const bare = (s: string) => s.toLowerCase().replace(/^(https?:\/\/|mailto:)/, '').replace(/^www\./, '').replace(/\/$/, '')

/**
 * Links in post text don't open straight away: a book can contain anything, and a tap while scrolling or selecting is
 * easy to make by accident. A tap shows where the link really goes (and the words it is shown as, if those differ),
 * to open, copy or leave.
 */
export function LinkSheet() {
  const [link, setLink] = useState<Pending | null>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>('.post-text a[href]')
      if (!a) return
      e.preventDefault()
      const href = safeHref(a.getAttribute('href'))
      if (!href || getSelection()?.toString()) return
      const text = (a.textContent ?? '').trim()
      setLink({ href, label: text && !bare(href).startsWith(bare(text)) ? text : null })
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  const mail = link?.href.startsWith('mailto:')
  const url = link && !mail ? new URL(link.href) : null
  const where = mail ? link!.href.slice(7) : url?.hostname.replace(/^www\./, '')

  const open = () => {
    if (link) window.open(link.href, '_blank', 'noopener,noreferrer')
    setLink(null)
  }
  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(mail ? link.href.slice(7) : link.href)
      toast(mail ? 'Address copied' : 'Link copied')
    } catch {
      toast('Copying is not available here')
    }
    setLink(null)
  }

  return (
    <Dialog.Root open={!!link} onOpenChange={o => !o && setLink(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-[rgba(91,112,131,0.4)]" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-[51] grid w-[min(360px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-2xl bg-background p-4 shadow-pop outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <div className="flex items-center gap-2">
            <Dialog.Title className="flex-1 text-[17px] font-bold">
              {mail ? 'Write an email?' : 'Leave DoomReader?'}
            </Dialog.Title>
            <Dialog.Close aria-label="Close" className="-mr-2 grid size-9 place-items-center rounded-full hover:bg-accent">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description asChild>
            <div className="grid gap-1.5">
              <div className="flex min-w-0 items-center gap-2 text-[20px] leading-6 font-extrabold tracking-tight">
                {mail ? <Mail className="size-5 shrink-0" /> : <ExternalLink className="size-5 shrink-0" />}
                <span className="min-w-0 break-all">{where}</span>
              </div>
              {url && (url.pathname !== '/' || url.search) && (
                <p className="line-clamp-3 text-[13px] leading-4 break-all text-muted-foreground">{link!.href}</p>
              )}
              {link?.label && (
                <p className="text-[13px] leading-4 text-muted-foreground">
                  The book shows this link as <span className="text-foreground">“{link.label}”</span>.
                </p>
              )}
            </div>
          </Dialog.Description>
          <div className="flex gap-2">
            <Button className="flex-1 rounded-full font-bold" onClick={open}>
              {mail ? 'Open mail app' : 'Open link'}
            </Button>
            <Button variant="outline" className="rounded-full font-bold" onClick={() => void copy()}>
              <Copy />
              Copy
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
