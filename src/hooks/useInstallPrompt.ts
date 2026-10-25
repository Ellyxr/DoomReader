import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  deferred = e as BeforeInstallPromptEvent
  listeners.forEach(l => l())
})
addEventListener('appinstalled', () => {
  deferred = null
  listeners.forEach(l => l())
})

/** Chromium's install prompt, captured so the app can offer its own Install button. Null elsewhere (Safari installs via Share → Add to Home Screen). */
export function useInstallPrompt() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force(n => n + 1)
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  if (!deferred) return null
  return async () => {
    const e = deferred
    if (!e) return
    await e.prompt()
    await e.userChoice
    deferred = null
    listeners.forEach(l => l())
  }
}
