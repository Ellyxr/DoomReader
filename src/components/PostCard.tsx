import { memo, useMemo, type ReactNode } from 'react'

import { BookAvatar } from '@/components/BookAvatar'
import { BookmarkIcon, HeartIcon, ReplyIcon, ShareIcon, VerifiedIcon, ViewsIcon } from '@/components/icons'
import { PostMedia } from '@/components/PostMedia'
import { bodyHtml, fmtTime, postImages, type Post } from '@/lib/feed'
import { findQuote, markHtml, postText, type Mark } from '@/lib/highlight'
import type { Note } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface Author {
  title: string
  handle: string
  avatar: string | null
  /** The book id, for loading the post's pictures. */
  book: string
}

export type PostAction = 'like' | 'mark' | 'share' | 'reply'

export function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** The reader's own avatar on notes. */
export const YouAvatar = ({ className }: { className?: string }) => (
  <span
    className={cn(
      'relative z-[1] grid size-10 shrink-0 place-items-center rounded-full bg-pill font-bold text-pill-foreground',
      className,
    )}
  >
    Y
  </span>
)

/** The highlighted words of a quote post. */
export const QuoteMark = ({ text }: { text: string }) => (
  <mark className="rounded-[3px] bg-[#ffd400]/45 box-decoration-clone px-0.5 text-inherit dark:bg-[#ffd400]/30">
    {text}
  </mark>
)

/**
 * The highlight a tap was meant for. The gap between lines belongs to the paragraph, not the <mark>, and fingers land
 * there often, so each line of a highlight counts a few pixels taller than it's drawn.
 */
function markNear(root: Element, x: number, y: number) {
  const slack = 8
  for (const m of root.querySelectorAll<HTMLElement>('mark.hl[data-n]'))
    for (const r of m.getClientRects())
      if (x >= r.left - 2 && x <= r.right + 2 && y >= r.top - slack && y <= r.bottom + slack) return m
  return null
}

/** A note shown under the post it replies to. */
function NoteReply({ note, onOpen }: { note: Note; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="mt-2 mb-1 flex w-full gap-2.5 rounded-2xl border p-3 text-left hover:bg-hover"
      aria-label="Edit your note"
    >
      <YouAvatar className="size-6 text-[11px]" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-[13px] leading-6 text-muted-foreground">
          <b className="font-bold text-foreground">You</b>
          {note.quote ? 'quoted' : 'replied'} · {ago(note.at)}
        </span>
        {note.quote && (
          <span className="mb-1 line-clamp-2 text-[14px] leading-snug text-muted-foreground">
            “<QuoteMark text={note.quote} />”
          </span>
        )}
        <span className="block whitespace-pre-wrap break-words">{note.text}</span>
      </span>
    </button>
  )
}

/** The X-style post shell, shared by book posts and the pinned welcome post. */
export function PostShell({
  author,
  avatar,
  time,
  context,
  threadUp,
  threadDown,
  aside,
  children,
  className,
  ...rest
}: {
  author: Pick<Author, 'title' | 'handle'>
  avatar: ReactNode
  time?: string
  context?: ReactNode
  threadUp?: boolean
  threadDown?: boolean
  /** A control at the end of the name line, such as a drag handle. */
  aside?: ReactNode
  children: ReactNode
} & React.ComponentProps<'article'>) {
  return (
    <article
      className={cn(
        'grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 border-b px-safe transition-colors hover:bg-hover',
        threadDown && 'border-b-transparent',
        className,
      )}
      {...rest}
    >
      <div className="relative pt-3">
        {threadUp && <i className="absolute top-0 left-[19px] h-2 w-0.5 bg-thread" />}
        {avatar}
        {threadDown && <i className="absolute top-14 -bottom-px left-[19px] w-0.5 bg-thread" />}
      </div>
      <div className="min-w-0 pt-3 pb-1">
        {context}
        <div className="flex min-w-0 items-center gap-1 leading-5">
          <span className="min-w-0 shrink truncate font-bold">{author.title}</span>
          <VerifiedIcon className="size-[18px] flex-none text-primary" />
          <span className="min-w-0 shrink-[100] truncate text-muted-foreground">{author.handle}</span>
          {time && (
            <>
              <span className="flex-none text-muted-foreground">·</span>
              <time className="flex-none text-muted-foreground">{time}</time>
            </>
          )}
          {aside && <span className="-my-2.5 -mr-2 ml-auto flex-none">{aside}</span>}
        </div>
        {children}
      </div>
    </article>
  )
}

function Action({
  label,
  pressed,
  tone,
  onClick,
  count,
  children,
}: {
  label: string
  pressed?: boolean
  tone: 'like' | 'primary'
  onClick: () => void
  count?: number
  children: ReactNode
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'group inline-flex min-h-[34px] items-center rounded-full text-[13px]',
        tone === 'like' ? 'hover:text-like' : 'hover:text-primary',
        pressed && (tone === 'like' ? 'text-like' : 'text-primary'),
      )}
    >
      <span
        className={cn(
          'grid size-[34px] place-items-center rounded-full transition-colors',
          tone === 'like' ? 'group-hover:bg-like/10' : 'group-hover:bg-primary/10',
        )}
      >
        {children}
      </span>
      {!!count && <span className="min-w-4 pr-1 tabular-nums">{count}</span>}
    </button>
  )
}

export const PostCard = memo(function PostCard({
  post,
  author,
  liked,
  marked,
  notes,
  solo,
  speaking,
  flash,
  selA,
  selB,
  onAction,
  onNote,
}: {
  post: Post
  author: Author
  liked: boolean
  marked: boolean
  notes?: Note[]
  /** In the Saved tab posts stand alone, without thread lines. */
  solo?: boolean
  /** Being read aloud. */
  speaking?: boolean
  /** Just jumped to from search. */
  flash?: boolean
  /** A finger selection in this post, as character offsets (see lib/highlight). */
  selA?: number
  selB?: number
  onAction: (post: Post, action: PostAction) => void
  onNote?: (note: Note) => void
}) {
  const icon = 'size-[18.75px]'
  // saved quotes are highlighted where they appear in the text; the selection being made is drawn on top
  const html = useMemo(() => {
    const base = bodyHtml(post)
    const quoted = notes?.some(n => n.quote)
    if (!quoted && selA === undefined) return base
    const { text } = postText(base)
    const marks: Mark[] = []
    notes?.forEach((n, k) => {
      const r = n.quote ? findQuote(text, n.quote) : null
      if (r) marks.push({ ...r, cls: 'hl', n: k })
    })
    if (selA !== undefined && selB !== undefined) marks.push({ a: selA, b: selB, cls: 'sel' })
    return markHtml(base, marks)
  }, [post, notes, selA, selB])
  const replies = notes?.filter(n => n.text)
  return (
    <PostShell
      data-i={post.i}
      author={author}
      avatar={<BookAvatar title={author.title} avatar={author.avatar} />}
      time={fmtTime(post.before)}
      threadUp={!solo && post.prev}
      threadDown={!solo && post.next}
      className={cn(speaking && 'bg-primary/[0.06] hover:bg-primary/[0.08]', flash && 'post-flash')}
    >
      <div
        className="post-text"
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={e => {
          const m = (e.target as Element).closest<HTMLElement>('mark.hl[data-n]') ?? markNear(e.currentTarget, e.clientX, e.clientY)
          const note = m && notes?.[Number(m.dataset.n)]
          if (note && onNote && !getSelection()?.toString()) onNote(note)
        }}
      />
      <PostMedia book={author.book} images={postImages(post)} />
      <div className="-ml-2 mt-2 flex max-w-[400px] justify-between text-muted-foreground">
        <Action
          label={notes?.length ? `Reply (${notes.length} notes)` : 'Reply'}
          tone="primary"
          count={notes?.length}
          onClick={() => onAction(post, 'reply')}
        >
          <ReplyIcon className={icon} />
        </Action>
        <Action label="Like" tone="like" pressed={liked} onClick={() => onAction(post, 'like')}>
          <HeartIcon className={cn(icon, liked && 'like-pop fill-current')} />
        </Action>
        <span
          className="inline-flex min-h-[34px] items-center text-[13px] tabular-nums"
          title="How far into the book this post is"
        >
          <span className="grid size-[34px] place-items-center">
            <ViewsIcon className={icon} />
          </span>
          {post.pct}%
        </span>
        <Action label="Bookmark" tone="primary" pressed={marked} onClick={() => onAction(post, 'mark')}>
          <BookmarkIcon className={cn(icon, marked && 'fill-current')} />
        </Action>
        <Action label="Copy this passage" tone="primary" onClick={() => onAction(post, 'share')}>
          <ShareIcon className={icon} />
        </Action>
      </div>
      {/* a quote without a comment is shown by its highlight alone */}
      {onNote && replies?.map(n => <NoteReply key={n.id} note={n} onOpen={() => onNote(n)} />)}
    </PostShell>
  )
})
