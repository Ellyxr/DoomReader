import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { registerSW } from 'virtual:pwa-register'

import '@/hooks/prefs'
import App from '@/App'
import { seedSample } from '@/lib/library'
import './index.css'

void seedSample()

const updateSW = registerSW({
  onNeedRefresh() {
    toast('A new version of DoomReader is ready', {
      duration: Infinity,
      action: { label: 'Reload', onClick: () => void updateSW(true) },
    })
  },
  onOfflineReady() {
    toast('DoomReader now works offline')
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
