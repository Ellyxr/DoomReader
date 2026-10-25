import type { Post } from '@/lib/feed'
import { textOf } from '@/lib/parse/html'

/**
 * Highlights and sentence selection work on a post's text as the reader sees it: the concatenation of the post body's
 * text nodes. Offsets into that string are the same whether they're read from the body HTML or from the rendered DOM,
 * so a selection made with a finger can be drawn back into the HTML as <mark>s.
 */
export interface PostText {
  text: string
  /** [start, end) of each paragraph, heading or quote line, so sentences never run across blocks. */
  blocks: [number, number][]
}

export interface Range {
  a: number
  b: number
}

const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }
// a tag, an entity, or one character
const TOKEN = /<[^>]*>|&(?:amp|lt|gt|quot|#39);|[\s\S]/g
const OPEN_BLOCK = /^<(p|h2|h3)[\s>]/
const CLOSE_BLOCK = /^<\/(p|h2|h3)>/

/** The text and block boundaries of post body HTML (as produced by `bodyHtml`). */
export function postText(html: string): PostText {
  let text = ''
  const blocks: [number, number][] = []
  let start = -1
  for (const [t] of html.matchAll(TOKEN)) {
    if (t.length > 1 && t[0] === '<') {
      if (OPEN_BLOCK.test(t)) start = text.length
      else if (CLOSE_BLOCK.test(t) && start > -1) {
        blocks.push([start, text.length])
        start = -1
      }
    } else text += ENTITY[t] ?? t
  }
  return { text, blocks }
}

/** The same, read from rendered DOM (the `.post-text` element). */
export function domText(el: Element): PostText {
  const r = document.createRange()
  const at = (node: Node) => {
    r.setStart(el, 0)
    r.setEnd(node, 0)
    return r.toString().length
  }
  const blocks = Array.from(el.querySelectorAll('p, h2, h3'), (b): [number, number] => {
    const s = at(b)
    return [s, s + (b.textContent ?? '').length]
  })
  return { text: el.textContent ?? '', blocks }
}

export interface Mark extends Range {
  cls: 'hl' | 'sel'
  /** Index of the note, for tapping a highlight. A number, so nothing user-written ends up in an attribute. */
  n?: number
}

/**
 * Wraps the given character ranges of body HTML in <mark>s. Marks are closed and reopened around every tag, so the
 * result nests correctly however the ranges cross paragraphs and <em>/<strong>; overlapping ranges share one mark.
 */
export function markHtml(html: string, marks: Mark[]) {
  if (!marks.length) return html
  let out = ''
  let i = 0
  let open: string | null = null
  const tagFor = (i: number) => {
    const on = marks.filter(m => i >= m.a && i < m.b)
    if (!on.length) return null
    const cls = [...new Set(on.map(m => m.cls))].sort().join(' ')
    const n = on.find(m => m.n !== undefined)?.n
    return `<mark class="${cls}"${n === undefined ? '' : ` data-n="${n}"`}>`
  }
  for (const [t] of html.matchAll(TOKEN)) {
    if (t.length > 1 && t[0] === '<') {
      if (open) out += '</mark>'
      open = null
      out += t
      continue
    }
    const tag = tagFor(i)
    if (tag !== open) {
      if (open) out += '</mark>'
      if (tag) out += tag
      open = tag
    }
    out += t
    i++
  }
  return open ? out + '</mark>' : out
}

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'sentence' }) : null

/** Sentences of the post, without their trailing spaces, in reading order. */
export function sentences({ text, blocks }: PostText): Range[] {
  const out: Range[] = []
  for (const [s, e] of blocks.length ? blocks : [[0, text.length] as [number, number]]) {
    const part = text.slice(s, e)
    const pieces = segmenter
      ? Array.from(segmenter.segment(part), x => [x.index, x.segment] as const)
      : Array.from(part.matchAll(/[^.!?…]+(?:[.!?…]+["”’')\]]*)?\s*/g), m => [m.index, m[0]] as const)
    for (const [at, seg] of pieces) {
      const lead = seg.length - seg.trimStart().length
      const body = seg.trim()
      if (body) out.push({ a: s + at + lead, b: s + at + lead + body.length })
    }
  }
  return out
}

/** The selected words, one line per block, as stored in a quote. */
export function quoteOf({ text, blocks }: PostText, { a, b }: Range) {
  const parts = blocks.length
    ? blocks.filter(([s, e]) => e > a && s < b).map(([s, e]) => text.slice(Math.max(a, s), Math.min(b, e)).trim())
    : [text.slice(a, b).trim()]
  return parts.filter(Boolean).join('\n')
}

/** Where a saved quote sits in the post's text, ignoring differences in spacing and line breaks. */
export function findQuote(text: string, quote: string): Range | null {
  const at: number[] = []
  let compact = ''
  for (let i = 0; i < text.length; i++)
    if (!/\s/.test(text[i])) {
      at.push(i)
      compact += text[i]
    }
  const q = quote.replace(/\s+/g, '')
  if (!q) return null
  const k = compact.indexOf(q)
  return k < 0 ? null : { a: at[k], b: at[k + q.length - 1] + 1 }
}

/** The segment a quote starts in, so the note stays with that passage when posts are regrouped. */
export function segOfQuote(post: Post, quote: string) {
  // short, so a quote that starts near the end of a segment still matches inside it
  const head = quote.replace(/\s+/g, '').slice(0, 12)
  const k = post.segs.findIndex(s => textOf(s.html).replace(/\s+/g, '').includes(head))
  return post.s + Math.max(0, k)
}
