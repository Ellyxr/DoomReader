import { useState } from 'react'
import { Plus, ScanQrCode } from 'lucide-react'

import { useImporter } from '@/components/Importer'
import { ScanDialog } from '@/components/ScanDialog'
import { Shortcuts } from '@/components/Shortcuts'

const BOTTOM = 'calc(20px + env(safe-area-inset-bottom, 0px))'
const EDGE = 'calc(max(16px, (100vw - 600px) / 2 + 16px) + env(safe-area-inset-right, 0px))'

/**
 * Floating "add a book" button, pinned to the right edge of the 600px column, with a smaller "scan a sync code" one
 * beside it and link shortcuts on the left. `extras={false}` leaves only the + button, for when a player bar needs
 * the space.
 */
export function Fab({ extras = true }: { extras?: boolean }) {
  const { pick } = useImporter()
  const [scanning, setScanning] = useState(false)
  return (
    <>
      {extras && <Shortcuts />}
      {extras && (
        <button
          onClick={() => setScanning(true)}
          aria-label="Scan a sync code from another device"
          title="Scan a sync code"
          className="fixed z-25 grid size-12 place-items-center rounded-full border bg-background text-primary shadow-pop hover:bg-accent"
          // centred on the + button, just to its left
          style={{ bottom: `calc(${BOTTOM} + 4px)`, right: `calc(${EDGE} + 56px + 12px)` }}
        >
          <ScanQrCode className="size-[22px]" />
        </button>
      )}
      <button
        onClick={pick}
        aria-label="Add an EPUB or PDF"
        title="Add an EPUB or PDF"
        className="fixed z-25 grid size-14 place-items-center rounded-full bg-primary text-white shadow-[0_2px_14px_rgba(29,155,240,0.35)] hover:bg-[#1a8cd8]"
        style={{ bottom: BOTTOM, right: EDGE }}
      >
        <Plus className="size-[26px]" strokeWidth={2.2} />
      </button>
      <ScanDialog open={scanning} onClose={() => setScanning(false)} />
    </>
  )
}
