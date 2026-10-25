import { memo, type ReactNode } from 'react'

import { BookAvatar } from '@/components/BookAvatar'
import { BookmarkIcon, HeartIcon, ShareIcon, VerifiedIcon, ViewsIcon } from '@/components/icons'
import { bodyHtml, fmtTime, type Post } from '@/lib/feed'
import { cn } from '@/lib/utils'

export interface Author {
  title: string
  handle: string
  avatar: string | null
}

export type PostAction = 'like' | 'mark' | 'share'

/** The X-style post shell, shared by book posts and the pinned welcome post. */
export function PostShell({
  author,
  avatar,
  time,
  context,
  threadUp,
  threadDown,
  children,
  ...rest
}: {
  author: Pick<Author, 'title' | 'handle'>
  avatar: ReactNode
  time?: string
  context?: ReactNode
  threadUp?: boolean
  threadDown?: boolean
  children: ReactNode
} & React.ComponentProps<'article'>) {
  return (
    <article
      className={cn(
        'grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 border-b px-safe transition-colors hover:bg-hover',
        threadDown && 'border-b-transparent',
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
  children,
}: {
  label: string
  pressed?: boolean
  tone: 'like' | 'primary'
  onClick: () => void
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
    </button>
  )
}

export const PostCard = memo(function PostCard({
  post,
  author,
  liked,
  marked,
  solo,
  onAction,
}: {
  post: Post
  author: Author
  liked: boolean
  marked: boolean
  /** In the Saved tab posts stand alone, without thread lines. */
  solo?: boolean
  onAction: (post: Post, action: PostAction) => void
}) {
  const icon = 'size-[18.75px]'
  return (
    <PostShell
      data-i={post.i}
      author={author}
      avatar={<BookAvatar title={author.title} avatar={author.avatar} />}
      time={fmtTime(post.before)}
      threadUp={!solo && post.prev}
      threadDown={!solo && post.next}
    >
      <div className="post-text" dangerouslySetInnerHTML={{ __html: bodyHtml(post) }} />
      <div className="-ml-2 mt-2 flex max-w-[340px] justify-between text-muted-foreground">
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
    </PostShell>
  )
})
