# DoomReader

Read EPUBs and PDFs as an X-style scrolling feed. Each chapter becomes a thread of posts, with the book's pictures
attached like tweet media. You can like and bookmark passages, reply with notes, quote highlighted lines, search the
book and have it read aloud, and the app remembers your place. It's an installable PWA that works offline, and every
book stays on your device.

## Stack

React 19 + TypeScript, Vite, Tailwind CSS v4 and shadcn/ui (Radix). EPUBs are parsed with JSZip, PDFs with pdf.js.
Storage is IndexedDB (via `idb`), and `vite-plugin-pwa` provides the service worker and manifest.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm run preview    # serve the production build (needed to test the service worker)
npm run icons      # regenerate app icons from public/favicon.svg
```

## How it works

- **Library** (`src/pages/Library.tsx`): every imported book with its cover, progress and last-opened time, plus
  search, delete, storage usage, a "protect my library" button (`navigator.storage.persist()`) and backup / restore.
- **Reader** (`src/pages/Reader.tsx`): the feed, with the Reading, Chapters, Saved and Notes tabs. Press `j`/`k` to
  move between posts and `/` to search.
  - **Notes**: the reply button writes a note on a post.
  - **Quotes** (`src/hooks/useSentenceSelect.ts`, `src/lib/highlight.ts`): on a phone, hold a sentence to select it,
    keep holding and drag to grow the selection sentence by sentence (the page holds still, and scrolls when the finger
    nears the top or bottom), or tap another sentence to extend to it. With a mouse, select text as usual. A bar at the
    bottom then offers Save quote, Add note and Copy. Saved quotes are highlighted in the text; tap a highlight (or
    "Add a note" on the Notes tab, or the toast after saving) to add or edit its note. The browser's own long-press
    selection is turned off inside post text on touch screens, since it works word by word with small handles.
  - Notes and quotes are anchored to a segment, so they stay put when the post length changes.
  - **Search** (`searchBook` in `src/lib/feed.ts`): case- and accent-insensitive; a result opens the feed at that post.
  - **Read aloud** (`src/hooks/useSpeech.ts`): the headphones button reads the feed with the browser's own voices (Web
    Speech API, so it's free and works offline with the device's voices), scrolling along post by post, at 0.8× to 2×.
- **Pictures** (`src/components/PostMedia.tsx`): EPUB images become post media laid out like X (one picture keeps its
  shape within limits, two to four share a grid), and tapping opens them full screen. They're stored as blobs in their
  own IndexedDB store; oversized ones are shrunk to 1600px on import, and tiny ornaments and the cover are skipped.
  Books imported before pictures were supported need to be deleted and added again to get them.
- **Backup** (`src/lib/backup.ts`): one `.zip` with every book's text, pictures, place, likes, bookmarks and notes.
  Restoring adds missing books; for a book already here it keeps this device's place and combines marks and notes.
- **Importing** (`src/components/Importer.tsx`): the + button, drag and drop anywhere, and the OS "Open with" menu
  once installed (desktop Chromium, via the manifest's `file_handlers`). Books are identified by a SHA-256 of the file,
  so adding the same file twice opens the existing copy.
- **Parsers** (`src/lib/parse/`):
  - EPUB: walks the spine and uses the TOC for chapter titles.
  - PDF: rebuilds lines and paragraphs from positioned text, strips running headers, footers and page numbers, and
    rejoins hyphenated words. Chapters come from the PDF outline, then from large headings, then from 10-page groups.
    Scanned (image-only) PDFs are rejected, since they have no text to extract.
- **Feed** (`src/lib/feed.ts`): splits chapters into segments and groups them into posts of the chosen length.
- **Settings** (`src/hooks/prefs.ts`): theme (light, dark or system), post length, text size and typeface. They are
  saved in `localStorage`.

## Storage

Everything is stored in the browser's IndexedDB for this site. There are no accounts and no server, and nothing is
uploaded. The library lasts until the user clears the site's data. Once protected storage is granted (Chrome grants it
automatically for installed apps), the browser won't evict it to free space. Libraries don't sync between devices; a
backup file is how you move one.

## Security

Book files and backups are untrusted input, and post text is rendered as HTML, so:

- Parsers keep only text plus `<em>`, `<strong>` and `<br>`; scripts, links, iframes and event handlers never reach the
  page. Pictures come only from inside the book file (remote and `data:` URLs are ignored) and are shown with `<img>`.
- Restoring a backup type-checks every field and runs all markup back through the same filter (`safeInline` in
  `src/lib/parse/html.ts`), rejects odd book ids, and accepts covers only as `data:image/...` URLs.
- Size limits: 300 MB per book, 20 MB per picture, 600 pictures per book, 1 GB per backup. pdf.js runs without
  WebAssembly and with a cap on image size.
- `vercel.json` sends a strict Content-Security-Policy (no inline or third-party scripts, no framing, no network
  requests to other sites) plus `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP and HSTS. The theme
  script lives in `public/theme.js` rather than inline so the policy can forbid inline scripts. `npm run preview`
  sends the same headers, so test there after changing anything that loads resources.

## Deploying

`npm run build` outputs a static site. Routes use the URL hash (`#/read/:id`), so any static host works without
rewrite rules: Netlify, Vercel, Cloudflare Pages or GitHub Pages. For GitHub Pages under `/<repo>/`, set
`base: '/<repo>/'` in `vite.config.ts`. A PWA must be served over HTTPS (`localhost` is fine for development).
On Vercel, import the repo and keep the detected Vite defaults; the security headers come from `vercel.json`. Other
hosts need the same headers set in their own config (for example `_headers` on Netlify or Cloudflare Pages).
