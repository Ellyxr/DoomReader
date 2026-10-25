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

export async function thumbnailsFromBlob(blob: Blob) {
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => {
      const im = new Image()
      im.onload = () => ok(im)
      im.onerror = no
      im.src = url
    })
    return thumbnails(img)
  } finally {
    URL.revokeObjectURL(url)
  }
}
