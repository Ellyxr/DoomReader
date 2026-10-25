import JSZip from 'jszip'

import type { Block, BookImage, Chapter, ParsedBook } from '@/lib/types'
import { esc, textOf, yieldToBrowser } from './html'
import { fitImage, thumbnailsFromBlob } from './images'

type Progress = (done: number, total: number) => void

const safeDec = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function resolve(base: string, href: string) {
  href = href.split('#')[0]
  if (!href) return base
  const out: string[] = []
  for (const p of (base ? base.split('/') : []).concat(href.split('/'))) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const els = (root: Document | Element, n: string) => Array.from(root.getElementsByTagNameNS('*', n))

const SKIP = new Set(['script', 'style', 'nav', 'svg', 'img', 'head', 'image', 'audio', 'video', 'iframe', 'object'])
const BLOCK = new Set(['p', 'li', 'dd', 'dt', 'pre', 'figcaption', 'caption'])
const NESTED = 'p,div,h1,h2,h3,h4,h5,h6,blockquote,ul,ol,li,table,section,article,pre'

/** Inline text with only <em>, <strong> and <br> kept; footnote markers dropped. */
function inline(n: Node): string {
  let s = ''
  for (const c of Array.from(n.childNodes)) {
    if (c.nodeType === Node.TEXT_NODE) {
      s += esc(c.nodeValue ?? '')
      continue
    }
    if (c.nodeType !== Node.ELEMENT_NODE) continue
    const el = c as Element
    const t = el.localName.toLowerCase()
    if (SKIP.has(t)) continue
    if (t === 'br') {
      s += '<br>'
      continue
    }
    if ((t === 'sup' || t === 'sub') && /^[[(]?[\d*†‡]+[\])]?$/.test((el.textContent ?? '').trim())) continue
    if (t === 'a' && /noteref/.test(el.getAttribute('epub:type') || '')) continue
    const inner = inline(el)
    if (t === 'em' || t === 'i' || t === 'cite' || t === 'dfn') s += inner.trim() ? `<em>${inner}</em>` : inner
    else if (t === 'strong' || t === 'b') s += inner.trim() ? `<strong>${inner}</strong>` : inner
    else s += inner
  }
  return s
}
const tidy = (h: string) =>
  h.replace(/\s+/g, ' ').replace(/ ?<br> ?/g, '<br>').replace(/^(<br>)+|(<br>)+$/g, '').trim()
const hasText = (h: string) => textOf(h).trim().length > 0

const XLINK = 'http://www.w3.org/1999/xlink'

/** Zip paths of the pictures in or under `el`. Remote and data: URLs are ignored; only files in the book are used. */
function imagesIn(el: Element, dir: string) {
  const t = el.localName.toLowerCase()
  const list = t === 'img' || t === 'image' ? [el] : [...els(el, 'img'), ...els(el, 'image')]
  return list.flatMap(im => {
    const src = im.getAttribute('src') || im.getAttributeNS(XLINK, 'href') || im.getAttribute('href') || ''
    if (!src || /^[a-z][\w+.-]*:/i.test(src)) return []
    return [{ path: resolve(dir, safeDec(src)), alt: (im.getAttribute('alt') ?? '').trim() }]
  })
}

function extractChapter(src: string, dir: string, tocTitle: string | undefined, skipImg: string): Chapter | null {
  let doc = new DOMParser().parseFromString(src, 'application/xhtml+xml')
  if (doc.getElementsByTagName('parsererror').length) doc = new DOMParser().parseFromString(src, 'text/html')
  const body = doc.body || doc.getElementsByTagName('body')[0]
  if (!body) return null
  const all = (body.textContent ?? '').replace(/\s+/g, ' ').trim()
  const pictures = imagesIn(body, dir).filter(i => i.path !== skipImg)
  if (all.length < 40 && !pictures.length) return null
  let linkLen = 0
  body.querySelectorAll('a').forEach(a => {
    linkLen += (a.textContent ?? '').length
  })
  if (linkLen / all.length > 0.6) return null // a contents page

  const blocks: Block[] = []
  const push = (k: Block['k'], h: string) => {
    h = tidy(h)
    if (hasText(h)) blocks.push({ k, html: h })
  }
  // `img` holds the zip path until parseEpub swaps it for the stored picture's key
  const pushImages = (el: Element) => {
    for (const { path, alt } of imagesIn(el, dir)) if (path !== skipImg) blocks.push({ k: 'i', html: esc(alt), img: path })
  }
  const walk = (el: Element, inQuote: boolean) => {
    for (const c of Array.from(el.children)) {
      const t = c.localName.toLowerCase()
      if (t === 'img' || t === 'image' || t === 'svg') pushImages(c)
      if (SKIP.has(t)) continue
      if (/^h[1-6]$/.test(t)) push('h', inline(c))
      else if (t === 'blockquote') {
        const before = blocks.length
        walk(c, true)
        if (blocks.length === before) push('q', inline(c))
      } else if (BLOCK.has(t)) {
        push(inQuote ? 'q' : 'p', inline(c))
        pushImages(c)
      } else if (c.querySelector(NESTED)) walk(c, inQuote)
      else {
        push(inQuote ? 'q' : 'p', inline(c))
        pushImages(c)
      }
    }
  }
  walk(body, false)
  if (!blocks.length) return null

  const parts: string[] = []
  while (blocks.length && blocks[0].k === 'h' && parts.length < 2) parts.push(textOf(blocks.shift()!.html).trim())
  let title = parts.join(': ')
  const numeral = (s: string) => /^[ivxlcdm\d]+\.?$/i.test(s.trim())
  if (!title && tocTitle) title = tocTitle
  else if (title && numeral(title))
    title = tocTitle && !numeral(tocTitle) ? tocTitle : 'Chapter ' + title.replace(/\.$/, '')
  if (!blocks.length) return null
  return { title, blocks }
}

export async function parseEpub(file: File, onProgress?: Progress): Promise<ParsedBook> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const names: Record<string, string> = {}
  zip.forEach(p => {
    names[p.toLowerCase()] = p
  })
  const getFile = (p: string) =>
    zip.file(p) ||
    zip.file(safeDec(p)) ||
    (names[p.toLowerCase()] && zip.file(names[p.toLowerCase()])) ||
    (names[safeDec(p).toLowerCase()] && zip.file(names[safeDec(p).toLowerCase()])) ||
    null
  const read = async (p: string) => {
    const f = getFile(p)
    return f ? f.async('string') : null
  }

  const container = await read('META-INF/container.xml')
  if (!container) throw new Error('That file is not a valid EPUB.')
  const cdoc = new DOMParser().parseFromString(container, 'application/xml')
  const rf = els(cdoc, 'rootfile')[0]
  if (!rf) throw new Error('That file is not a valid EPUB.')
  const opfPath = rf.getAttribute('full-path') ?? ''
  const opfText = await read(opfPath)
  if (!opfText) throw new Error('Could not find the book package inside this EPUB.')
  const opf = new DOMParser().parseFromString(opfText, 'application/xml')
  const base = dirOf(opfPath)

  const first = (n: string) => {
    const e = els(opf, n)[0]
    return e ? (e.textContent ?? '').replace(/\s+/g, ' ').trim() : ''
  }
  const title = first('title') || file.name.replace(/\.epub$/i, '')
  const author =
    els(opf, 'creator')
      .map(e => (e.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)[0] || 'Unknown author'

  const manifest: Record<string, { href: string; type: string; props: string }> = {}
  els(opf, 'item').forEach(it => {
    manifest[it.getAttribute('id') ?? ''] = {
      href: it.getAttribute('href') || '',
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    }
  })
  const spine = els(opf, 'itemref').map(r => r.getAttribute('idref') ?? '')

  let cover: string | null = null
  let avatar: string | null = null
  let coverPath = ''
  try {
    let item = Object.values(manifest).find(m => /cover-image/.test(m.props))
    if (!item) {
      const meta = els(opf, 'meta').find(m => m.getAttribute('name') === 'cover')
      if (meta) item = manifest[meta.getAttribute('content') ?? '']
    }
    if (item && /^image\//.test(item.type)) {
      coverPath = resolve(base, safeDec(item.href))
      const f = getFile(resolve(base, item.href))
      if (f) {
        const blob = new Blob([await f.async('arraybuffer')], { type: item.type })
        ;({ cover, avatar } = await thumbnailsFromBlob(blob))
      }
    }
  } catch {
    cover = avatar = null
  }

  // chapter titles from the table of contents
  const toc: Record<string, string> = {}
  try {
    const navItem = Object.values(manifest).find(m => /\bnav\b/.test(m.props))
    const ncxItem = Object.values(manifest).find(m => m.type === 'application/x-dtbncx+xml')
    if (navItem) {
      const p = resolve(base, navItem.href)
      const txt = await read(p)
      if (txt) {
        const d = new DOMParser().parseFromString(txt, 'text/html')
        const navs = Array.from(d.querySelectorAll('nav'))
        const nav = navs.find(n => /toc/.test(n.getAttribute('epub:type') || '')) || navs[0]
        nav?.querySelectorAll('a[href]').forEach(a => {
          const k = resolve(dirOf(p), a.getAttribute('href') ?? '')
          const t = (a.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (t && !toc[k]) toc[k] = t
        })
      }
    }
    if (ncxItem && !Object.keys(toc).length) {
      const p = resolve(base, ncxItem.href)
      const txt = await read(p)
      if (txt) {
        const d = new DOMParser().parseFromString(txt, 'application/xml')
        els(d, 'navPoint').forEach(np => {
          const label = els(np, 'text')[0]
          const content = els(np, 'content')[0]
          if (!label || !content) return
          const k = resolve(dirOf(p), content.getAttribute('src') || '')
          const t = (label.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (t && !toc[k]) toc[k] = t
        })
      }
    }
  } catch {
    /* titles fall back to headings */
  }

  const chapters: Chapter[] = []
  for (let i = 0; i < spine.length; i++) {
    const it = manifest[spine[i]]
    if (!it || !/x?html/.test(it.type) || /\bnav\b/.test(it.props)) continue
    const path = resolve(base, it.href)
    const src = await read(path)
    if (!src) continue
    const ch = extractChapter(src, dirOf(path), toc[path], coverPath)
    if (ch) {
      if (!ch.title) ch.title = 'Section ' + (chapters.length + 1)
      chapters.push(ch)
    }
    if (onProgress && i % 3 === 0) onProgress(i + 1, spine.length)
    if (i % 6 === 0) await yieldToBrowser()
  }

  const types: Record<string, string> = {}
  for (const m of Object.values(manifest)) types[resolve(base, safeDec(m.href))] = m.type
  const images = await loadImages(chapters, getFile, types)
  const kept = chapters.filter(c => c.blocks.length)
  if (!kept.length) throw new Error('No readable text found. DRM-protected books cannot be opened.')
  return { title, author, cover, avatar, chapters: kept, images }
}

const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
}
const MAX_IMAGES = 600
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/**
 * Reads the pictures the image blocks point at, then swaps each block's zip path for a short key ("i0", "i1"…).
 * Missing, unreadable, oversized and ornament-sized pictures are dropped along with their blocks.
 */
async function loadImages(
  chapters: Chapter[],
  getFile: (p: string) => JSZip.JSZipObject | null,
  types: Record<string, string>,
): Promise<Record<string, BookImage>> {
  const images: Record<string, BookImage> = {}
  const keys = new Map<string, string | null>()
  for (const ch of chapters) {
    const out: Block[] = []
    for (const b of ch.blocks) {
      if (b.k !== 'i') {
        out.push(b)
        continue
      }
      const path = b.img ?? ''
      if (!keys.has(path)) {
        keys.set(path, null)
        const f = keys.size <= MAX_IMAGES ? getFile(path) : null
        const ext = path.split('.').pop()?.toLowerCase() ?? ''
        const type = /^image\//.test(types[path] ?? '') ? types[path] : IMAGE_TYPES[ext]
        if (f && type) {
          try {
            const data = await f.async('arraybuffer')
            const img = data.byteLength <= MAX_IMAGE_BYTES ? await fitImage(new Blob([data], { type })) : null
            if (img) {
              const key = 'i' + Object.keys(images).length
              images[key] = img
              keys.set(path, key)
            }
          } catch {
            /* an unreadable picture is skipped */
          }
        }
      }
      const key = keys.get(path)
      if (key) out.push({ ...b, img: key, w: images[key].w, h: images[key].h })
    }
    ch.blocks = out
  }
  return images
}
