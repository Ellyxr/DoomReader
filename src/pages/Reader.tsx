import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowDownUp,
  ChevronUp,
  Copy,
  GripVertical,
  Headphones,
  Highlighter,
  MessageSquarePlus,
  Pause,
  Pencil,
  Play,
  Search,
  Square,
  X,
} from 'lucide-react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'

import { BookAvatar } from '@/components/BookAvatar'
import { Fab } from '@/components/Fab'
import { PinIcon } from '@/components/icons'
import { useImporter } from '@/components/Importer'
import { NoteComposer, type Draft } from '@/components/NoteComposer'
import { Podcast } from '@/components/Podcast'
import { ago, PostCard, PostShell, QuoteMark, YouAvatar, type Author, type PostAction } from '@/components/PostCard'
import { SettingsPopover } from '@/components/SettingsPopover'
import { SyncDialog } from '@/components/SyncDialog'
import { Button } from '@/components/ui/button'
import { WordTip } from '@/components/WordTip'
import { usePrefs } from '@/hooks/prefs'
import { useAutoScroll, type AutoScroll } from '@/hooks/useAutoScroll'
import { useReorder } from '@/hooks/useReorder'
import { useSentenceSelect } from '@/hooks/useSentenceSelect'
import { RATES, speechSupported, useSpeech } from '@/hooks/useSpeech'
import { getBook, getState, markOpened, saveState } from '@/lib/db'
import { downloadDictionary } from '@/lib/dictionary'
import {
  buildPosts,
  buildSegments,
  CHARS_PER_MIN,
  isOn,
  plainText,
  postIndexOfSeg,
  searchBook,
  toggled,
  type Post,
  type Segment,
} from '@/lib/feed'
import { segOfQuote } from '@/lib/highlight'
import { inBookOrder, insertByBook, moved, sortByBook } from '@/lib/notes'
import { takePendingSync, type SyncPayload } from '@/lib/sync'
import type { BookMeta, Chapter, Note } from '@/lib/types'
import { cn } from '@/lib/utils'

type Tab = 'feed' | 'chapters' | 'saved' | 'notes' | 'search'
const TABS: [Tab, string][] = [
  ['feed', 'Reading'],
  ['chapters', 'Chapters'],
  ['saved', 'Saved'],
  ['notes', 'Notes'],
]
type Saved = { seg: number; likes: number[]; marks: number[]; notes?: Note[]; notesCustom?: boolean }

const vibrateOnce = () => {
  try {
    navigator.vibrate?.(15)
  } catch {
    /* not on this device */
  }
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2)
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
    saved: Saved
  } | null>(null)

  useEffect(() => {
    let live = true
    // a sync link opened before this book was added takes effect now
    const synced = takePendingSync(id).catch(() => null)
    void Promise.all([getBook(id), synced.then(() => getState(id)), synced]).then(([b, s, p]) => {
      if (!live) return
      setLoaded({ id, book: b, saved: s ?? { seg: 0, likes: [], marks: [] } })
      if (b) void markOpened(id)
      if (b && p) toast(`Picked up at ${p.pct}%`, { description: 'From your other device.' })
    })
    return () => {
      live = false
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
  saved: Saved
}) {
  const prefs = usePrefs()
  const segs = useMemo(() => buildSegments(chapters), [chapters])
  const { posts } = useMemo(() => buildPosts(segs, prefs.len), [segs, prefs.len])

  const [tab, setTab] = useState<Tab>('feed')
  const [likes, setLikes] = useState(() => new Set(saved.likes))
  const [marks, setMarks] = useState(() => new Set(saved.marks))
  // notes saved before they could be reordered are in the order they were written; put those in book order
  const [notes, setNotes] = useState<Note[]>(() =>
    saved.notesCustom ? (saved.notes ?? []) : sortByBook(saved.notes ?? [], segs),
  )
  const notesCustom = useMemo(() => !inBookOrder(notes, segs), [notes, segs])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [flash, setFlash] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [cur, setCur] = useState(() => postIndexOfSeg(posts, saved.seg))
  const [atEnd, setAtEnd] = useState(false)
  const [rendered, setRendered] = useState(() => cur + 12)

  const author: Author = useMemo(
    () => ({
      title: meta.title,
      avatar: meta.avatar,
      handle: '@' + (meta.author.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 15) || 'reader'),
      book: meta.id,
    }),
    [meta],
  )

  // notes grouped by the post they belong to at the current post length (arrays stay stable for memoized posts)
  const notesByPost = useMemo(() => {
    const m = new Map<number, Note[]>()
    for (const n of notes) {
      const i = postIndexOfSeg(posts, n.seg)
      m.set(i, [...(m.get(i) ?? []), n])
    }
    return m
  }, [notes, posts])

  const headerRef = useRef<HTMLElement>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const pending = useRef<{ i: number; smooth: boolean } | null>({ i: cur, smooth: false })
  const feedY = useRef(0)

  // latest values for callbacks that must stay stable (so memoized posts don't re-render)
  const live = useRef({ posts, cur, likes, marks, notes, tab, meta, segs })
  useLayoutEffect(() => {
    live.current = { posts, cur, likes, marks, notes, tab, meta, segs }
  })

  /* ---------- saving ---------- */
  const persist = useCallback(() => {
    const { posts, cur, likes, marks, notes, meta, segs } = live.current
    const p = posts[cur]
    if (!p) return
    const custom = !inBookOrder(notes, segs)
    void saveState(
      { id: meta.id, seg: p.s, likes: [...likes], marks: [...marks], notes, ...(custom ? { notesCustom: true } : {}) },
      p.pct,
    )
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
      if (e.key === 'Escape' && live.current.tab === 'search' && !document.querySelector('[role=dialog]')) {
        switchTab('feed')
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest?.('input,textarea,[role=dialog]')) return
      if (e.key === '/') {
        e.preventDefault()
        switchTab('search')
        return
      }
      if (live.current.tab !== 'feed' || (e.key !== 'j' && e.key !== 'k')) return
      scrollToPost(live.current.cur + (e.key === 'j' ? 1 : -1), true)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [scrollToPost, switchTab])

  /** Opens the feed at post `i` (from chapters, search or a note), optionally flashing it so it is easy to spot. */
  const jumpTo = useCallback((i: number, highlight = false) => {
    pending.current = { i, smooth: false }
    setRendered(r => Math.max(r, i + 10))
    setTab('feed')
    if (highlight) setFlash(i)
  }, [])
  useEffect(() => {
    if (flash === null) return
    const t = setTimeout(() => setFlash(null), 1800)
    return () => clearTimeout(t)
  }, [flash])

  /* ---------- post actions ---------- */
  const onAction = useCallback(
    async (p: Post, action: PostAction) => {
      if (action === 'share') {
        const { meta } = live.current
        const ok = await copyText(`${plainText(p)}\n\n— ${meta.author}, ${meta.title}`)
        toast(ok ? 'Copied to clipboard' : 'Copying is not available here')
        return
      }
      if (action === 'reply') {
        setDraft({ post: p })
        return
      }
      if (action === 'like') setLikes((live.current.likes = toggled(live.current.likes, p)))
      else setMarks((live.current.marks = toggled(live.current.marks, p)))
      persist()
    },
    [persist],
  )

  /* ---------- notes ---------- */
  const setAndSaveNotes = (next: Note[]) => {
    live.current.notes = next
    setNotes(next)
    persist()
  }
  const saveDraft = (text: string) => {
    if (!draft) return
    const { post, quote, note } = draft
    if (note) setAndSaveNotes(notes.map(n => (n.id === note.id ? { ...n, text } : n)))
    else {
      const seg = quote ? segOfQuote(post, quote) : post.s
      const added = { id: newId(), seg, text, at: Date.now(), ...(quote ? { quote } : {}) }
      setAndSaveNotes(insertByBook(notes, added, segs))
      toast(quote ? 'Quote saved to Notes' : 'Reply saved to Notes')
    }
    setDraft(null)
  }
  const deleteDraft = () => {
    if (!draft?.note) return
    const gone = draft.note
    const was = notes.findIndex(n => n.id === gone.id)
    setAndSaveNotes(notes.filter(n => n.id !== gone.id))
    setDraft(null)
    toast('Note deleted', {
      action: {
        label: 'Undo',
        onClick: () => {
          const rest = live.current.notes
          setAndSaveNotes([...rest.slice(0, was), gone, ...rest.slice(was)])
        },
      },
    })
  }
  const moveNote = (from: number, to: number) => setAndSaveNotes(moved(notes, from, to))
  const sortNotes = () => setAndSaveNotes(sortByBook(notes, segs))
  const editNote = useCallback((n: Note) => {
    const { posts } = live.current
    const post = posts[postIndexOfSeg(posts, n.seg)]
    if (post) setDraft({ post, note: n })
  }, [])

  /* ---------- selecting passages ---------- */
  const { sel, clear: clearSel, word, clearWord, quoteWord } = useSentenceSelect(posts, prefs.define)
  // the selection being made, or else the word being looked up, is drawn in its post
  const marked = sel && !sel.native ? sel : word
  useEffect(() => {
    if (prefs.define) void downloadDictionary()
    else clearWord()
  }, [prefs.define, clearWord])
  useEffect(() => clearWord(), [tab, clearWord])

  /** Saves the selection as a quote straight away; a note can be added from the toast, or later by tapping it. */
  const saveQuote = () => {
    if (!sel) return
    const post = posts[sel.post]
    const note: Note = { id: newId(), seg: segOfQuote(post, sel.quote), quote: sel.quote, text: '', at: Date.now() }
    setAndSaveNotes(insertByBook(notes, note, segs))
    clearSel()
    vibrateOnce()
    toast('Quote saved', {
      description: 'Tap the highlight any time to add a note.',
      action: { label: 'Add note', onClick: () => setDraft({ post, note }) },
    })
  }
  // toasts sit where the action bar goes (and above it), so starting a selection clears them away
  const selecting = !!sel
  useEffect(() => {
    if (selecting) toast.dismiss()
  }, [selecting])
  useEffect(() => {
    if (!sel) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !draft && clearSel()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [sel, draft, clearSel])

  /* ---------- read aloud ---------- */
  const speech = useSpeech(
    posts,
    i => {
      if (live.current.tab === 'feed') scrollToPost(i, true)
    },
    () => toast('Read aloud stopped', { description: 'This browser could not play its voice.' }),
  )
  const chapterTitle = chapters[posts[speech.post ?? cur]?.ch ?? 0]?.title ?? ''
  const toggleSpeech = () => (speech.playing ? speech.pause() : speech.play(speech.post ?? cur))

  /* ---------- podcast mode: read-aloud full screen, minimized to the small player ---------- */
  const [podcast, setPodcast] = useState(false)
  const expandPodcast = () => {
    toast.dismiss() // toasts float above everything, controls included
    setPodcast(true)
  }
  const openPodcast = () => {
    if (speech.post === null) speech.play(cur)
    expandPodcast()
  }
  /** Stops, and slides back down to the feed at the post that was being read. */
  const stopPodcast = () => {
    const at = speech.post
    speech.stop()
    if (at === null) return
    if (tab === 'feed') scrollToPost(at, false)
    else jumpTo(at)
  }
  // reading ran off the end of the book, or stopped some other way
  if (podcast && speech.post === null && !speech.playing) setPodcast(false)

  /* ---------- auto-scroll: lasts while the book is open; waits while reading aloud, selecting or writing ---------- */
  const [autoScroll, setAutoScroll] = useState<AutoScroll>('off')
  const bottom = atEnd && rendered >= posts.length
  const autoDone = autoScroll === 'flow' ? bottom : bottom || cur >= posts.length - 1
  const autoDoneRef = useRef(autoDone)
  useLayoutEffect(() => {
    autoDoneRef.current = autoDone
  })
  useAutoScroll(autoScroll, tab === 'feed' && speech.post === null && !sel && !draft && !word, {
    step: () => scrollToPost(live.current.cur + 1, true),
    ended: () => autoDoneRef.current,
    onEnd: () => {
      setAutoScroll('off')
      toast('Auto-scroll stopped', { description: 'You reached the end of the book.' })
    },
  })

  /* ---------- continue on another device ---------- */
  const [syncing, setSyncing] = useState<SyncPayload | null>(null)
  const openSync = () => {
    persist()
    const { posts, cur, likes, marks, notes, meta, segs } = live.current
    const p = posts[cur]
    if (!p) return
    const custom = !inBookOrder(notes, segs)
    setSyncing({
      id: meta.id,
      title: meta.title,
      pct: p.pct,
      state: { id: meta.id, seg: p.s, likes: [...likes], marks: [...marks], notes, ...(custom ? { notesCustom: true } : {}) },
    })
  }

  /* ---------- render ---------- */
  const autoBar = autoScroll !== 'off' && tab === 'feed' && speech.post === null && !sel
  const playerBar = speech.post !== null && !sel && !podcast
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
          <button
            aria-label="Search this book"
            title="Search this book (/)"
            onClick={() => switchTab(tab === 'search' ? 'feed' : 'search')}
            className="grid size-[38px] shrink-0 place-items-center rounded-full hover:bg-accent aria-pressed:text-primary"
            aria-pressed={tab === 'search'}
          >
            <Search className="size-5" />
          </button>
          {speechSupported && (
            <button
              aria-label="Read aloud in podcast mode"
              title="Read aloud"
              onClick={openPodcast}
              className="grid size-[38px] shrink-0 place-items-center rounded-full hover:bg-accent aria-pressed:text-primary"
              aria-pressed={speech.post !== null}
            >
              <Headphones className="size-5" />
            </button>
          )}
          <SettingsPopover reader autoScroll={autoScroll} onAutoScroll={setAutoScroll} onSync={openSync} />
        </div>
        {tab === 'search' ? (
          <SearchBox query={query} onQuery={setQuery} onClose={() => switchTab('feed')} />
        ) : (
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
                  {t === 'notes' && notes.length > 0 && (
                    <span className="ml-1 text-[13px] text-muted-foreground tabular-nums">{notes.length}</span>
                  )}
                  {tab === t && <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-primary" />}
                </span>
              </button>
            ))}
          </div>
        )}
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
                notes={notesByPost.get(p.i)}
                speaking={speech.post === p.i}
                flash={flash === p.i}
                selA={marked?.post === p.i ? marked.a : undefined}
                selB={marked?.post === p.i ? marked.b : undefined}
                onAction={onAction}
                onNote={editNote}
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
          <ChapterList chapters={chapters} posts={posts} current={current?.ch ?? 0} onOpen={i => jumpTo(i)} />
        )}

        {tab === 'saved' && <SavedList posts={posts} author={author} likes={likes} marks={marks} onAction={onAction} />}

        {tab === 'notes' && (
          <NotesList
            notes={notes}
            custom={notesCustom}
            posts={posts}
            author={author}
            onOpen={n => jumpTo(postIndexOfSeg(posts, n.seg), true)}
            onEdit={editNote}
            onMove={moveNote}
            onSort={sortNotes}
          />
        )}

        {tab === 'search' && (
          <SearchResults
            segs={segs}
            query={deferredQuery}
            chapters={chapters}
            onOpen={seg => jumpTo(postIndexOfSeg(posts, seg), true)}
          />
        )}
      </main>

      {sel && !sel.dragging && !draft && (
        <SelectionBar
          quote={sel.quote}
          count={sel.count}
          onSave={saveQuote}
          onNote={() => {
            setDraft({ post: posts[sel.post], quote: sel.quote })
            clearSel()
          }}
          onCopy={async () => {
            const ok = await copyText(`“${sel.quote}”\n\n— ${meta.author}, ${meta.title}`)
            toast(ok ? 'Copied to clipboard' : 'Copying is not available here')
            clearSel()
          }}
          onClose={clearSel}
        />
      )}

      {autoBar && (
        <AutoScrollBar mode={autoScroll} onMode={setAutoScroll} />
      )}

      {playerBar && (
        <Player
          playing={speech.playing}
          rate={speech.rate}
          label={chapterTitle}
          onToggle={toggleSpeech}
          onStop={speech.stop}
          onRate={speech.setRate}
          onExpand={expandPodcast}
        />
      )}

      <SyncDialog payload={syncing} onClose={() => setSyncing(null)} />

      <Podcast
        open={podcast}
        playing={speech.playing}
        post={speech.post}
        chunk={speech.chunk}
        posts={posts}
        rate={speech.rate}
        meta={meta}
        chapter={chapterTitle}
        onToggle={toggleSpeech}
        onSkip={speech.skip}
        onRate={speech.setRate}
        onMinimize={() => setPodcast(false)}
        onStop={stopPodcast}
      />

      <WordTip word={word} speak={speechSupported && speech.post === null} onClose={clearWord} onQuote={quoteWord} />

      <NoteComposer
        draft={draft}
        author={author}
        onClose={() => setDraft(null)}
        onSave={saveDraft}
        onDelete={deleteDraft}
      />

      {/* the player bars sit where the scanner button goes */}
      <Fab scan={!autoBar && !playerBar} />
    </div>
  )
}

/**
 * What to do with a selected passage, docked at the bottom where a thumb reaches it. Big targets; the mouse-down is
 * swallowed so clicking a button doesn't collapse a mouse selection before the click lands.
 */
function SelectionBar({
  quote,
  count,
  onSave,
  onNote,
  onCopy,
  onClose,
}: {
  quote: string
  count: number
  onSave: () => void
  onNote: () => void
  onCopy: () => void
  onClose: () => void
}) {
  const btn =
    'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[13px] font-bold active:scale-[0.97] transition-transform'
  return (
    <div
      data-selbar
      role="toolbar"
      aria-label="Selected passage"
      onMouseDown={e => e.preventDefault()}
      className="fixed inset-x-0 bottom-0 mx-auto max-w-[600px] px-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] select-none"
      // above sonner's toasts (z-index 999999999), so one that is still fading out can't swallow a tap meant for the bar
      style={{ zIndex: 1_000_000_000 }}
    >
      <div className="rounded-2xl border bg-background p-3 shadow-pop animate-in fade-in-0 slide-in-from-bottom-4">
        <div className="mb-2.5 flex items-start gap-2">
          <p className="line-clamp-2 min-w-0 flex-1 font-read text-[14px] leading-snug text-muted-foreground">
            “{quote}”
          </p>
          <button
            onClick={onClose}
            aria-label="Cancel selection"
            className="-mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-full hover:bg-accent"
          >
            <X className="size-5" />
          </button>
        </div>
        {count > 0 && (
          <p className="touch-only mb-2.5 text-[12px] text-muted-foreground">
            {count} {count === 1 ? 'sentence' : 'sentences'} · drag while holding, or tap another sentence to extend
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          <button onClick={onSave} className={cn(btn, 'bg-primary text-white hover:bg-[#1a8cd8]')}>
            <Highlighter className="size-5" />
            Save quote
          </button>
          <button onClick={onNote} className={cn(btn, 'bg-secondary hover:bg-accent')}>
            <MessageSquarePlus className="size-5" />
            Add note
          </button>
          <button onClick={onCopy} className={cn(btn, 'bg-secondary hover:bg-accent')}>
            <Copy className="size-5" />
            Copy
          </button>
        </div>
      </div>
    </div>
  )
}

function Player({
  playing,
  rate,
  label,
  onToggle,
  onStop,
  onRate,
  onExpand,
}: {
  playing: boolean
  rate: number
  label: string
  onToggle: () => void
  onStop: () => void
  onRate: (r: number) => void
  /** Opens podcast mode. */
  onExpand: () => void
}) {
  const next = RATES[(RATES.indexOf(rate as (typeof RATES)[number]) + 1) % RATES.length]
  return (
    <div
      role="region"
      aria-label="Read aloud"
      className="fixed z-25 flex h-14 items-center gap-1 rounded-full border bg-background pr-2 pl-1.5 shadow-pop"
      style={{
        bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
        left: 'calc(max(16px, (100vw - 600px) / 2 + 16px) + env(safe-area-inset-left, 0px))',
        maxWidth: 'calc(min(100vw, 600px) - 32px - 56px - 12px)',
      }}
    >
      <button
        onClick={onToggle}
        aria-label={playing ? 'Pause' : 'Resume'}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-white hover:bg-[#1a8cd8]"
      >
        {playing ? <Pause className="size-5 fill-current" /> : <Play className="size-5 fill-current" />}
      </button>
      <button
        onClick={onExpand}
        aria-label="Open podcast mode"
        className="flex min-w-0 flex-1 items-center gap-1 self-stretch rounded-full px-2 text-left text-[13px] hover:bg-accent"
      >
        <span className="min-w-0 flex-1 truncate">
          <b className="block font-bold">{playing ? 'Reading aloud' : 'Paused'}</b>
          <span className="text-muted-foreground">{label}</span>
        </span>
        <ChevronUp className="size-5 shrink-0 text-muted-foreground" />
      </button>
      <button
        onClick={() => onRate(next)}
        aria-label={`Speed ${rate}×, change to ${next}×`}
        className="h-9 shrink-0 rounded-full px-2 text-[13px] font-bold tabular-nums hover:bg-accent"
      >
        {rate}×
      </button>
      <button
        onClick={onStop}
        aria-label="Stop reading aloud"
        className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-accent"
      >
        <Square className="size-4 fill-current" />
      </button>
    </div>
  )
}

const SPEEDS: Exclude<AutoScroll, 'off'>[] = ['1', '3', '6', 'flow']

/** Shown while auto-scroll is on, in the read-aloud player's place: change its speed or stop it. */
function AutoScrollBar({ mode, onMode }: { mode: Exclude<AutoScroll, 'off'>; onMode: (m: AutoScroll) => void }) {
  const next = SPEEDS[(SPEEDS.indexOf(mode) + 1) % SPEEDS.length]
  const name = (m: AutoScroll) => (m === 'flow' ? 'Flow' : `${m}s`)
  return (
    <div
      role="region"
      aria-label="Auto-scroll"
      className="fixed z-25 flex h-14 items-center gap-1 rounded-full border bg-background pr-2 pl-4 shadow-pop"
      style={{
        bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
        left: 'calc(max(16px, (100vw - 600px) / 2 + 16px) + env(safe-area-inset-left, 0px))',
        maxWidth: 'calc(min(100vw, 600px) - 32px - 56px - 12px)',
      }}
    >
      <span className="min-w-0 flex-1 truncate pr-1 text-[13px]">
        <b className="block font-bold">Auto-scrolling</b>
        <span className="text-muted-foreground">
          {mode === 'flow' ? 'Steady glide' : `Next post every ${mode}s`}
        </span>
      </span>
      <button
        onClick={() => onMode(next)}
        aria-label={`Speed ${name(mode)}, change to ${name(next)}`}
        className="h-9 shrink-0 rounded-full px-2 text-[13px] font-bold tabular-nums hover:bg-accent"
      >
        {name(mode)}
      </button>
      <button
        onClick={() => onMode('off')}
        aria-label="Stop auto-scroll"
        className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-accent"
      >
        <Square className="size-4 fill-current" />
      </button>
    </div>
  )
}

function SearchBox({ query, onQuery, onClose }: { query: string; onQuery: (q: string) => void; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 pb-3 px-safe">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-2.5 left-3.5 size-4 text-muted-foreground" />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder="Search this book"
          aria-label="Search this book"
          enterKeyHint="search"
          className="h-9 w-full rounded-full border border-transparent bg-secondary pr-4 pl-10 outline-none focus:border-primary focus:bg-background"
        />
      </div>
      <button
        onClick={onClose}
        aria-label="Close search"
        className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-accent"
      >
        <X className="size-5" />
      </button>
    </div>
  )
}

function SearchResults({
  segs,
  query,
  chapters,
  onOpen,
}: {
  segs: Segment[]
  query: string
  chapters: Chapter[]
  onOpen: (seg: number) => void
}) {
  const { hits, total, length } = useMemo(() => searchBook(segs, query), [segs, query])
  if (length < 2)
    return (
      <div className="mx-auto max-w-[420px] px-8 py-12">
        <h3 className="mb-2 text-[31px] leading-[1.1] font-extrabold tracking-tight">Search this book</h3>
        <p className="text-muted-foreground">Find a word, a name or a line you remember. Tap a result to read from there.</p>
      </div>
    )
  if (!hits.length)
    return (
      <div className="mx-auto max-w-[420px] px-8 py-12">
        <h3 className="mb-2 text-[31px] leading-[1.1] font-extrabold tracking-tight break-words">
          No results for “{query.trim()}”
        </h3>
        <p className="text-muted-foreground">Try a different spelling or a shorter phrase.</p>
      </div>
    )
  return (
    <section className="pb-24">
      <p className="border-b py-3 text-[13px] text-muted-foreground px-safe">
        {total} {total === 1 ? 'result' : 'results'}
        {total > hits.length && `, showing the first ${hits.length}`}
      </p>
      {hits.map(h => {
        const from = Math.max(0, h.at - 80)
        const to = Math.min(h.text.length, h.at + length + 140)
        return (
          <button
            key={`${h.seg}-${h.at}`}
            onClick={() => onOpen(h.seg)}
            className="grid w-full gap-0.5 border-b py-3 text-left px-safe hover:bg-hover"
          >
            <span className="truncate text-[13px] text-muted-foreground">{chapters[h.ch]?.title}</span>
            <span className="font-read text-[15px] leading-normal">
              {from > 0 && '…'}
              {h.text.slice(from, h.at)}
              <mark className="rounded-[3px] bg-primary/20 px-0.5 font-bold text-inherit">
                {h.text.slice(h.at, h.at + length)}
              </mark>
              {h.text.slice(h.at + length, to)}
              {to < h.text.length && '…'}
            </span>
          </button>
        )
      })}
    </section>
  )
}

/**
 * Notes in book order, or in the reader's own order once they drag one by its handle. The handle is the only part that
 * grabs, so the rest of each note still scrolls the list and opens as before.
 */
function NotesList({
  notes,
  custom,
  posts,
  author,
  onOpen,
  onEdit,
  onMove,
  onSort,
}: {
  notes: Note[]
  /** Not in book order. */
  custom: boolean
  posts: Post[]
  author: Author
  onOpen: (n: Note) => void
  onEdit: (n: Note) => void
  onMove: (from: number, to: number) => void
  onSort: () => void
}) {
  const { listRef, handle, style, dragging } = useReorder<HTMLDivElement>(onMove)
  if (!notes.length)
    return (
      <div className="mx-auto max-w-[420px] px-8 py-12">
        <h3 className="mb-2 text-[31px] leading-[1.1] font-extrabold tracking-tight">Your notes live here</h3>
        <p className="text-muted-foreground">
          <span className="touch-only">Hold a sentence in any post and drag to select more, then save it as a quote. </span>
          <span className="touch-hide">Select words in any post to save them as a quote. </span>
          Tap reply on a post to write a note about it.
        </p>
      </div>
    )
  return (
    <section className="pb-24">
      <div className="flex min-h-11 items-center gap-2 border-b py-1 px-safe text-[13px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'} · {custom ? 'your order' : 'in book order'}
        </span>
        {custom && (
          <button
            onClick={onSort}
            className="-mr-2 inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 font-bold text-primary hover:bg-primary/10"
          >
            <ArrowDownUp className="size-4" />
            Sort by book order
          </button>
        )}
      </div>
      <div ref={listRef}>
      {notes.map((n, i) => {
        const post = posts[postIndexOfSeg(posts, n.seg)]
        const text = post ? plainText(post) : ''
        return (
          <PostShell
            key={n.id}
            author={{ title: 'You', handle: '@you' }}
            avatar={<YouAvatar />}
            time={ago(n.at)}
            style={style(i)}
            className={cn(dragging === i && 'bg-background shadow-pop hover:bg-background')}
            aside={
              notes.length > 1 && (
                <button
                  {...handle(i, notes.length)}
                  aria-label="Move note. Drag, or use the arrow keys."
                  title="Drag to reorder"
                  className="grid size-10 cursor-grab place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
                >
                  <GripVertical className="size-5" />
                </button>
              )
            }
          >
            {n.text ? (
              <button onClick={() => onEdit(n)} className="block w-full text-left" aria-label="Edit note">
                <p className="mt-0.5 text-[15px] whitespace-pre-wrap break-words">{n.text}</p>
              </button>
            ) : (
              <p className="mt-0.5 text-[15px] text-muted-foreground">Saved a quote</p>
            )}
            <button
              onClick={() => onOpen(n)}
              className="mt-3 mb-2 block w-full rounded-2xl border p-3 text-left hover:bg-hover"
              aria-label="Read this passage in the book"
            >
              <span className="mb-1 flex min-w-0 items-center gap-1.5">
                <BookAvatar title={author.title} avatar={author.avatar} className="size-5 text-[10px]" />
                <b className="truncate text-[15px] font-bold">{author.title}</b>
                <span className="shrink-0 text-muted-foreground">· {post ? `${post.pct}%` : ''}</span>
              </span>
              <span className="line-clamp-4 font-read text-[15px] leading-normal">
                {n.quote ? <QuoteMark text={n.quote} /> : text}
              </span>
            </button>
            <div className="mb-2 -ml-2 flex">
              <button
                onClick={() => onEdit(n)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-[13px] font-bold text-muted-foreground hover:bg-primary/10 hover:text-primary"
              >
                {n.text ? <Pencil className="size-4" /> : <MessageSquarePlus className="size-4" />}
                {n.text ? 'Edit note' : 'Add a note'}
              </button>
            </div>
          </PostShell>
        )
      })}
      </div>
    </section>
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
          and your books, place, likes and bookmarks are kept on this device.
          <span className="touch-only"> Hold a sentence and drag to quote it.</span>
          <span className="touch-hide"> Select words to quote them, and press j and k to move between posts.</span>
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
