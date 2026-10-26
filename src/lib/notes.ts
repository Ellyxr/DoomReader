import type { Segment } from '@/lib/feed'
import { findQuote } from '@/lib/highlight'
import { textOf } from '@/lib/parse/html'
import type { Note } from '@/lib/types'

/**
 * Notes are listed in book order: by segment, then where the quote starts in it, then when they were written. The
 * reader can drag them into an order of their own; a note added after that goes next to the one before it in the book.
 */
type Place = [seg: number, at: number, written: number]

function place(segs: Segment[], n: Note): Place {
  const seg = segs[n.seg]
  // the quote's opening words are enough to find it, even when the rest runs on into the next segment
  const at = n.quote && seg ? (findQuote(textOf(seg.html), n.quote.slice(0, 24))?.a ?? 0) : 0
  return [n.seg, at, n.at]
}

const cmp = (a: Place, b: Place) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

export function sortByBook(notes: Note[], segs: Segment[]) {
  const at = new Map(notes.map(n => [n, place(segs, n)]))
  return [...notes].sort((a, b) => cmp(at.get(a)!, at.get(b)!))
}

export function inBookOrder(notes: Note[], segs: Segment[]) {
  for (let i = 1; i < notes.length; i++) if (cmp(place(segs, notes[i - 1]), place(segs, notes[i])) > 0) return false
  return true
}

/** Adds a note after the one that comes just before it in the book, wherever the reader has moved that one. */
export function insertByBook(notes: Note[], note: Note, segs: Segment[]) {
  const p = place(segs, note)
  let after = -1
  let afterP: Place | null = null
  let first = -1
  let firstP: Place | null = null
  notes.forEach((n, i) => {
    const q = place(segs, n)
    if (cmp(q, p) <= 0 && (!afterP || cmp(q, afterP) >= 0)) [after, afterP] = [i, q]
    if (!firstP || cmp(q, firstP) < 0) [first, firstP] = [i, q]
  })
  // nothing comes before it in the book: put it ahead of the note that comes first
  const at = after > -1 ? after + 1 : Math.max(0, first)
  return [...notes.slice(0, at), note, ...notes.slice(at)]
}

export function moved<T>(list: T[], from: number, to: number) {
  const next = [...list]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}
