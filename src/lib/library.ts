import { addBook, hasBook } from '@/lib/db'
import { SAMPLE_ID, sampleBook } from '@/lib/sample'
import type { BookFormat, BookMeta, ParsedBook } from '@/lib/types'

export const ACCEPT = '.epub,.pdf,application/epub+zip,application/pdf'

async function sniff(file: File): Promise<BookFormat | null> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  const magic = String.fromCharCode(...head)
  if (magic.startsWith('%PDF')) return 'pdf'
  if (magic.startsWith('PK')) return /\.pdf$/i.test(file.name) ? null : 'epub'
  return null
}

/** Content hash, so adding the same file twice opens the existing copy instead of duplicating it. */
async function fileId(file: File) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return Array.from(new Uint8Array(digest).slice(0, 12), b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    // crypto.subtle is missing outside secure contexts (e.g. plain http on a LAN IP)
    return `${file.name}-${file.size}-${file.lastModified}`.replace(/[^\w-]/g, '_')
  }
}

function toMeta(id: string, book: ParsedBook, format: BookFormat, file?: File): BookMeta {
  return {
    id,
    title: book.title,
    author: book.author,
    format,
    cover: book.cover,
    avatar: book.avatar,
    fileName: file?.name ?? '',
    fileSize: file?.size ?? 0,
    chapterCount: book.chapters.length,
    addedAt: Date.now(),
    openedAt: null,
    progress: 0,
  }
}

export interface ImportResult {
  id: string
  title: string
  duplicate: boolean
}

export async function importFile(file: File, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const format = await sniff(file)
  if (!format) throw new Error(`${file.name} is not an EPUB or PDF.`)
  const id = await fileId(file)
  if (await hasBook(id)) return { id, title: file.name, duplicate: true }

  // parsers are loaded on demand so pdf.js and JSZip stay out of the first load
  const book =
    format === 'pdf'
      ? await (await import('@/lib/parse/pdf')).parsePdf(file, onProgress)
      : await (await import('@/lib/parse/epub')).parseEpub(file, onProgress)

  await addBook(toMeta(id, book, format, file), book.chapters)
  return { id, title: book.title, duplicate: false }
}

const SEEDED = 'doomreader:seeded'

/** Puts the sample book in the library on first run. Deleting it later is respected. */
export async function seedSample() {
  try {
    if (localStorage.getItem(SEEDED)) return
    localStorage.setItem(SEEDED, '1')
  } catch {
    return
  }
  if (await hasBook(SAMPLE_ID)) return
  const book = sampleBook()
  await addBook(toMeta(SAMPLE_ID, book, 'sample'), book.chapters)
}
