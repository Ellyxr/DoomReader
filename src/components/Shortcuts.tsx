import { useRef, useState } from 'react'
import { Link, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hash } from '@/lib/parse/html'
import {
  addShortcut,
  cleanUrl,
  faviconOf,
  hostOf,
  MAX_SHORTCUTS,
  removeShortcut,
  updateShortcut,
  useShortcuts,
  type Shortcut,
} from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

const HOLD_MS = 500
const BUTTON = 'grid size-12 place-items-center overflow-hidden rounded-full border bg-background shadow-pop'

/** The site's favicon, or its initial on a colour from its name while offline or when it has none. */
function Face({ s }: { s: Shortcut }) {
  const [failed, setFailed] = useState<string | null>(null)
  const host = hostOf(s.url)
  if (failed === s.url)
    return (
      <span
        className="grid size-full place-items-center text-lg font-bold text-white"
        style={{ background: `hsl(${hash(host) % 360} 42% 30%)` }}
      >
        {(s.name.trim()[0] || host[0] || '?').toUpperCase()}
      </span>
    )
  return (
    <img
      src={faviconOf(s.url)}
      alt=""
      referrerPolicy="no-referrer"
      draggable={false}
      className="size-6"
      onError={() => setFailed(s.url)}
    />
  )
}

/** A shortcut: a tap opens the link, a long press (or right-click) edits it. */
function ShortcutButton({ s, onEdit }: { s: Shortcut; onEdit: () => void }) {
  const timer = useRef(0)
  const held = useRef(false)
  const cancel = () => clearTimeout(timer.current)
  return (
    <button
      className={cn(BUTTON, 'select-none [-webkit-touch-callout:none] hover:bg-accent')}
      aria-label={`Open ${s.name}`}
      title={`${s.name} (long-press or right-click to edit)`}
      onPointerDown={e => {
        if (e.button !== 0) return
        held.current = false
        timer.current = window.setTimeout(() => {
          held.current = true
          onEdit()
        }, HOLD_MS)
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={e => {
        e.preventDefault()
        cancel()
        if (!held.current) onEdit()
        held.current = true
      }}
      onClick={() => {
        if (held.current) return
        // noopener and noreferrer: the site gets no handle on DoomReader and isn't told where the visit came from
        window.open(s.url, '_blank', 'noopener,noreferrer')
      }}
    >
      <Face s={s} />
    </button>
  )
}

type Editing = { k: 'add' } | { k: 'edit'; s: Shortcut } | null

/** Up to three link shortcuts, bottom-left of the 600px column, mirroring the + and scan buttons on the right. */
export function Shortcuts() {
  const shortcuts = useShortcuts()
  const [editing, setEditing] = useState<Editing>(null)
  return (
    <>
      <div
        className="fixed z-25 flex gap-2"
        style={{
          bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
          left: 'calc(max(16px, (100vw - 600px) / 2 + 16px) + env(safe-area-inset-left, 0px))',
        }}
      >
        {shortcuts.map(s => (
          <ShortcutButton key={s.id} s={s} onEdit={() => setEditing({ k: 'edit', s })} />
        ))}
        {shortcuts.length < MAX_SHORTCUTS && (
          <button
            onClick={() => setEditing({ k: 'add' })}
            aria-label="Add a shortcut link"
            title="Add a shortcut link"
            className={cn(BUTTON, 'border-dashed border-muted-foreground/50 text-muted-foreground shadow-none hover:bg-accent')}
          >
            {/* not a + : that's the add-a-book button next door */}
            <Link className="size-5" />
          </button>
        )}
      </div>
      <ShortcutDialog editing={editing} onClose={() => setEditing(null)} />
    </>
  )
}

function ShortcutDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  return (
    <Dialog.Root open={!!editing} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-[rgba(91,112,131,0.4)]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[51] grid w-[min(360px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-2xl bg-background p-4 shadow-pop outline-none">
          {editing && <ShortcutForm key={editing.k === 'edit' ? editing.s.id : 'add'} editing={editing} onClose={onClose} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ShortcutForm({ editing, onClose }: { editing: NonNullable<Editing>; onClose: () => void }) {
  const current = editing.k === 'edit' ? editing.s : null
  const [link, setLink] = useState(current?.url ?? '')
  const [name, setName] = useState(current?.name ?? '')
  const [bad, setBad] = useState(false)

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!cleanUrl(link)) return setBad(true)
    if (current) updateShortcut(current.id, link, name)
    else {
      addShortcut(link, name)
      toast('Shortcut added', { description: 'Long-press it (or right-click) to edit or remove it.' })
    }
    onClose()
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      <div className="flex items-center gap-2">
        <Dialog.Title className="flex-1 text-[17px] font-bold">{current ? 'Edit shortcut' : 'Add a shortcut'}</Dialog.Title>
        <Dialog.Close aria-label="Close" className="-mr-2 grid size-9 place-items-center rounded-full hover:bg-accent">
          <X className="size-5" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="text-[13px] leading-4 text-muted-foreground">
        Up to {MAX_SHORTCUTS} links, kept on this device. They open in your browser.
      </Dialog.Description>
      <label className="grid gap-1 text-[13px] font-bold text-muted-foreground">
        Link
        <Input
          autoFocus
          // not type="url": that would refuse an address typed without https://
          inputMode="url"
          value={link}
          onChange={e => {
            setLink(e.target.value)
            setBad(false)
          }}
          placeholder="example.com"
          aria-invalid={bad || undefined}
          className="rounded-full font-normal text-foreground"
        />
        {bad && <span className="px-3 font-normal text-destructive">Enter a web address, like example.com.</span>}
      </label>
      <label className="grid gap-1 text-[13px] font-bold text-muted-foreground">
        Name (optional)
        <Input
          value={name}
          maxLength={40}
          onChange={e => setName(e.target.value)}
          placeholder={cleanUrl(link) ? hostOf(cleanUrl(link)!) : 'Shown when you hover it'}
          className="rounded-full font-normal text-foreground"
        />
      </label>
      <div className="flex gap-2">
        {current && (
          <Button
            type="button"
            variant="ghost"
            className="rounded-full font-bold text-destructive hover:text-destructive"
            onClick={() => {
              removeShortcut(current.id)
              onClose()
            }}
          >
            Remove
          </Button>
        )}
        <Button type="submit" className="ml-auto rounded-full font-bold" disabled={!link.trim()}>
          {current ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  )
}
