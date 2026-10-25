import { Plus } from 'lucide-react'

import { useImporter } from '@/components/Importer'

/** Floating "add a book" button, pinned to the right edge of the 600px column. */
export function Fab() {
  const { pick } = useImporter()
  return (
    <button
      onClick={pick}
      aria-label="Add an EPUB or PDF"
      title="Add an EPUB or PDF"
      className="fixed z-25 grid size-14 place-items-center rounded-full bg-primary text-white shadow-[0_2px_14px_rgba(29,155,240,0.35)] hover:bg-[#1a8cd8]"
      style={{
        bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
        right: 'calc(max(16px, (100vw - 600px) / 2 + 16px) + env(safe-area-inset-right, 0px))',
      }}
    >
      <Plus className="size-[26px]" strokeWidth={2.2} />
    </button>
  )
}
