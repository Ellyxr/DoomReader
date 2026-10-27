import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { BookAvatar } from '@/components/BookAvatar'
import { useImporter } from '@/components/Importer'
import { Button } from '@/components/ui/button'
import { getBook, getState, onLibraryChange } from '@/lib/db'
import { applySync, decodeSync, setPendingSync, type SyncPayload } from '@/lib/sync'
import type { BookMeta } from '@/lib/types'

type View =
  | { k: 'loading' }
  | { k: 'bad' }
  | { k: 'missing'; p: SyncPayload }
  | { k: 'ready'; p: SyncPayload; meta: BookMeta; herePct: number | null }

const count = (n: number, one: string) => `${n} ${n === 1 ? one : one + 's'}`

/** Where a sync link lands: confirms the jump, or asks for the book first when this device doesn't have it. */
export default function Sync() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const { pick } = useImporter()
  const [view, setView] = useState<View>({ k: 'loading' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    const load = async () => {
      const p = await decodeSync(code)
      if (!live) return
      if (!p) return setView({ k: 'bad' })
      const [book, here] = await Promise.all([getBook(p.id), getState(p.id)])
      if (!live) return
      if (!book) {
        // adding the book from here (or anywhere) opens it at the link's place
        setPendingSync(code)
        return setView({ k: 'missing', p })
      }
      setView({ k: 'ready', p, meta: book.meta, herePct: here ? book.meta.progress : null })
    }
    void load()
    const off = onLibraryChange(() => void load())
    return () => {
      live = false
      off()
    }
  }, [code])

  const go = async () => {
    if (view.k !== 'ready') return
    setBusy(true)
    await applySync(view.p)
    navigate(`/read/${view.p.id}`, { replace: true })
  }

  const extras =
    view.k === 'ready' || view.k === 'missing'
      ? [
          view.p.state.notes?.length && count(view.p.state.notes.length, 'note'),
          view.p.state.likes.length && count(view.p.state.likes.length, 'like'),
          view.p.state.marks.length && count(view.p.state.marks.length, 'bookmark'),
        ].filter(Boolean)
      : []

  return (
    <div className="mx-auto min-h-screen max-w-[600px] min-[601px]:border-x">
      <div className="mx-auto max-w-[420px] px-8 py-12">
        {view.k === 'bad' && (
          <>
            <h3 className="mb-2 text-[31px] leading-[1.1] font-extrabold tracking-tight">This link doesn't work</h3>
            <p className="mb-5 text-muted-foreground">It may have been cut short when it was copied. Try sending it again.</p>
            <Button asChild className="rounded-full font-bold">
              <Link to="/">Back to library</Link>
            </Button>
          </>
        )}

        {view.k === 'missing' && (
          <>
            <h3 className="mb-2 text-[31px] leading-[1.1] font-extrabold tracking-tight">Add {view.p.title} first</h3>
            <p className="mb-5 text-muted-foreground">
              This device doesn't have the book yet. Add the same file you read on the other device and it will open
              at {view.p.pct}%{extras.length ? `, with your ${extras.join(', ')}` : ''}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button className="rounded-full font-bold" onClick={pick}>
                Choose the file
              </Button>
              <Button asChild variant="outline" className="rounded-full font-bold">
                <Link to="/">Back to library</Link>
              </Button>
            </div>
            <p className="mt-4 text-[13px] text-muted-foreground">
              It has to be the exact same EPUB or PDF. A different download or edition counts as another book.
            </p>
          </>
        )}

        {view.k === 'ready' && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <BookAvatar title={view.meta.title} avatar={view.meta.avatar} className="size-12" />
              <div className="min-w-0">
                <div className="truncate font-bold">{view.meta.title}</div>
                <div className="truncate text-muted-foreground">{view.meta.author}</div>
              </div>
            </div>
            <h3 className="mb-2 text-[31px] leading-[1.1] font-extrabold tracking-tight">Continue at {view.p.pct}%?</h3>
            <p className="mb-5 text-muted-foreground">
              {view.herePct === null ? 'You haven’t started it on this device.' : `This device is at ${view.herePct}%.`}
              {extras.length ? ` Your ${extras.join(', ')} from the other device will be added to the ones here.` : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button className="rounded-full font-bold" onClick={() => void go()} disabled={busy}>
                Continue reading
              </Button>
              <Button asChild variant="outline" className="rounded-full font-bold">
                <Link to="/">Not now</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
