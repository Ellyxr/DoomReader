import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'

const EDGE = 72 // px from the top or bottom where dragging scrolls the page

const vibrate = (ms: number) => {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* not on this device */
  }
}

interface Drag {
  from: number
  to: number
  dy: number
  /** Height of the item being dragged, which the items it passes move by. */
  h: number
}

/**
 * Reordering a list by dragging a handle. The handle doesn't scroll the page (touch-action: none), so a finger can
 * grab it straight away while the rest of each item scrolls as usual; holding near the top or bottom edge scrolls the
 * list along. Arrow keys on a focused handle move its item one place.
 *
 * `listRef` goes on the element whose children are the items.
 */
export function useReorder<T extends HTMLElement>(onMove: (from: number, to: number) => void) {
  const listRef = useRef<T>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const live = useRef(onMove)
  useEffect(() => {
    live.current = onMove
  })
  const stop = useRef(() => {})
  useEffect(() => () => stop.current(), [])

  const start = (i: number, e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !listRef.current) return
    e.preventDefault()
    stop.current()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    // page positions, so they hold while the page scrolls
    const boxes = Array.from(listRef.current.children, el => {
      const r = el.getBoundingClientRect()
      return { mid: r.top + scrollY + r.height / 2, h: r.height }
    })
    const startY = e.clientY + scrollY
    let y = e.clientY
    let to = i
    let frame = 0

    const update = () => {
      const dy = y + scrollY - startY
      const mid = boxes[i].mid + dy
      const t = boxes.filter((b, k) => k !== i && b.mid < mid).length
      if (t !== to) vibrate(6)
      to = t
      setDrag({ from: i, to, dy, h: boxes[i].h })
    }
    const edgeScroll = () => {
      frame = 0
      const top = (document.querySelector('header')?.getBoundingClientRect().bottom ?? 0) + EDGE / 2
      const dy = y < top ? -(top - y) / 4 : y > innerHeight - EDGE ? (y - innerHeight + EDGE) / 4 : 0
      if (!dy) return
      scrollBy(0, Math.max(-24, Math.min(24, dy)))
      update()
      frame = requestAnimationFrame(edgeScroll)
    }
    const onMove = (ev: globalThis.PointerEvent) => {
      y = ev.clientY
      update()
      if (!frame) frame = requestAnimationFrame(edgeScroll)
    }
    const onEnd = (ev: globalThis.PointerEvent) => {
      stop.current()
      if (ev.type === 'pointerup' && to !== i) live.current(i, to)
    }
    const root = document.documentElement
    stop.current = () => {
      cancelAnimationFrame(frame)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onEnd)
      handle.removeEventListener('pointercancel', onEnd)
      root.style.userSelect = ''
      setDrag(null)
      stop.current = () => {}
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onEnd)
    handle.addEventListener('pointercancel', onEnd)
    root.style.userSelect = 'none'
    vibrate(10)
    setDrag({ from: i, to: i, dy: 0, h: boxes[i].h })
  }

  const handle = (i: number, count: number) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => start(i, e),
    onKeyDown: (e: KeyboardEvent) => {
      const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1
      if (to < 0 || to >= count) return
      e.preventDefault()
      live.current(i, to)
    },
    style: { touchAction: 'none' } as CSSProperties,
  })

  /** Where each item is drawn while one is dragged: the dragged one under the finger, the ones it passed out of its way. */
  const style = (i: number): CSSProperties | undefined => {
    if (!drag) return undefined
    const { from, to, dy, h } = drag
    if (i === from) return { transform: `translateY(${dy}px)`, position: 'relative', zIndex: 10 }
    const shift = from < to && i > from && i <= to ? -h : to < from && i >= to && i < from ? h : 0
    return { transform: shift ? `translateY(${shift}px)` : undefined, transition: 'transform 150ms ease' }
  }

  return { listRef, handle, style, dragging: drag?.from ?? null }
}
