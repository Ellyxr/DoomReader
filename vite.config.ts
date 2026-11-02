import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Windows 11 Widgets Board widgets (Edge). Drawn by public/widgets-sw.js from the Adaptive Card templates in
// public/widgets; `update` redraws hourly so the streak notices a new day. Not in the plugin's manifest type yet.
const widget = (tag: string, name: string, description: string) => ({
  name,
  short_name: name,
  description,
  tag,
  ms_ac_template: `widgets/${tag}.json`,
  data: `widgets/data/${tag}.json`,
  type: 'application/json',
  update: 3600,
  // TODO: replace with real screenshots of each widget; the Widgets Board shows these in its picker
  screenshots: [{ src: 'pwa-512x512.png', sizes: '512x512', label: name }],
  icons: [{ src: 'pwa-192x192.png', sizes: '192x192' }],
})
const widgets = [
  widget('streak', 'Reading streak', 'Your reading days this week.'),
  widget('continue', 'Continue reading', 'The book you were reading, and how far in you are.'),
  widget('post', 'Next post', 'The next post in your book, one at a time.'),
]

// `npm run preview` sends the same security headers as the Vercel deployment, so the CSP can be tested locally
const vercel = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'vercel.json'), 'utf8'))
const securityHeaders: Record<string, string> = Object.fromEntries(
  vercel.headers
    .find((h: { source: string }) => h.source === '/(.*)')
    .headers.filter((h: { key: string }) => h.key !== 'Strict-Transport-Security')
    // preview runs on plain http://localhost, so leave out the https-only parts
    .map((h: { key: string; value: string }) => [h.key, h.value.replace(/;\s*upgrade-insecure-requests/, '')]),
)

export default defineConfig({
  preview: { headers: securityHeaders },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'DoomReader',
        short_name: 'DoomReader',
        description: 'Read EPUBs and PDFs as a scrolling feed. Your library stays on your device.',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // lets the installed app appear in the OS "Open with" menu for these files (Chromium desktop)
        file_handlers: [
          {
            action: './',
            accept: { 'application/epub+zip': ['.epub'], 'application/pdf': ['.pdf'] },
          },
        ],
        launch_handler: { client_mode: 'focus-existing' },
        // long-press the app icon
        shortcuts: [
          {
            name: 'Continue reading',
            short_name: 'Continue',
            url: './#/continue',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Scan a sync code',
            short_name: 'Scan',
            url: './#/scan',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        ...({ widgets } as object),
      },
      workbox: {
        // the pdf.js worker is ~1 MB; precache it so PDFs import offline
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest}', 'widgets/*.json'],
        importScripts: ['widgets-sw.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // shortcut favicons, so the buttons keep their faces offline
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://icons.duckduckgo.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'shortcut-icons',
              expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
