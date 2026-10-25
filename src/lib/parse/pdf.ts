import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import type { Block, Chapter, ParsedBook } from '@/lib/types'
import { esc, yieldToBrowser } from './html'
import { thumbnails } from './images'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Progress = (done: number, total: number) => void

/** A visual line of text on one page, in PDF units (y grows upwards). */
interface Line {
  text: string
  x: number
  y: number
  right: number
  size: number
  page: number
}

/** A block plus the page it starts on, so chapters can be cut at page boundaries. */
interface PageBlock extends Block {
  page: number
  size: number
}

const clean = (s: string) =>
  s
    .replace(/­/g, '')
    .replace(/[ﬀ-ﬆ]/g, c => c.normalize('NFKC'))
    .replace(/\s+/g, ' ')

async function pageLines(page: PDFPageProxy, pageNo: number): Promise<Line[]> {
  const tc = await page.getTextContent()
  const lines: Line[] = []
  let cur: Line | null = null
  let eol = false
  for (const item of tc.items) {
    if (!('str' in item)) continue
    const [, , c, d, x, y] = item.transform as number[]
    const size = Math.hypot(c, d) || item.height || 10
    const str = clean(item.str)
    if (!str.trim()) {
      if (item.hasEOL) eol = true
      continue
    }
    if (!cur || eol || Math.abs(y - cur.y) > size * 0.5) {
      cur = { text: str.trimStart(), x, y, right: x + item.width, size, page: pageNo }
      lines.push(cur)
    } else {
      const gap = x - cur.right
      const needsSpace = gap > size * 0.15 && !cur.text.endsWith(' ') && !str.startsWith(' ')
      cur.text += (needsSpace ? ' ' : '') + str
      cur.right = Math.max(cur.right, x + item.width)
      cur.size = Math.max(cur.size, size)
    }
    eol = item.hasEOL
  }
  for (const l of lines) l.text = l.text.trim()
  return lines.filter(l => l.text)
}

const PAGE_NO = /^(page\s*)?([\divxlc]+)(\s*(of|\/)\s*\d+)?$/i
const runKey = (s: string) => s.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()

/** Drops running headers, footers and page numbers: lines at the top or bottom that repeat across pages. */
function stripRunning(pages: Line[][]) {
  const edge = (ls: Line[]) => [...ls.slice(0, 2), ...ls.slice(-2)]
  const counts = new Map<string, number>()
  for (const ls of pages) {
    for (const k of new Set(edge(ls).map(l => runKey(l.text)))) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const min = Math.max(3, pages.length * 0.3)
  return pages.map(ls => {
    const drop = new Set(
      edge(ls).filter(l => PAGE_NO.test(l.text) || (pages.length >= 4 && (counts.get(runKey(l.text)) ?? 0) >= min)),
    )
    return ls.filter(l => !drop.has(l))
  })
}

/** Most common value, weighted, after rounding to half units. */
function mode(values: [number, number][]) {
  const m = new Map<number, number>()
  for (const [v, w] of values) {
    const k = Math.round(v * 2) / 2
    m.set(k, (m.get(k) ?? 0) + w)
  }
  let best = 0
  let bestW = -1
  for (const [k, w] of m) if (w > bestW) [best, bestW] = [k, w]
  return best
}

const ENDS_SENTENCE = /[.!?:;…"”’)\]]$/

function buildBlocks(pages: Line[][]): { blocks: PageBlock[]; body: number } {
  const all = pages.flat()
  const body = mode(all.map(l => [l.size, l.text.length])) || 10
  const gaps: [number, number][] = []
  for (const ls of pages)
    for (let i = 1; i < ls.length; i++) {
      const g = ls[i - 1].y - ls[i].y
      if (g > 0 && g < body * 3 && Math.abs(ls[i].size - body) < 0.5) gaps.push([g, 1])
    }
  const lineGap = mode(gaps) || body * 1.2

  const blocks: PageBlock[] = []
  let cur: PageBlock | null = null
  let prev: Line | null = null
  for (const ls of pages) {
    if (!ls.length) continue
    const bodyLines = ls.filter(l => Math.abs(l.size - body) < 0.5)
    const left = Math.min(...(bodyLines.length ? bodyLines : ls).map(l => l.x))
    const right = Math.max(...(bodyLines.length ? bodyLines : ls).map(l => l.right))

    for (const l of ls) {
      const heading = l.size >= body * 1.2 && l.text.length < 150
      const k: Block['k'] = heading ? 'h' : 'p'
      let start = !cur || !prev || cur.k !== k || Math.abs(l.size - prev.size) > body * 0.15
      if (!start && prev) {
        const samePage = prev.page === l.page
        const gap = prev.y - l.y
        const prevShort = ENDS_SENTENCE.test(prev.text) && prev.right < right - body * 3
        const indented = l.x > left + body * 1.2 && l.x < left + body * 6
        if (heading) start = samePage && gap > l.size * 1.8
        else if (samePage && gap > 0) start = gap > lineGap * 1.45 || prevShort || (indented && ENDS_SENTENCE.test(prev.text))
        else start = prevShort || (indented && ENDS_SENTENCE.test(prev.text))
      }
      if (start || !cur) {
        cur = { k, html: l.text, page: l.page, size: l.size }
        blocks.push(cur)
      } else if (/[a-z]-$/.test(cur.html) && /^[a-z]/.test(l.text)) {
        cur.html = cur.html.slice(0, -1) + l.text
      } else {
        cur.html += ' ' + l.text
      }
      prev = l
    }
  }
  for (const b of blocks) b.html = esc(b.html)
  return { blocks, body }
}

async function outlineStarts(doc: PDFDocumentProxy) {
  let outline = (await doc.getOutline()) ?? []
  if (outline.length === 1 && outline[0].items.length >= 2) outline = outline[0].items
  const starts: { title: string; page: number }[] = []
  for (const o of outline) {
    try {
      const dest = typeof o.dest === 'string' ? await doc.getDestination(o.dest) : o.dest
      if (!dest?.length) continue
      const page = typeof dest[0] === 'number' ? dest[0] : await doc.getPageIndex(dest[0])
      const title = clean(o.title).trim()
      if (title && !starts.some(s => s.page === page)) starts.push({ title, page: page + 1 })
    } catch {
      /* skip unresolvable entries */
    }
  }
  return starts.sort((a, b) => a.page - b.page)
}

const norm = (s: string) => s.toLowerCase().replace(/&amp;/g, '&').replace(/[^\p{L}\p{N}]+/gu, '')
const strip = ({ k, html }: PageBlock): Block => ({ k, html })

function chaptersFromOutline(blocks: PageBlock[], starts: { title: string; page: number }[]): Chapter[] {
  // cut where the outline title appears as a heading on its page, else at the page's first block
  const cuts = starts.map(s => {
    const onPage = blocks.findIndex(b => b.page >= s.page)
    if (onPage < 0) return blocks.length
    const t = norm(s.title)
    const h = blocks.findIndex(
      (b, i) => i >= onPage && b.page === s.page && b.k === 'h' && t && (norm(b.html).includes(t) || t.includes(norm(b.html))),
    )
    return h >= 0 ? h : onPage
  })
  const chapters: Chapter[] = []
  if (cuts[0] > 0) chapters.push({ title: 'Front matter', blocks: blocks.slice(0, cuts[0]).map(strip) })
  starts.forEach((s, i) => {
    const part = blocks.slice(cuts[i], i + 1 < cuts.length ? cuts[i + 1] : blocks.length)
    if (part[0]?.k === 'h' && norm(part[0].html) && norm(s.title).includes(norm(part[0].html))) part.shift()
    chapters.push({ title: s.title, blocks: part.map(strip) })
  })
  return chapters
}

function chaptersFromHeadings(blocks: PageBlock[], body: number, pageCount: number): Chapter[] | null {
  const isTop = (b: PageBlock) => b.k === 'h' && b.size >= body * 1.4
  const count = blocks.filter(isTop).length
  if (count < 2 || count > pageCount * 1.5) return null
  const chapters: Chapter[] = []
  let cur: Chapter | null = null
  for (const b of blocks) {
    if (isTop(b)) {
      if (cur && !cur.blocks.length) cur.title += ': ' + b.html.replace(/&amp;/g, '&')
      else chapters.push((cur = { title: b.html.replace(/&amp;/g, '&'), blocks: [] }))
      continue
    }
    if (!cur) chapters.push((cur = { title: 'Front matter', blocks: [] }))
    cur.blocks.push(strip(b))
  }
  return chapters
}

function chaptersByPages(blocks: PageBlock[], pageCount: number, per = 10): Chapter[] {
  const chapters: Chapter[] = []
  for (let p = 1; p <= pageCount; p += per) {
    const last = Math.min(pageCount, p + per - 1)
    const part = blocks.filter(b => b.page >= p && b.page <= last)
    chapters.push({ title: p === last ? `Page ${p}` : `Pages ${p}–${last}`, blocks: part.map(strip) })
  }
  return chapters
}

function metaTitle(info: Record<string, unknown>, fileName: string) {
  let t = typeof info.Title === 'string' ? info.Title.trim() : ''
  t = t.replace(/^Microsoft (Word|PowerPoint) - /i, '').replace(/\.(docx?|pptx?)$/i, '')
  if (!t || /^untitled/i.test(t)) t = fileName.replace(/\.pdf$/i, '')
  return t
}

async function renderCover(doc: PDFDocumentProxy) {
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 480 / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    return thumbnails(canvas)
  } catch {
    return { cover: null, avatar: null }
  }
}

export async function parsePdf(file: File, onProgress?: Progress): Promise<ParsedBook> {
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  let doc: PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (e) {
    if (e instanceof Error && e.name === 'PasswordException')
      throw new Error('This PDF is password-protected and cannot be opened.')
    throw new Error('That file is not a readable PDF.')
  }
  try {
    const pageCount = doc.numPages
    const raw: Line[][] = []
    for (let p = 1; p <= pageCount; p++) {
      const page = await doc.getPage(p)
      raw.push(await pageLines(page, p))
      page.cleanup()
      onProgress?.(p, pageCount)
      if (p % 4 === 0) await yieldToBrowser()
    }
    const chars = raw.flat().reduce((n, l) => n + l.text.length, 0)
    if (chars < 100)
      throw new Error('This PDF has no selectable text (it is probably a scan), so it cannot be turned into posts.')

    const { blocks, body } = buildBlocks(stripRunning(raw))
    const starts = await outlineStarts(doc)
    let chapters =
      starts.length >= 2
        ? chaptersFromOutline(blocks, starts)
        : (chaptersFromHeadings(blocks, body, pageCount) ?? chaptersByPages(blocks, pageCount))
    chapters = chapters.filter(c => c.blocks.length)
    if (!chapters.length) throw new Error('No readable text found in this PDF.')

    const { info } = await doc.getMetadata()
    const meta = info as Record<string, unknown>
    const author = typeof meta.Author === 'string' && meta.Author.trim() ? meta.Author.trim() : 'Unknown author'
    const { cover, avatar } = await renderCover(doc)
    return { title: metaTitle(meta, file.name), author, cover, avatar, chapters }
  } finally {
    void task.destroy()
  }
}
