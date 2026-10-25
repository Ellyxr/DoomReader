import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'

import { BookAvatar } from '@/components/BookAvatar'
import { Fab } from '@/components/Fab'
import { PinIcon } from '@/components/icons'
import { useImporter } from '@/components/Importer'
import { PostCard, PostShell, type Author, type PostAction } from '@/components/PostCard'
import { SettingsPopover } from '@/components/SettingsPopover'
import { Button } from '@/components/ui/button'
import { usePrefs } from '@/hooks/prefs'
import { getBook, getState, markOpened, saveState } from '@/lib/db'
import { buildPosts, buildSegments, CHARS_PER_MIN, isOn, plainText, postIndexOfSeg, toggled, type Post } from '@/lib/feed'
import type { BookMeta, Chapter } from '@/lib/types'

type Tab = 'feed' | 'chapters' | 'saved'
const TABS: [Tab, string][] = [
  ['feed', 'Reading'],
  ['chapters', 'Chapters'],
  ['saved', 'Saved'],
]
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

async function copyText(txt: string) {
  try {
    await navigator.clipboard.writeText(txt)
    return true
  } catch {
    return false
  }
}

export default function Reader() {
  const { id = '' } = useParams()
  const [loaded, setLoaded] = useState<{
    id: string
    book: { meta: BookMeta; chapters: Chapter[] } | null
    saved: { seg: number; likes: number[]; marks: number[] }
  } | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all([getBook(id), getState(id)]).then(([b, s]) => {
      if (!live) return
      setLoaded({ id, book: b, saved: s ?? { seg: 0, likes: [], marks: [] } })
      if (b) {
        void markOpened(id)
        document.title = `${b.meta.title} · DoomReader`
      }
    })
    return () => {
      live = false
      document.title = 'DoomReader'
    }
  }, [id])

  if (loaded?.id !== id) return <div className="mx-auto min-h-screen max-w-[600px] min-[601px]:border-x" />
  if (!loaded.book) return <NotFound />
  return <Feed key={id} meta={loaded.book.meta} chapters={loaded.book.chapters} saved={loaded.saved} />
}

function NotFound() {
  return (
    <div className="mx-auto min-h-screen max-w-[600px] min-[601px]:border-x">
      <div className="mx-auto max-w-[420px] px-8 py-12">
        <h3 className="mb-2 text-[31px] leading-[1.1] font-extrabold tracking-tight">This book isn't here</h3>
        <p className="mb-5 text-muted-foreground">It may have been deleted, or this browser's data was cleared.</p>
        <Button asChild className="rounded-full font-bold">
          <Link to="/">Back to library</Link>
        </Button>
      </div>
    </div>
  )
}

function Feed({
  meta,
  chapters,
  saved,
}: {
  meta: BookMeta
  chapters: Chapter[]
  saved: { seg: number; likes: number[]; marks: number[] }
}) {
  const prefs = usePrefs()
  const segs = useMemo(() => buildSegments(chapters), [chapters])
  const { posts } = useMemo(() => buildPosts(segs, prefs.len), [segs, prefs.len])

  const [tab, setTab] = useState<Tab>('feed')
  const [likes, setLikes] = useState(() => new Set(saved.likes))
  const [marks, setMarks] = useState(() => new Set(saved.marks))
  const [cur, setCur] = useState(() => postIndexOfSeg(posts, saved.seg))
  const [atEnd, setAtEnd] = useState(false)
  const [rendered, setRendered] = useState(() => cur + 12)

  const author: Author = useMemo(
    () => ({
      title: meta.title,
      avatar: meta.avatar,
      handle: '@' + (meta.author.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 15) || 'reader'),
    }),
    [meta],
  )

  const headerRef = useRef<HTMLElement>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const pending = useRef<{ i: number; smooth: boolean } | null>({ i: cur, smooth: false })
  const feedY = useRef(0)

  // latest values for callbacks that must stay stable (so memoized posts don't re-render)
  const live = useRef({ posts, cur, likes, marks, tab, meta })
  useLayoutEffect(() => {
    live.current = { posts, cur, likes, marks, tab, meta }
  })

  /* ---------- saving ---------- */
  const persist = useCallback(() => {
    const { posts, cur, likes, marks, meta } = live.current
    const p = posts[cur]
    if (!p) return
    void saveState({ id: meta.id, seg: p.s, likes: [...likes], marks: [...marks] }, p.pct)
  }, [])
  const saveTimer = useRef(0)
  const saveSoon = useCallback(() => {
    clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(persist, 350)
  }, [persist])
  useEffect(() => {
    const flush = () => persist()
    addEventListener('pagehide', flush)
    return () => {
      removeEventListener('pagehide', flush)
      clearTimeout(saveTimer.current)
      flush()
    }
  }, [persist])

  /* ---------- scrolling ---------- */
  const headerOffset = () => headerRef.current?.getBoundingClientRect().bottom ?? 0

  const scrollToPost = useCallback((i: number, smooth: boolean) => {
    const n = live.current.posts.length
    i = Math.max(0, Math.min(n - 1, i))
    const el = feedRef.current?.children[i] as HTMLElement | undefined
    if (!el) {
      pending.current = { i, smooth }
      setRendered(r => Math.max(r, i + 10))
      return
    }
    const y = el.getBoundingClientRect().top + scrollY - headerOffset() + 1
    scrollTo({ top: y, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' })
  }, [])

  // back on the feed, return to where the reader was, unless a chapter jump is pending
  // (declared before the pending-scroll effect below, which must run after it)
  useLayoutEffect(() => {
    if (tab === 'feed') {
      if (!pending.current) scrollTo(0, feedY.current)
    } else scrollTo(0, 0)
  }, [tab])

  // honour a scroll that had to wait for its post to render
  useLayoutEffect(() => {
    const p = pending.current
    if (!p || tab !== 'feed') return
    const el = feedRef.current?.children[p.i] as HTMLElement | undefined
    if (!el) return
    pending.current = null
    if (p.i === 0) scrollTo(0, 0)
    else scrollTo({ top: el.getBoundingClientRect().top + scrollY - headerOffset() + 1, behavior: 'auto' })
  }, [rendered, posts, tab])

  // keep rendering ahead of the viewport, like the original's sentinel loop
  useEffect(() => {
    if (tab !== 'feed' || rendered >= posts.length) return
    const sen = sentinelRef.current
    if (sen && sen.getBoundingClientRect().top < innerHeight + 1500) setRendered(r => Math.min(posts.length, r + 20))
  }, [rendered, posts.length, tab])
  useEffect(() => {
    const sen = sentinelRef.current
    if (!sen) return
    const io = new IntersectionObserver(
      es => {
        if (es.some(e => e.isIntersecting) && live.current.tab === 'feed')
          setRendered(r => Math.min(live.current.posts.length, r + 20))
      },
      { rootMargin: '1500px 0px' },
    )
    io.observe(sen)
    return () => io.disconnect()
  }, [])

  // which post is under the header
  useEffect(() => {
    let ticking = false
    const track = () => {
      ticking = false
      if (live.current.tab !== 'feed') return
      const el = document.elementFromPoint(innerWidth / 2, headerOffset() + 16)?.closest<HTMLElement>('[data-feed] [data-i]')
      setAtEnd(innerHeight + scrollY >= document.documentElement.scrollHeight - 4)
      if (!el) return
      const i = Number(el.dataset.i)
      if (i !== live.current.cur) {
        setCur(i)
        saveSoon()
      }
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(track)
    }
    addEventListener('scroll', onScroll, { passive: true })
    return () => removeEventListener('scroll', onScroll)
  }, [saveSoon])

  // a new post length regroups posts: stay on the same passage
  const prevPosts = useRef(posts)
  useLayoutEffect(() => {
    if (prevPosts.current === posts) return
    const idx = postIndexOfSeg(posts, prevPosts.current[live.current.cur]?.s ?? 0)
    prevPosts.current = posts
    setCur(idx)
    pending.current = { i: idx, smooth: false }
    setRendered(idx + 12)
  }, [posts])

  /* ---------- tabs and keys ---------- */
  const switchTab = useCallback((t: Tab) => {
    if (live.current.tab === t) return
    if (live.current.tab === 'feed') feedY.current = scrollY
    setTab(t)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest?.('input,textarea')) return
      if (live.current.tab !== 'feed' || (e.key !== 'j' && e.key !== 'k')) return
      scrollToPost(live.current.cur + (e.key === 'j' ? 1 : -1), true)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [scrollToPost])

  /* ---------- post actions ---------- */
  const onAction = useCallback(
    async (p: Post, action: PostAction) => {
      if (action === 'share') {
        const { meta } = live.current
        const ok = await copyText(`${plainText(p)}\n\n— ${meta.author}, ${meta.title}`)
        toast(ok ? 'Copied to clipboard' : 'Copying is not available here')
        return
      }
      if (action === 'like') setLikes((live.current.likes = toggled(live.current.likes, p)))
      else setMarks((live.current.marks = toggled(live.current.marks, p)))
      persist()
    },
    [persist],
  )

  /* ---------- render ---------- */
  const current = posts[cur] ?? posts[0]
  const pct = atEnd && rendered >= posts.length ? 100 : (current?.pct ?? 0)
  const isSample = meta.format === 'sample'
  const { pick } = useImporter()

  return (
    <div className="mx-auto min-h-screen max-w-[600px] min-[601px]:border-x">
      <header
        ref={headerRef}
        className="sticky top-[env(safe-area-inset-top,0px)] z-20 bg-header backdrop-blur-[14px]"
      >
        <div className="flex min-h-[53px] items-center gap-3 py-2 px-safe">
          <Link
            to="/"
            aria-label="Back to library"
            className="-ml-2 grid size-[38px] shrink-0 place-items-center rounded-full hover:bg-accent"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <BookAvatar title={meta.title} avatar={meta.avatar} className="size-8 text-[15px]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] leading-[22px] font-extrabold">{meta.title}</div>
            <div className="truncate text-[13px] leading-4 text-muted-foreground tabular-nums">
              {pct}% · {chapters[current?.ch ?? 0]?.title}
            </div>
          </div>
          <SettingsPopover reader />
        </div>
        <div className="flex" role="tablist">
          {TABS.map(([t, label]) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => switchTab(t)}
              className="grid h-[53px] flex-1 place-items-center font-medium text-muted-foreground hover:bg-accent aria-selected:font-bold aria-selected:text-foreground"
            >
              <span className="relative inline-block py-[15px]">
                {label}
                {tab === t && <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-primary" />}
              </span>
            </button>
          ))}
        </div>
        <div className="h-0.5 bg-border">
          <i
            className="block h-full bg-primary transition-[width] duration-200 ease-linear motion-reduce:transition-none"
            style={{ width: pct + '%' }}
          />
        </div>
      </header>

      <main>
        <section hidden={tab !== 'feed'} className="pb-24">
          {isSample && <WelcomePost onOpen={pick} />}
          <div ref={feedRef} data-feed>
            {posts.slice(0, rendered).map(p => (
              <PostCard
                key={`${prefs.len}-${p.i}`}
                post={p}
                author={author}
                liked={isOn(likes, p)}
                marked={isOn(marks, p)}
                onAction={onAction}
              />
            ))}
          </div>
          <div ref={sentinelRef} className="h-px" />
          {rendered >= posts.length && (
            <div className="px-4 pt-10 pb-30 text-center text-muted-foreground">
              <strong className="mb-1 block text-xl text-foreground">You're all caught up</strong>
              That was the last post in the book.
            </div>
          )}
        </section>

        {tab === 'chapters' && (
          <ChapterList
            chapters={chapters}
            posts={posts}
            current={current?.ch ?? 0}
            onOpen={i => {
              pending.current = { i, smooth: false }
              setRendered(r => Math.max(r, i + 10))
              setTab('feed')
            }}
          />
        )}

        {tab === 'saved' && <SavedList posts={posts} author={author} likes={likes} marks={marks} onAction={onAction} />}
      </main>

      <Fab />
    </div>
  )
}

function WelcomePost({ onOpen }: { onOpen: () => void }) {
  return (
    <PostShell
      author={{ title: 'DoomReader', handle: '@doomreader' }}
      avatar={
        <span className="relative z-[1] grid size-10 place-items-center rounded-full bg-primary text-lg font-bold text-white">
          d
        </span>
      }
      context={
        <div className="mb-0.5 flex items-center gap-1.5 text-[13px] font-bold text-muted-foreground">
          <PinIcon className="size-3.5" />
          Pinned
        </div>
      }
    >
      <div className="post-text">
        <p>
          Add any EPUB or PDF with the blue button, or drop the file anywhere on this page. Each chapter becomes a thread,
          and your books, place, likes and bookmarks are kept on this device. Press j and k to move between posts.
        </p>
        <p>Below is a sample: the first two chapters of Pride and Prejudice, which is in the public domain.</p>
      </div>
      <button
        onClick={onOpen}
        className="mt-2.5 mb-3 inline-flex min-h-9 items-center rounded-full bg-pill px-4 font-bold text-pill-foreground hover:opacity-90"
      >
        Add a book
      </button>
    </PostShell>
  )
}

function ChapterList({
  chapters,
  posts,
  current,
  onOpen,
}: {
  chapters: Chapter[]
  posts: Post[]
  current: number
  onOpen: (postIndex: number) => void
}) {
  const stats = useMemo(() => {
    const st = chapters.map(() => ({ posts: 0, len: 0, first: -1 }))
    for (const p of posts) {
      const s = st[p.ch]
      if (s.first < 0) s.first = p.i
      s.posts++
      s.len += p.len
    }
    return st
  }, [chapters, posts])

  return (
    <section>
      {chapters.map((c, i) => (
        <button
          key={i}
          onClick={() => onOpen(Math.max(0, stats[i].first))}
          className="grid w-full gap-0.5 border-b py-3 text-left px-safe hover:bg-hover"
        >
          <span className="text-[13px] text-muted-foreground">
            {i + 1} of {chapters.length}
            {i === current && (
              <>
                {' · '}
                <b className="font-bold text-primary">Reading now</b>
              </>
            )}
          </span>
          <span className="text-[15px] font-bold">{c.title}</span>
          <span className="text-[13px] text-muted-foreground">
            {Math.max(1, Math.round(stats[i].len / CHARS_PER_MIN))} min · {stats[i].posts}{' '}
            {stats[i].posts === 1 ? 'post' : 'posts'}
          </span>
        </button>
      ))}
    </section>
  )
}

function SavedList({
  posts,
  author,
  likes,
  marks,
  onAction,
}: {
  posts: Post[]
  author: Author
  likes: Set<number>
  marks: Set<number>
  onAction: (p: Post, a: PostAction) => void
}) {
  const list = posts.filter(p => isOn(likes, p) || isOn(marks, p))
  if (!list.length)
    return (
      <div className="mx-auto max-w-[420px] px-8 py-12">
        <h3 className="mb-2 text-[31px] leading-[1.1] font-extrabold tracking-tight">Save posts to find them here</h3>
        <p className="text-muted-foreground">
          Like or bookmark a passage while you read and it will be collected on this tab.
        </p>
      </div>
    )
  return (
    <section className="pb-24">
      {list.map(p => (
        <PostCard
          key={p.i}
          post={p}
          author={author}
          liked={isOn(likes, p)}
          marked={isOn(marks, p)}
          solo
          onAction={onAction}
        />
      ))}
    </section>
  )
}
