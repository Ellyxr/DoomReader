import { useState } from 'react'
import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'

import { BookAvatar } from '@/components/BookAvatar'
import { QuoteMark, YouAvatar, type Author } from '@/components/PostCard'
import { Button } from '@/components/ui/button'
import { plainText, type Post } from '@/lib/feed'
import type { Note } from '@/lib/types'

const MAX = 10_000

export interface Draft {
  post: Post
  /** Highlighted words, for a quote post. */
  quote?: string
  /** The note being edited, if any. */
  note?: Note
}

const excerpt = (s: string, n = 220) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s)

/** The reply / quote box, shaped like X's: the post being answered on top, your text underneath. */
export function NoteComposer({
  draft,
  author,
  onClose,
  onSave,
  onDelete,
}: {
  draft: Draft | null
  author: Author
  onClose: () => void
  onSave: (text: string) => void
  onDelete: () => void
}) {
  return (
    <Dialog.Root open={!!draft} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-[rgba(91,112,131,0.4)]" />
        {/* keyed so each draft starts with its own text */}
        {draft && <Body key={draft.note?.id ?? draft.post.i} {...{ draft, author, onSave, onDelete }} />}
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Body({
  draft,
  author,
  onSave,
  onDelete,
}: {
  draft: Draft
  author: Author
  onSave: (text: string) => void
  onDelete: () => void
}) {
  const [text, setText] = useState(draft.note?.text ?? '')
  const quote = draft.note?.quote ?? draft.quote
  // a quote stands on its own; a reply needs words
  const ok = !!quote || text.trim().length > 0
  const save = () => ok && onSave(text.trim())
  const title = draft.note ? (draft.note.text ? 'Edit note' : 'Add a note') : quote ? 'Quote' : 'Reply'
  const action = draft.note || quote ? 'Save' : 'Reply'

  return (
    <Dialog.Content
      // above the overlay explicitly: Radix portals each child separately, so their DOM order isn't guaranteed
      className="fixed inset-x-0 top-0 z-[51] mx-auto flex max-h-[100dvh] w-full flex-col bg-background outline-none min-[601px]:top-[5vh] min-[601px]:max-h-[90vh] min-[601px]:max-w-[600px] min-[601px]:rounded-2xl"
      onOpenAutoFocus={e => {
        e.preventDefault()
        ;(e.currentTarget as HTMLElement).querySelector('textarea')?.focus()
      }}
    >
      <div className="flex min-h-[53px] items-center gap-2 px-safe pt-[env(safe-area-inset-top)]">
        <Dialog.Close aria-label="Close" className="-ml-2 grid size-10 place-items-center rounded-full hover:bg-accent">
          <X className="size-5" />
        </Dialog.Close>
        <Dialog.Title className="flex-1 text-[17px] font-bold">{title}</Dialog.Title>
        {draft.note && (
          <Button variant="ghost" className="rounded-full font-bold text-destructive hover:text-destructive" onClick={onDelete}>
            Delete
          </Button>
        )}
        <Button className="h-9 rounded-full px-4 font-bold" disabled={!ok} onClick={save}>
          {action}
        </Button>
      </div>

      <div className="overflow-y-auto px-safe pb-4">
        {quote ? null : (
          <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 pt-2">
            <div className="relative">
              <BookAvatar title={author.title} avatar={author.avatar} />
              <i className="absolute top-12 -bottom-2 left-[19px] w-0.5 bg-thread" />
            </div>
            <div className="min-w-0 pb-4">
              <div className="truncate font-bold">{author.title}</div>
              <p className="font-read text-[15px] whitespace-pre-line text-muted-foreground">
                {excerpt(plainText(draft.post))}
              </p>
              <p className="mt-3 text-[15px] text-muted-foreground">
                Replying to <span className="text-primary">{author.handle}</span>
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 pt-2">
          <YouAvatar />
          <div className="min-w-0">
            <Dialog.Description className="sr-only">
              {quote ? 'Add your comment to the highlighted passage.' : 'Write a private note on this post.'}
            </Dialog.Description>
            <textarea
              value={text}
              onChange={e => setText(e.target.value.slice(0, MAX))}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  save()
                }
              }}
              rows={quote ? 3 : 4}
              placeholder={quote ? 'Add a note (optional)' : 'Post your reply'}
              aria-label={quote ? 'Your note on this quote' : 'Your reply'}
              className="block w-full resize-none bg-transparent py-2 text-[20px] leading-snug outline-none placeholder:text-muted-foreground"
            />
            {quote && (
              <div className="mt-2 rounded-2xl border p-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <BookAvatar title={author.title} avatar={author.avatar} className="size-5 text-[10px]" />
                  <span className="truncate text-[15px] font-bold">{author.title}</span>
                </div>
                <p className="font-read text-[15px]">
                  <QuoteMark text={quote} />
                </p>
              </div>
            )}
            <p className="mt-3 border-t pt-2 text-right text-[13px] text-muted-foreground">
              Notes stay on this device.<span className="touch-hide"> Ctrl+Enter to {action.toLowerCase()}.</span>
            </p>
          </div>
        </div>
      </div>
    </Dialog.Content>
  )
}
