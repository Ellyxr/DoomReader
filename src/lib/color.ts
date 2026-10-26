import { hash } from '@/lib/parse/html'

/**
 * A book's own colour, for podcast mode's background: the most vivid colour on its cover (or the hue its initial avatar
 * uses), darkened until white text on it passes WCAG AAA (7:1), so big text is always easy to read.
 */
export interface BookColor {
  /** Background at the top. */
  bg: string
  /** Background at the bottom, nearly black. */
  deep: string
  /** Secondary text (the sentences either side, labels), still at least 4.5:1 against `bg`. */
  dim: string
}

type RGB = [number, number, number]

const lum = ([r, g, b]: RGB) => {
  const c = (v: number) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}
const contrast = (a: RGB, b: RGB) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

function toHsl([r, g, b]: RGB): RGB {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function toRgb([h, s, l]: RGB): RGB {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

const css = ([r, g, b]: RGB, alpha = 1) =>
  alpha < 1 ? `rgb(${r | 0} ${g | 0} ${b | 0} / ${alpha.toFixed(2)})` : `rgb(${r | 0} ${g | 0} ${b | 0})`

const WHITE: RGB = [255, 255, 255]

/** The colour as a podcast background with readable white text. */
function deepen(rgb: RGB): BookColor {
  let [h, s, l] = toHsl(rgb)
  s = Math.min(s, 0.75) // very saturated colours glare when they fill the screen
  let bg = toRgb([h, s, l])
  while (contrast(WHITE, bg) < 7 && l > 0) bg = toRgb([h, s, (l -= 0.02)])
  const deep = toRgb([h, s, l * 0.3])
  // the faintest white that still reads at 4.5:1 on the lightest part of the background
  let alpha = 0.6
  const over = (a: number): RGB => bg.map((c, i) => c + (WHITE[i] - c) * a) as RGB
  while (contrast(over(alpha), bg) < 4.5 && alpha < 1) alpha += 0.05
  return { bg: css(bg), deep: css(deep), dim: css(WHITE, alpha) }
}

/** The most vivid colour in an image: the hue with the most saturated, bright pixels, averaged. */
async function dominant(src: string): Promise<RGB | null> {
  const img = new Image()
  img.src = src
  await img.decode()
  const N = 24
  const c = document.createElement('canvas')
  c.width = c.height = N
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, N, N)
  const px = ctx.getImageData(0, 0, N, N).data
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
  const all = { w: 0, r: 0, g: 0, b: 0 }
  for (let i = 0; i < px.length; i += 4) {
    const rgb: RGB = [px[i], px[i + 1], px[i + 2]]
    const [h, s, l] = toHsl(rgb)
    all.w++
    all.r += rgb[0]
    all.g += rgb[1]
    all.b += rgb[2]
    // greys, near-black and near-white say little about a cover's colour
    const w = s * (1 - Math.abs(l - 0.5) * 2)
    if (w < 0.08) continue
    const bin = bins[Math.floor(h / 15) % 24]
    bin.w += w
    bin.r += rgb[0] * w
    bin.g += rgb[1] * w
    bin.b += rgb[2] * w
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a))
  // a black-and-white cover: its average grey, which deepens to a neutral charcoal
  if (best.w < all.w * 0.02) return [all.r / all.w, all.g / all.w, all.b / all.w]
  return [best.r / best.w, best.g / best.w, best.b / best.w]
}

const cache = new Map<string, Promise<BookColor>>()

/** The podcast colours for a book, from its avatar (a cover crop) or, without one, from its title. */
export function bookColor(book: { id: string; title: string; avatar: string | null }) {
  let p = cache.get(book.id)
  if (!p) {
    const fallback = () => deepen(toRgb([hash(book.title) % 360, 0.42, 0.3]))
    p = book.avatar
      ? dominant(book.avatar).then(rgb => (rgb ? deepen(rgb) : fallback()), fallback)
      : Promise.resolve(fallback())
    cache.set(book.id, p)
  }
  return p
}

/** Until the cover has been read: a neutral charcoal. */
export const NEUTRAL: BookColor = deepen([40, 40, 46])
