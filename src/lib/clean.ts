import type { Note, ReadingState } from '@/lib/types'

/*
 * Checks for reading state that comes from outside this browser (a backup file or a sync link): every field is
 * type-checked and rebuilt, so nothing unexpected reaches the database.
 */

export const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
export const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '')
export const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
export const int = (v: unknown) => Math.max(0, Math.floor(num(v)))
export const ints = (v: unknown) => (Array.isArray(v) ? v.filter(n => Number.isInteger(n) && n >= 0) : []) as number[]

export function cleanNotes(v: unknown): Note[] {
  if (!Array.isArray(v)) return []
  return v.flatMap(n => {
    const o = obj(n)
    const id = str(o.id, 64)
    const text = str(o.text, 10_000)
    const quote = str(o.quote, 5000)
    // a quote may have no comment; a reply must have one
    if (!id || (!text && !quote)) return []
    return [{ id, seg: int(o.seg), text, at: num(o.at, Date.now()), ...(quote ? { quote } : {}) }]
  })
}

export function cleanState(id: string, v: unknown): ReadingState | undefined {
  if (!v) return undefined
  const o = obj(v)
  return {
    id,
    seg: int(o.seg),
    likes: ints(o.likes),
    marks: ints(o.marks),
    notes: cleanNotes(o.notes),
    ...(o.notesCustom === true ? { notesCustom: true } : {}),
  }
}

/**
 * Joins two states for a book that is on both devices: this device keeps its place; marks and notes are combined.
 * Notes keep this device's order, with the other device's new ones after them (the reader re-sorts unless custom).
 */
export function mergeState(here: ReadingState | undefined, there: ReadingState): ReadingState {
  if (!here) return there
  const notes = new Map((here.notes ?? []).map(n => [n.id, n]))
  for (const n of there.notes ?? []) if (!notes.has(n.id)) notes.set(n.id, n)
  return {
    ...here,
    likes: [...new Set([...here.likes, ...there.likes])],
    marks: [...new Set([...here.marks, ...there.marks])],
    notes: [...notes.values()],
  }
}
