export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export const textOf = (h: string) =>
  h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/**
 * Rebuilds untrusted markup (from a restored backup) keeping only text, <em>, <strong>, <br> and web links, the same
 * subset the parsers produce. DOMParser documents are inert, so nothing in the input runs while it is read.
 */
export function safeInline(html: string) {
  const walk = (n: Node): string => {
    let s = ''
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) s += esc(c.nodeValue ?? '')
      else if (c.nodeType === Node.ELEMENT_NODE) {
        const t = (c as Element).localName
        if (t === 'br') s += '<br>'
        else if (t === 'em' || t === 'strong') s += `<${t}>${walk(c)}</${t}>`
        else if (t === 'a') {
          const href = safeHref((c as Element).getAttribute('href'))
          s += href ? `<a href="${escAttr(href)}">${walk(c)}</a>` : walk(c)
        }
        else if (t !== 'script' && t !== 'style') s += walk(c)
      }
    }
    return s
  }
  return walk(new DOMParser().parseFromString(`<body>${html}`, 'text/html').body)
}

export const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;')

/** A link's destination if it is one this app will open (web or email), as a full URL; anything else is null. */
export function safeHref(raw: string | null | undefined) {
  if (!raw) return null
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:' ? u.href : null
  } catch {
    return null // relative links point inside the book, which has no pages to open
  }
}

export const hash = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h
}

/** Lets the browser paint between chunks of a long parse. */
export const yieldToBrowser = () => new Promise(r => setTimeout(r, 0))
