import type { Chapter } from '@/lib/types'
import { esc, textOf } from '@/lib/parse/html'

export const CHARS_PER_MIN = 1320 // about 240 words a minute at 5.5 characters a word

export type PostLength = 's' | 'm' | 'l'

/** The smallest unit of the feed: a chapter title, heading, paragraph, a slice of a long paragraph, or a picture. */
export interface Segment {
  ch: number
  k: 't' | 'h' | 'p' | 'q' | 'i'
  html: string
  len: number
  para: number
  img?: string
  w?: number
  h?: number
}

/** Pictures per post, as on X. */
const MEDIA_PER_POST = 4

export interface Post {
  i: number
  ch: number
  /** Index of the first segment. */
  s: number
  segs: Segment[]
  len: number
  /** Characters before this post, for the timestamp and progress. */
  before: number
  prev: boolean
  next: boolean
  pct: number
}

const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'prof', 'mt', 'vs', 'etc', 'col', 'capt', 'gen', 'lt', 'sgt', 'rev', 'hon', 'no', 'messrs', 'mme', 'mlle', 'gov', 'sen', 'rep'])

/** Re-opens and closes <em>/<strong> so each piece of a split paragraph is valid on its own. */
function balance(pieces: string[]) {
  const open: string[] = []
  return pieces.map(p => {
    const pre = open.map(t => `<${t}>`).join('')
    const re = /<(\/?)(em|strong)>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(p))) {
      if (m[1]) {
        const i = open.lastIndexOf(m[2])
        if (i > -1) open.splice(i, 1)
      } else open.push(m[2])
    }
    return pre + p + open.slice().reverse().map(t => `</${t}>`).join('')
  })
}

/** Paragraph HTML cut into sentences, keeping "Mr." and initials with the words after them. */
function cutSentences(html: string) {
  const re = /([.!?…]+)(["”’')\]]*)((?:<\/(?:em|strong)>)*)\s+/g
  const cuts: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const end = re.lastIndex
    const next = html.charAt(end)
    if (!/[A-Z“"‘'(<\d—]/.test(next) || html.substr(end, 2) === '</') continue
    if (m[1] === '.') {
      const before = textOf(html.slice(Math.max(0, m.index - 40), m.index))
      const w = (before.match(/([A-Za-z]+)$/) || [])[1]
      if (w && (ABBR.has(w.toLowerCase()) || (w.length === 1 && w === w.toUpperCase()))) continue
    }
    cuts.push(end)
  }
  const sentences: string[] = []
  let last = 0
  for (const c of cuts) {
    sentences.push(html.slice(last, c).trim())
    last = c
  }
  sentences.push(html.slice(last).trim())
  return sentences.filter(Boolean)
}

/** A long paragraph as slices of whole sentences, each up to about 300 characters. */
function splitSentences(html: string) {
  const out: string[] = []
  let cur = ''
  for (const s of cutSentences(html)) {
    if (cur && textOf(cur + ' ' + s).length > 300) {
      out.push(cur)
      cur = s
    } else cur = cur ? cur + ' ' + s : s
  }
  if (cur) out.push(cur)
  return balance(out)
}

export function buildSegments(chapters: Chapter[]): Segment[] {
  const segs: Segment[] = []
  let para = 0
  chapters.forEach((ch, ci) => {
    segs.push({ ch: ci, k: 't', html: esc(ch.title), len: 0, para: para++ })
    ch.blocks.forEach(b => {
      const pid = para++
      if (b.k === 'i') {
        segs.push({ ch: ci, k: 'i', html: b.html, len: 0, para: pid, img: b.img, w: b.w, h: b.h })
        return
      }
      const len = textOf(b.html).length
      if (b.k === 'h') {
        segs.push({ ch: ci, k: 'h', html: b.html, len, para: pid })
        return
      }
      const pieces = len > 420 ? splitSentences(b.html) : [b.html]
      pieces.forEach(h => segs.push({ ch: ci, k: b.k, html: h, len: textOf(h).length, para: pid }))
    })
  })
  return segs
}

export function buildPosts(segs: Segment[], length: PostLength): { posts: Post[]; total: number } {
  const target = { s: 280, m: 560, l: 1000 }[length]
  const posts: Post[] = []
  let cur: Post | null = null
  let acc = 0
  segs.forEach((s, i) => {
    const hasBody = cur && cur.segs.some(x => x.k !== 't')
    // pictures close a post, like media under a tweet; the text after them starts the next one
    const media = cur ? cur.segs.filter(x => x.k === 'i').length : 0
    const afterMedia = s.k === 'i' ? media >= MEDIA_PER_POST : media > 0
    if (
      !cur ||
      cur.ch !== s.ch ||
      (hasBody && s.k !== 't' && (s.k === 'h' || cur.len + s.len > target || afterMedia))
    ) {
      cur = { i: 0, ch: s.ch, s: i, segs: [], len: 0, before: acc, prev: false, next: false, pct: 0 }
      posts.push(cur)
    }
    cur.segs.push(s)
    cur.len += s.len
    acc += s.len
  })
  const total = Math.max(1, acc)
  posts.forEach((p, i) => {
    p.i = i
    p.prev = !!(posts[i - 1] && posts[i - 1].ch === p.ch)
    p.next = !!(posts[i + 1] && posts[i + 1].ch === p.ch)
    p.pct = Math.min(100, Math.floor((p.before / total) * 100))
  })
  return { posts, total }
}

export function postIndexOfSeg(posts: Post[], seg: number) {
  let r = 0
  for (const p of posts) {
    if (p.s > seg) break
    r = p.i
  }
  return r
}

/** A post counts as liked or bookmarked if any of its segments is, so marks survive a change of post length. */
export const isOn = (set: Set<number>, p: Post) => p.segs.some((_, k) => set.has(p.s + k))

export function toggled(set: Set<number>, p: Post) {
  const next = new Set(set)
  if (isOn(set, p)) p.segs.forEach((_, k) => next.delete(p.s + k))
  else next.add(p.s)
  return next
}

export function fmtTime(chars: number) {
  const m = chars / CHARS_PER_MIN
  if (m < 1) return 'now'
  if (m < 60) return Math.floor(m) + 'm'
  return Math.floor(m / 60) + 'h'
}

/** Body HTML for a post. Slices of one paragraph are joined back together and quote lines are grouped. */
export function bodyHtml(p: Post) {
  const blocks: { k: Segment['k']; html: string }[] = []
  const ss = p.segs
  let i = 0
  while (i < ss.length) {
    const s = ss[i]
    if (s.k === 'i') {
      i++
      continue
    }
    if (s.k === 't') {
      blocks.push({ k: 't', html: s.html })
      i++
      continue
    }
    let html = s.html
    let j = i + 1
    while (j < ss.length && ss[j].para === s.para) {
      html += ' ' + ss[j].html
      j++
    }
    blocks.push({ k: s.k, html })
    i = j
  }
  let out = ''
  for (let b = 0; b < blocks.length; b++) {
    const k = blocks[b]
    if (k.k === 't') out += `<h2 class="ch">${k.html}</h2>`
    else if (k.k === 'h') out += `<h3 class="sub">${k.html}</h3>`
    else if (k.k === 'q') {
      let inner = `<p>${k.html}</p>`
      while (blocks[b + 1] && blocks[b + 1].k === 'q') {
        b++
        inner += `<p>${blocks[b].html}</p>`
      }
      out += `<blockquote>${inner}</blockquote>`
    } else out += `<p>${k.html}</p>`
  }
  return out
}

export const plainText = (p: Post) =>
  p.segs
    .filter(s => s.k !== 't' && s.k !== 'i')
    .map(s => textOf(s.html))
    .join('\n\n')

export const postImages = (p: Post) => p.segs.filter(s => s.k === 'i')

const chunkCache = new WeakMap<Post, string[]>()

/**
 * What text-to-speech reads for a post, one utterance per sentence, so podcast mode can show each sentence as it is
 * spoken. Short utterances also keep clear of Chrome's habit of stalling on long ones.
 */
export function speechChunks(p: Post) {
  let chunks = chunkCache.get(p)
  if (!chunks) {
    chunks = p.segs
      .filter(s => s.k !== 'i')
      .flatMap(s => (s.k === 't' || s.k === 'h' ? [s.html] : cutSentences(s.html)))
      .map(h => textOf(h).trim())
      .filter(Boolean)
    chunkCache.set(p, chunks)
  }
  return chunks
}

export interface SearchHit {
  seg: number
  ch: number
  text: string
  at: number
}

/** Case- and accent-insensitive search over the book's text. Each hit is the segment and where the match starts. */
export function searchBook(segs: Segment[], query: string, limit = 200) {
  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const q = fold(query.trim())
  const hits: SearchHit[] = []
  let total = 0
  if (q.length < 2) return { hits, total, length: q.length }
  segs.forEach((s, seg) => {
    if (s.k === 'i' || s.k === 't') return
    const text = textOf(s.html)
    // folding can change length (e.g. "ﬁ"), so only fold when it doesn't, to keep match offsets right
    const folded = fold(text)
    const hay = folded.length === text.length ? folded : text.toLowerCase()
    let at = hay.indexOf(q)
    while (at > -1) {
      total++
      if (hits.length < limit) hits.push({ seg, ch: s.ch, text, at })
      at = hay.indexOf(q, at + q.length)
    }
  })
  return { hits, total, length: q.length }
}
