import { Plus } from 'lucide-react'

import { useImporter } from '@/components/Importer'

const BOTTOM = 'calc(20px + env(safe-area-inset-bottom, 0px))'
const EDGE = 'calc(max(16px, (100vw - 600px) / 2 + 16px) + env(safe-area-inset-right, 0px))'

/**
 * Floating "add a book" button, pinned to the right edge of the 600px column. Scanning a sync code and adding link
 * shortcuts live in the Aa menu on Home and Library; the shortcuts themselves float on the left there (Shortcuts).
 */
export function Fab() {
  const { pick } = useImporter()
  return (
    <button
      onClick={pick}
      aria-label="Add an EPUB or PDF"
      title="Add an EPUB or PDF"
      className="fixed z-25 grid size-14 place-items-center rounded-full bg-primary text-white shadow-[0_2px_14px_rgba(29,155,240,0.35)] hover:bg-[#1a8cd8]"
      style={{ bottom: BOTTOM, right: EDGE }}
    >
      <Plus className="size-[26px]" strokeWidth={2.2} />
    </button>
  )
}
