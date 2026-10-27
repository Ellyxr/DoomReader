import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Archive, Download, HardDrive, MoreHorizontal, Search, ShieldCheck, Smartphone, Trash2, Upload } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'

import { Fab } from '@/components/Fab'
import { useImporter } from '@/components/Importer'
import { SettingsPopover } from '@/components/SettingsPopover'
import { SyncDialog } from '@/components/SyncDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { deleteBook, getState, listBooks, onLibraryChange, requestPersistence, storageInfo, type StorageInfo } from '@/lib/db'
import { hash } from '@/lib/parse/html'
import type { SyncPayload } from '@/lib/sync'
import type { BookMeta } from '@/lib/types'

const FORMAT = { epub: 'EPUB', pdf: 'PDF', sample: 'Sample' } as const

function bytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(t).toLocaleDateString()
}

function Cover({ book }: { book: BookMeta }) {
  if (book.cover)
    return <img src={book.cover} alt="" className="h-[72px] w-12 shrink-0 rounded-md border object-cover object-top" />
  return (
    <span
      className="grid h-[72px] w-12 shrink-0 place-items-center rounded-md text-xl font-bold text-white"
      style={{ background: `hsl(${hash(book.title) % 360} 42% 30%)` }}
    >
      {(book.title.trim()[0] || 'B').toUpperCase()}
    </span>
  )
}

function BookRow({
  book,
  onDelete,
  onSync,
}: {
  book: BookMeta
  onDelete: (b: BookMeta) => void
  onSync: (b: BookMeta) => void
}) {
  return (
    <div className="relative flex gap-3 border-b py-3 px-safe hover:bg-hover">
      <Cover book={book} />
      <div className="min-w-0 flex-1">
        <Link to={`/read/${book.id}`} className="block truncate font-bold after:absolute after:inset-0">
          {book.title}
        </Link>
        <div className="truncate text-muted-foreground">{book.author}</div>
        <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
          {FORMAT[book.format]} · {book.chapterCount} {book.chapterCount === 1 ? 'chapter' : 'chapters'} ·{' '}
          {book.openedAt ? `Opened ${ago(book.openedAt)}` : 'Not started'}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-primary" style={{ width: `${book.progress}%` }} />
          </div>
          <span className="w-9 text-right text-[13px] text-muted-foreground tabular-nums">{book.progress}%</span>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More options for ${book.title}`}
          className="relative z-[1] -mr-2 grid size-[34px] shrink-0 place-items-center self-start rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"
        >
          <MoreHorizontal className="size-[18px]" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="rounded-xl shadow-pop">
          {book.openedAt && (
            <DropdownMenuItem onSelect={() => onSync(book)}>
              <Smartphone />
              Continue on another device
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(book)}>
            <Trash2 />
            Delete from library
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Backing up and restoring the whole library as one file. The zip code loads only when it is used. */
function useBackup() {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const backUp = async () => {
    if (busy) return
    setBusy(true)
    const t = toast.loading('Preparing your backup…')
    try {
      const { createBackup, downloadBackup } = await import('@/lib/backup')
      const { blob, count } = await createBackup((a, b) => toast.loading(`Preparing your backup (${a} of ${b})…`, { id: t }))
      downloadBackup(blob)
      toast.success(`Backed up ${count} ${count === 1 ? 'book' : 'books'}`, {
        id: t,
        description: 'Keep the file somewhere safe. Restore it here or on another device.',
      })
    } catch (e) {
      console.error(e)
      toast.error('Could not make the backup', { id: t, description: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const restore = async (file: File) => {
    setBusy(true)
    const t = toast.loading(`Restoring ${file.name}…`)
    try {
      const { restoreBackup } = await import('@/lib/backup')
      const { added, merged } = await restoreBackup(file, (a, b) => toast.loading(`Restoring (${a} of ${b})…`, { id: t }))
      const parts = [added && `${added} added`, merged && `${merged} already here, notes and marks combined`].filter(Boolean)
      toast.success('Backup restored', { id: t, description: parts.join(' · ') || 'Nothing new in that file.' })
      void requestPersistence()
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : 'Could not restore that file.', { id: t, description: file.name })
    } finally {
      setBusy(false)
    }
  }

  const field = (
    <input
      ref={input}
      type="file"
      accept=".zip,application/zip"
      hidden
      onChange={e => {
        const f = e.target.files?.[0]
        if (f) void restore(f)
        e.target.value = ''
      }}
    />
  )
  return { busy, backUp, pickRestore: () => input.current?.click(), field }
}

function BackupCard({ busy, onBackUp, onRestore }: { busy: boolean; onBackUp: () => void; onRestore: () => void }) {
  return (
    <div className="rounded-2xl border p-3">
      <p className="mb-2 text-foreground">
        Your books live only in this browser. Download a backup to keep them safe, or to move your library, notes and
        place to another device.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="rounded-full font-bold" onClick={onBackUp} disabled={busy}>
          <Archive />
          Back up library
        </Button>
        <Button size="sm" variant="outline" className="rounded-full font-bold" onClick={onRestore} disabled={busy}>
          <Upload />
          Restore
        </Button>
      </div>
    </div>
  )
}

function StorageFooter({
  info,
  onPersist,
  backup,
}: {
  info: StorageInfo | null
  onPersist: () => void
  backup: React.ReactNode
}) {
  if (!info?.supported) return <div className="grid gap-3 px-safe py-6 text-[13px]">{backup}</div>
  return (
    <div className="grid gap-3 px-safe py-6 text-[13px] text-muted-foreground">
      <div className="flex items-center gap-2">
        <HardDrive className="size-4 shrink-0" />
        <span>
          {bytes(info.usage)} used on this device{info.quota ? ` of ${bytes(info.quota)} available` : ''}. Books never
          leave this browser.
        </span>
      </div>
      {info.persisted ? (
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          <span>Protected storage is on: the browser won't clear your library to free up space.</span>
        </div>
      ) : (
        <div className="rounded-2xl border p-3">
          <p className="mb-2 text-foreground">
            Browsers may clear site data when the disk is nearly full. Turn on protected storage to keep your library
            until you clear it yourself.
          </p>
          <Button size="sm" className="rounded-full font-bold" onClick={onPersist}>
            Protect my library
          </Button>
        </div>
      )}
      {backup}
    </div>
  )
}

export default function Library() {
  const { pick } = useImporter()
  const install = useInstallPrompt()
  const [books, setBooks] = useState<BookMeta[] | null>(null)
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [query, setQuery] = useState('')
  const [toDelete, setToDelete] = useState<BookMeta | null>(null)
  const [syncing, setSyncing] = useState<SyncPayload | null>(null)
  const openSync = async (b: BookMeta) => {
    const state = (await getState(b.id)) ?? { id: b.id, seg: 0, likes: [], marks: [] }
    setSyncing({ id: b.id, title: b.title, pct: b.progress, state })
  }
  const backup = useBackup()

  const refresh = useCallback(() => {
    void listBooks().then(setBooks)
    void storageInfo().then(setInfo)
  }, [])
  useEffect(() => {
    refresh()
    return onLibraryChange(refresh)
  }, [refresh])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!books || !q) return books
    return books.filter(b => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q))
  }, [books, query])

  const persist = async () => {
    const ok = await requestPersistence()
    toast(ok ? 'Your library is protected' : 'The browser declined for now', {
      description: ok ? undefined : 'Installing DoomReader as an app usually lets it keep storage.',
    })
    refresh()
  }

  return (
    <div className="mx-auto min-h-screen max-w-[600px] min-[601px]:border-x">
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-20 border-b bg-header backdrop-blur-[14px]">
        <div className="flex min-h-[53px] items-center gap-3 py-2 px-safe">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-[15px] font-bold text-white">
            d
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] leading-[22px] font-extrabold">Library</div>
            <div className="truncate text-[13px] leading-4 text-muted-foreground tabular-nums">
              {books ? `${books.length} ${books.length === 1 ? 'book' : 'books'}` : ' '}
            </div>
          </div>
          {install && (
            <Button size="sm" variant="outline" className="rounded-full font-bold" onClick={install}>
              <Download />
              Install
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Library options"
              className="grid size-[38px] shrink-0 place-items-center rounded-full hover:bg-accent"
            >
              <MoreHorizontal className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl shadow-pop">
              <DropdownMenuItem onSelect={() => void backup.backUp()} disabled={backup.busy || !books?.length}>
                <Archive />
                Back up library
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={backup.pickRestore} disabled={backup.busy}>
                <Upload />
                Restore from backup
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <SettingsPopover />
        </div>
        {books && books.length > 3 && (
          <div className="relative pb-3 px-safe">
            <Search className="pointer-events-none absolute top-2.5 left-[max(28px,calc(env(safe-area-inset-left,0px)+12px))] size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search your library"
              aria-label="Search your library"
              className="rounded-full border-transparent bg-secondary pl-10"
            />
          </div>
        )}
      </header>

      <main className="pb-28">
        {books && !books.length && (
          <div className="mx-auto max-w-[420px] px-8 py-12">
            <h3 className="mb-2 text-[31px] leading-[1.1] font-extrabold tracking-tight">Your library is empty</h3>
            <p className="mb-5 text-muted-foreground">
              Add an EPUB or PDF and it will be kept here, on this device, ready to open any time — even offline.
            </p>
            <Button className="rounded-full font-bold" onClick={pick}>
              Add a book
            </Button>
          </div>
        )}
        {shown?.map(b => <BookRow key={b.id} book={b} onDelete={setToDelete} onSync={b => void openSync(b)} />)}
        {shown && books && books.length > 0 && !shown.length && (
          <p className="px-safe py-8 text-center text-muted-foreground">No books match "{query}".</p>
        )}
        <StorageFooter
          info={info}
          onPersist={persist}
          backup={<BackupCard busy={backup.busy} onBackUp={() => void backup.backUp()} onRestore={backup.pickRestore} />}
        />
        {backup.field}
      </main>

      <AlertDialog open={!!toDelete} onOpenChange={o => !o && setToDelete(null)}>
        <AlertDialogContent className="max-w-[320px] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this book?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.title} and your place, likes and bookmarks in it will be removed from this device. You can add
              the file again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive font-bold text-white hover:bg-destructive/90"
              onClick={() => {
                if (!toDelete) return
                void deleteBook(toDelete.id).then(() => toast(`Deleted ${toDelete.title}`))
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SyncDialog payload={syncing} onClose={() => setSyncing(null)} />
      <Fab />
    </div>
  )
}
