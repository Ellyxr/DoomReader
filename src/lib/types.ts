/**
 * A paragraph (p), heading (h), blockquote line (q) or image (i). `html` only ever contains <em>, <strong> and <br>;
 * for an image it holds the escaped alt text, and `img` names the picture in the book's image store.
 */
export interface Block {
  k: 'p' | 'h' | 'q' | 'i'
  html: string
  img?: string
  w?: number
  h?: number
}

/** A picture from an EPUB, stored apart from the text so the library and feed load without it. */
export interface BookImage {
  blob: Blob
  w: number
  h: number
}

export interface Chapter {
  title: string
  blocks: Block[]
}

/** What a parser returns. */
export interface ParsedBook {
  title: string
  author: string
  /** Portrait thumbnail for the library, as a JPEG data URL. */
  cover: string | null
  /** Square crop for the post avatar, as a JPEG data URL. */
  avatar: string | null
  chapters: Chapter[]
  /** Pictures referenced by image blocks, keyed by `Block.img`. */
  images?: Record<string, BookImage>
}

export type BookFormat = 'epub' | 'pdf' | 'sample'

/** One row of the library. Kept apart from the chapters so the library loads without reading every book. */
export interface BookMeta {
  id: string
  title: string
  author: string
  format: BookFormat
  cover: string | null
  avatar: string | null
  fileName: string
  fileSize: number
  chapterCount: number
  addedAt: number
  openedAt: number | null
  /** 0–100, updated as the book is read. */
  progress: number
}

/** A reply to a post. With `quote` it is a quote post: the highlighted words plus the reader's comment. */
export interface Note {
  id: string
  /** First segment of the post it was written on, so it stays attached when the post length changes. */
  seg: number
  quote?: string
  text: string
  at: number
}

/** Where the reader is in a book, plus liked and bookmarked segments (stored by segment index) and notes. */
export interface ReadingState {
  id: string
  seg: number
  likes: number[]
  marks: number[]
  /** In book order unless `notesCustom`, when the reader has dragged them into an order of their own. */
  notes?: Note[]
  notesCustom?: boolean
}
