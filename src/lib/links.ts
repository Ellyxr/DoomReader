import { escAttr, safeHref } from '@/lib/parse/html'

/**
 * Links in books. EPUB links to the web are kept when a book is imported (lib/parse/epub); addresses written out in
 * the text (https://…, www.…, emails) are turned into links as posts are drawn, so they work in every book and PDF.
 * Tapping one asks first (components/LinkSheet): a book can contain anything.
 */

const ADDRESS = /\b(?:https?:\/\/|www\.)[^\s<>"']+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi
const count = (s: string, c: string) => s.split(c).length - 1

/** Punctuation after an address belongs to the sentence, except a ")" that closes one inside the address. */
function splitTail(u: string): [string, string] {
  let tail = ''
  for (;;) {
    const c = u.slice(-1)
    if (/[.,;:!?'"”’\]}]/.test(c) || (c === ')' && count(u, '(') < count(u, ')'))) {
      tail = c + tail
      u = u.slice(0, -1)
    } else return [u, tail]
  }
}

/** Post HTML with the addresses in its text made into links. Text already inside a link is left alone. */
export function linkify(html: string) {
  if (!/https?:|www\.|@/i.test(html)) return html
  let inLink = 0
  return html
    .split(/(<[^>]+>)/)
    .map(part => {
      if (part[0] === '<') {
        if (/^<a[\s>]/i.test(part)) inLink++
        else if (/^<\/a>/i.test(part)) inLink = Math.max(0, inLink - 1)
        return part
      }
      if (inLink) return part
      return part.replace(ADDRESS, m => {
        const [shown, tail] = splitTail(m)
        const plain = shown.replace(/&amp;/g, '&')
        const href = safeHref(
          plain.includes('@') && !/^https?:|^www\./i.test(plain)
            ? `mailto:${plain}`
            : /^www\./i.test(plain)
              ? `https://${plain}`
              : plain,
        )
        return href ? `<a href="${escAttr(href)}">${shown}</a>${tail}` : m
      })
    })
    .join('')
}
