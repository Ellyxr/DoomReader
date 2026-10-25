import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'

import { requestPersistence } from '@/lib/db'
import { ACCEPT, importFile } from '@/lib/library'

interface LaunchParams {
  files: { getFile(): Promise<File> }[]
}
declare global {
  interface Window {
    launchQueue?: { setConsumer(fn: (p: LaunchParams) => void): void }
  }
}

const ImporterContext = createContext<{ pick: () => void }>({ pick: () => {} })
export const useImporter = () => useContext(ImporterContext)

/**
 * Owns every way a book gets in: the file picker, dropping files anywhere on the page, and the OS
 * "Open with" menu once the app is installed (via the manifest's file_handlers). One file opens
 * straight into the reader; several are added to the library.
 */
export function Importer({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const run = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      let opened: string | null = null
      for (const file of files) {
        const t = toast.loading(`Reading ${file.name}…`)
        try {
          const r = await importFile(file, (a, b) => toast.loading(`Reading ${file.name} (${a} of ${b})…`, { id: t }))
          toast.success(r.duplicate ? 'Already in your library' : `${r.title} is ready`, {
            id: t,
            description: r.duplicate ? file.name : undefined,
          })
          opened = r.id
        } catch (e) {
          console.error(e)
          toast.error(e instanceof Error ? e.message : 'Could not open that file.', { id: t, description: file.name })
        }
      }
      void requestPersistence()
      if (files.length === 1 && opened) navigate(`/read/${opened}`)
    },
    [navigate],
  )

  useEffect(() => {
    window.launchQueue?.setConsumer(async ({ files }) => {
      if (files?.length) void run(await Promise.all(files.map(f => f.getFile())))
    })
  }, [run])

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    let depth = 0
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      void run(Array.from(e.dataTransfer!.files))
    }
    addEventListener('dragenter', enter)
    addEventListener('dragover', over)
    addEventListener('dragleave', leave)
    addEventListener('drop', drop)
    return () => {
      removeEventListener('dragenter', enter)
      removeEventListener('dragover', over)
      removeEventListener('dragleave', leave)
      removeEventListener('drop', drop)
    }
  }, [run])

  const pick = useCallback(() => input.current?.click(), [])

  return (
    <ImporterContext.Provider value={{ pick }}>
      {children}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={e => {
          void run(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/85 p-6">
          <div className="max-w-full rounded-3xl border-2 border-dashed border-primary px-8 py-12 text-center text-[22px] font-extrabold">
            Drop an EPUB or PDF to start reading
          </div>
        </div>
      )}
    </ImporterContext.Provider>
  )
}
