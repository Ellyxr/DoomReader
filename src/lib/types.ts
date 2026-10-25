/** A paragraph (p), heading (h) or blockquote line (q). `html` only ever contains <em>, <strong> and <br>. */
export interface Block {
  k: 'p' | 'h' | 'q'
  html: string
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

/** Where the reader is in a book, plus liked and bookmarked segments (stored by segment index). */
export interface ReadingState {
  id: string
  seg: number
  likes: number[]
  marks: number[]
}
