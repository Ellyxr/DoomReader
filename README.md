# DoomReader

Read EPUBs and PDFs as an X-style scrolling feed. Each chapter becomes a thread of posts. You can like and bookmark
passages, and the app remembers your place. It's an installable PWA that works offline, and every book stays on your
device.

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
  search, delete, storage usage and a "protect my library" button (`navigator.storage.persist()`).
- **Reader** (`src/pages/Reader.tsx`): the feed, with the Reading, Chapters and Saved tabs. Press `j`/`k` to move
  between posts.
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
automatically for installed apps), the browser won't evict it to free space. Libraries don't sync between devices.

## Deploying

`npm run build` outputs a static site. Routes use the URL hash (`#/read/:id`), so any static host works without
rewrite rules: Netlify, Vercel, Cloudflare Pages or GitHub Pages. For GitHub Pages under `/<repo>/`, set
`base: '/<repo>/'` in `vite.config.ts`. A PWA must be served over HTTPS (`localhost` is fine for development).
