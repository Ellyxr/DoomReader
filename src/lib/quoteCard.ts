import { hash } from '@/lib/parse/html'

/**
 * Quote cards: a passage drawn as a picture to post elsewhere, with the book's cover, title and author. Drawn on a
 * canvas on this device; nothing is uploaded.
 */

export type CardSize = 'x' | 'facebook' | 'instagram' | 'threads'
export type CardTheme = 'light' | 'dark'

/** Each network's best-fitting feed picture: the shape it shows whole, at the width it keeps. */
export const CARD_SIZES: Record<CardSize, { name: string; w: number; h: number; ratio: string }> = {
  x: { name: 'X', w: 1600, h: 900, ratio: '16:9' },
  facebook: { name: 'Facebook', w: 1080, h: 1080, ratio: '1:1' },
  instagram: { name: 'Instagram', w: 1080, h: 1350, ratio: '4:5' },
  threads: { name: 'Threads', w: 1080, h: 1440, ratio: '3:4' },
}

export interface CardBook {
  title: string
  author: string
  /** Portrait cover, else the square avatar crop, as data URLs; neither means a coloured tile with the initial. */
  cover: string | null
  avatar: string | null
}

const COLORS = {
  light: { bg: '#ffffff', text: '#0f1419', muted: '#536471', rule: '#eff3f4' },
  dark: { bg: '#000000', text: '#e7e9ea', muted: '#71767b', rule: '#2f3336' },
}
const ACCENT = '#1d9bf0'
const SERIF = "Charter, 'Iowan Old Style', 'Palatino Linotype', Georgia, serif"
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>(res => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => res(null)
    img.src = src
  })

/** Lines of `text` at the context's current font, no wider than `max`; a blank line between paragraphs is ''. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const lines: string[] = []
  text
    .split(/\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .forEach((para, k) => {
      if (k) lines.push('')
      let line = ''
      for (const word of para.split(/\s+/)) {
        const next = line ? line + ' ' + word : word
        if (!line || ctx.measureText(next).width <= max) line = next
        else {
          lines.push(line)
          line = word
        }
      }
      if (line) lines.push(line)
    })
  return lines
}

/** Cuts lines to `n`, ending the last with an ellipsis that fits. */
function clip(ctx: CanvasRenderingContext2D, lines: string[], n: number, max: number) {
  const out = lines.slice(0, n)
  while (out.length && !out[out.length - 1]) out.pop()
  let last = (out.pop() ?? '') + '…'
  while (ctx.measureText(last).width > max && last.includes(' ')) last = last.replace(/\s*\S+…$/, '…')
  return [...out, last]
}

/** One line of text, shortened with an ellipsis to fit `max`. */
function fitLine(ctx: CanvasRenderingContext2D, s: string, max: number) {
  if (ctx.measureText(s).width <= max) return s
  while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1)
  return s.trimEnd() + '…'
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** Draws the card and returns it as a PNG. */
export async function drawCard(quote: string, book: CardBook, size: CardSize, theme: CardTheme): Promise<Blob> {
  const { w, h } = CARD_SIZES[size]
  const c = COLORS[theme]
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  await document.fonts.ready

  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, w, h)

  const unit = Math.min(w, h)
  const pad = Math.round(unit * 0.08)
  const inner = w - pad * 2

  // footer: cover, then title and author, then the app's name, under a hairline
  const coverH = Math.round(unit * 0.13)
  const footTop = h - pad - coverH
  const pic = book.cover ?? book.avatar
  const img = pic ? await loadImage(pic) : null
  const coverW = img && book.cover ? Math.round(coverH * 0.7) : coverH
  roundRect(ctx, pad, footTop, coverW, coverH, Math.round(unit * 0.012))
  ctx.save()
  ctx.clip()
  if (img) {
    // cover-fit the picture into the box
    const s = Math.max(coverW / img.width, coverH / img.height)
    ctx.drawImage(img, pad + (coverW - img.width * s) / 2, footTop + (coverH - img.height * s) / 2, img.width * s, img.height * s)
  } else {
    ctx.fillStyle = `hsl(${hash(book.title) % 360} 42% 30%)`
    ctx.fillRect(pad, footTop, coverW, coverH)
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${Math.round(coverH * 0.5)}px ${SANS}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText((book.title.trim()[0] || 'B').toUpperCase(), pad + coverW / 2, footTop + coverH / 2)
    ctx.textAlign = 'left'
  }
  ctx.restore()

  const brandSize = Math.round(unit * 0.026)
  ctx.font = `700 ${brandSize}px ${SANS}`
  const brand = 'DoomReader'
  const brandW = ctx.measureText(brand).width
  ctx.fillStyle = ACCENT
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(brand, w - pad - brandW, footTop + coverH - brandSize * 0.2)

  const textX = pad + coverW + Math.round(unit * 0.035)
  const textMax = w - pad - textX - brandW - Math.round(unit * 0.04)
  const titleSize = Math.round(unit * 0.036)
  const authorSize = Math.round(unit * 0.03)
  const mid = footTop + coverH / 2
  ctx.textBaseline = 'middle'
  ctx.fillStyle = c.text
  ctx.font = `700 ${titleSize}px ${SANS}`
  ctx.fillText(fitLine(ctx, book.title, textMax), textX, book.author ? mid - titleSize * 0.65 : mid)
  if (book.author) {
    ctx.fillStyle = c.muted
    ctx.font = `400 ${authorSize}px ${SANS}`
    ctx.fillText(fitLine(ctx, book.author, textMax), textX, mid + authorSize * 0.75)
  }

  const ruleY = footTop - Math.round(unit * 0.05)
  ctx.fillStyle = c.rule
  ctx.fillRect(pad, ruleY, inner, Math.max(2, Math.round(unit * 0.002)))

  // the quote mark, then the passage as large as fits between it and the hairline
  const markSize = Math.round(unit * 0.16)
  ctx.fillStyle = ACCENT
  ctx.font = `700 ${markSize}px ${SERIF}`
  ctx.textBaseline = 'top'
  ctx.fillText('“', pad - markSize * 0.04, pad - markSize * 0.08)

  const top = pad + markSize * 0.55
  const room = ruleY - Math.round(unit * 0.05) - top
  const lh = 1.32
  const font = (px: number) => `400 ${px}px ${SERIF}`
  const fits = (px: number) => {
    ctx.font = font(px)
    const lines = wrap(ctx, quote, inner)
    // a paragraph break takes half a line
    const height = lines.reduce((t, l) => t + (l ? 1 : 0.5), 0) * px * lh
    return { lines, ok: height <= room }
  }
  const maxPx = Math.round(unit * 0.1)
  const minPx = Math.round(unit * 0.03)
  let px = minPx
  for (let lo = minPx, hi = maxPx; lo <= hi; ) {
    const m = (lo + hi) >> 1
    if (fits(m).ok) {
      px = m
      lo = m + 1
    } else hi = m - 1
  }
  const fitted = fits(px)
  let { lines } = fitted
  if (!fitted.ok) {
    let n = 0
    for (let used = 0; n < lines.length; n++) {
      used += (lines[n] ? 1 : 0.5) * px * lh
      if (used > room) break
    }
    lines = clip(ctx, lines, n, inner)
  }

  // centred in the space left, so short quotes don't hang at the top
  const height = lines.reduce((t, l) => t + (l ? 1 : 0.5), 0) * px * lh
  let y = top + Math.max(0, (room - height) / 2)
  ctx.fillStyle = c.text
  ctx.textBaseline = 'top'
  for (const l of lines) {
    if (l) ctx.fillText(l, pad, y + (px * (lh - 1)) / 2)
    y += (l ? 1 : 0.5) * px * lh
  }

  return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('Could not draw the card'))), 'image/png'))
}

/** A file name for the card, from the book's title. */
export const cardFileName = (title: string, size: CardSize) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'quote'}-${size}.png`
