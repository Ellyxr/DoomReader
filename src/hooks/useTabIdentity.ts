import { useEffect, useState } from 'react'

import { usePrefs } from '@/hooks/prefs'
import { listBooks, onLibraryChange } from '@/lib/db'
import { hash } from '@/lib/parse/html'
import type { BookMeta } from '@/lib/types'

const APP = 'DoomReader'

/** The book's avatar crop, or its initial on the same colour BookAvatar uses. */
function iconOf(book: BookMeta) {
  if (book.avatar) return book.avatar
  const initial = (book.title.trim()[0] || 'B').toUpperCase().replace(/[<>&"']/g, '')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="hsl(${hash(book.title) % 360} 42% 30%)"/>` +
    `<text x="32" y="45" text-anchor="middle" font-family="system-ui,sans-serif" font-size="38" font-weight="700" fill="#fff">${initial || 'B'}</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/**
 * Gives the browser tab the title and cover of the book opened last, or DoomReader's own when the `tabBook` pref
 * is off or the library is empty. Opening a book counts as reading it, so inside the reader it is that book.
 */
export function useTabIdentity() {
  const { tabBook } = usePrefs()
  const [last, setLast] = useState<BookMeta | null>(null)

  useEffect(() => {
    if (!tabBook) return
    let live = true
    const refresh = () => void listBooks().then(b => live && setLast(b.find(x => x.openedAt) ?? null))
    refresh()
    const off = onLibraryChange(refresh)
    return () => {
      live = false
      off()
    }
  }, [tabBook])

  const book = tabBook ? last : null
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) return
    const original = { href: link.getAttribute('href') ?? '', type: link.type }
    if (book) {
      document.title = `${book.title} · ${APP}`
      link.type = book.avatar ? 'image/jpeg' : 'image/svg+xml'
      link.href = iconOf(book)
    }
    return () => {
      document.title = APP
      link.type = original.type
      link.setAttribute('href', original.href)
    }
  }, [book])
}
