const AVATAR = 96
const COVER_W = 240
const COVER_MAX_H = 360

/** Turns a cover image (or a rendered first page) into the library thumbnail and the square avatar. */
export function thumbnails(src: CanvasImageSource & { width: number; height: number }) {
  const { width: w, height: h } = src
  if (!w || !h) return { cover: null, avatar: null }

  const a = document.createElement('canvas')
  a.width = a.height = AVATAR
  const s = Math.min(w, h)
  a.getContext('2d')!.drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, AVATAR, AVATAR)

  const c = document.createElement('canvas')
  c.width = COVER_W
  c.height = Math.min(COVER_MAX_H, Math.round((h / w) * COVER_W))
  // crop from the top so very tall pages keep their title area
  const srcH = (c.height / COVER_W) * w
  c.getContext('2d')!.drawImage(src, 0, 0, w, Math.min(h, srcH), 0, 0, c.width, c.height)

  return { avatar: a.toDataURL('image/jpeg', 0.82), cover: c.toDataURL('image/jpeg', 0.8) }
}

async function withImage<T>(blob: Blob, fn: (img: HTMLImageElement) => T | Promise<T>) {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => {
      const im = new Image()
      im.onload = () => ok(im)
      im.onerror = no
      im.src = url
    })
    return await fn(img)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export const thumbnailsFromBlob = (blob: Blob) => withImage(blob, thumbnails)

const MEDIA_MAX = 1600
const MEDIA_MAX_BYTES = 1.5 * 1024 * 1024

/**
 * Measures a book picture for the feed and shrinks it when it is bigger than a phone screen needs. Ornaments and
 * spacer images (under 48px) return null. GIFs and SVGs are kept as they are, so animation and sharpness survive.
 */
export function fitImage(blob: Blob) {
  return withImage(blob, async img => {
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h || (w < 48 && h < 48)) return null
    const keep = /gif|svg/.test(blob.type) || (Math.max(w, h) <= MEDIA_MAX && blob.size <= MEDIA_MAX_BYTES)
    if (keep) return { blob, w, h }
    const s = Math.min(1, MEDIA_MAX / Math.max(w, h))
    const c = document.createElement('canvas')
    c.width = Math.round(w * s)
    c.height = Math.round(h * s)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    const out = await new Promise<Blob | null>(ok => c.toBlob(ok, 'image/webp', 0.85))
    return { blob: out && out.size < blob.size ? out : blob, w: c.width, h: c.height }
  })
}
