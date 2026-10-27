import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { syncCodeFrom } from '@/lib/sync'

/** The browser's own QR reader, where there is one (Chrome on Android and macOS). Not in TypeScript's DOM types yet. */
declare class BarcodeDetector {
  constructor(o: { formats: string[] })
  static getSupportedFormats(): Promise<string[]>
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>
}

type Read = (video: HTMLVideoElement) => Promise<string | null>

/** A QR reader: the built-in one if the browser has it, else jsQR (loaded only now). */
async function makeReader(): Promise<Read> {
  try {
    if (typeof BarcodeDetector !== 'undefined' && (await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
      const d = new BarcodeDetector({ formats: ['qr_code'] })
      return async v => (await d.detect(v))[0]?.rawValue ?? null
    }
  } catch {
    /* fall back to jsQR */
  }
  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  return async v => {
    // a smaller frame reads just as well and keeps each pass quick
    const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight))
    canvas.width = Math.round(v.videoWidth * scale)
    canvas.height = Math.round(v.videoHeight * scale)
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
}

type Camera = { k: 'starting' } | { k: 'on' } | { k: 'denied' } | { k: 'none' }

/** Scanning a sync QR code with the camera, or pasting the link, to pick up a book where another device left it. */
export function ScanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={o => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-[rgba(91,112,131,0.4)]" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-[51] grid w-[min(360px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-2xl bg-background p-4 shadow-pop outline-none"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          {open && <Scanner onClose={onClose} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Scanner({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const video = useRef<HTMLVideoElement>(null)
  const [camera, setCamera] = useState<Camera>({ k: 'starting' })
  const [wrong, setWrong] = useState(false)
  const [pasted, setPasted] = useState('')
  const [pasteError, setPasteError] = useState(false)

  const go = (code: string) => {
    onClose()
    navigate(`/sync/${code}`)
  }
  const goRef = useRef(go)
  useEffect(() => {
    goRef.current = go
  })

  useEffect(() => {
    let live = true
    let stream: MediaStream | null = null
    let timer = 0
    let lastWrong = ''
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch (e) {
        if (live) setCamera({ k: e instanceof DOMException && e.name === 'NotAllowedError' ? 'denied' : 'none' })
        return
      }
      if (!live || !video.current) return stream.getTracks().forEach(t => t.stop())
      video.current.srcObject = stream
      await video.current.play().catch(() => {})
      setCamera({ k: 'on' })
      const read = await makeReader()
      const tick = async () => {
        const v = video.current
        if (!live || !v) return
        if (v.readyState >= 2) {
          const text = await read(v).catch(() => null)
          if (!live) return
          const code = text && syncCodeFrom(text)
          if (code) return goRef.current(code)
          // some other QR code: say so once, and keep looking
          if (text && text !== lastWrong) {
            lastWrong = text
            setWrong(true)
          }
        }
        timer = window.setTimeout(tick, 200)
      }
      void tick()
    })()
    return () => {
      live = false
      clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const code = syncCodeFrom(pasted)
    if (code) go(code)
    else setPasteError(true)
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Dialog.Title className="flex-1 text-[17px] font-bold">Scan a sync code</Dialog.Title>
        <Dialog.Close aria-label="Close" className="-mr-2 grid size-9 place-items-center rounded-full hover:bg-accent">
          <X className="size-5" />
        </Dialog.Close>
      </div>
      <Dialog.Description className="text-[13px] leading-4 text-muted-foreground">
        On your other device, open the book and choose Aa → Continue on another device.
      </Dialog.Description>

      <div className="relative grid aspect-square place-items-center overflow-hidden rounded-xl bg-black">
        <video ref={video} muted playsInline className="absolute inset-0 size-full object-cover" />
        {camera.k === 'on' ? (
          // a frame to aim with
          <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
        ) : (
          <p className="relative px-6 text-center text-[13px] text-white/80">
            {camera.k === 'starting'
              ? 'Starting the camera…'
              : camera.k === 'denied'
                ? 'Camera access is off. Allow it in your browser or app settings, or paste the link below.'
                : 'No camera available here. Paste the link below instead.'}
          </p>
        )}
        {wrong && camera.k === 'on' && (
          <p className="absolute inset-x-3 bottom-3 rounded-full bg-black/70 px-3 py-1.5 text-center text-[13px] text-white">
            That QR code isn't a DoomReader sync code.
          </p>
        )}
      </div>

      <form onSubmit={submit} className="grid gap-1">
        <div className="flex gap-2">
          <Input
            value={pasted}
            onChange={e => {
              setPasted(e.target.value)
              setPasteError(false)
            }}
            placeholder="Or paste a sync link"
            aria-label="Sync link"
            aria-invalid={pasteError || undefined}
            className="rounded-full"
          />
          <Button type="submit" className="rounded-full font-bold" disabled={!pasted.trim()}>
            Open
          </Button>
        </div>
        {pasteError && <p className="px-3 text-[13px] text-destructive">That isn't a DoomReader sync link.</p>}
      </form>
    </>
  )
}
