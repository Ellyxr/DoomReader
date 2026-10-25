import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// `npm run icons` regenerates the PNG app icons in public/ from public/favicon.svg.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#1d9bf0' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#1d9bf0' } },
  },
  images: ['public/favicon.svg'],
})
