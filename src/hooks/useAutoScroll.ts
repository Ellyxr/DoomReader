import { useEffect, useRef } from 'react'

/** Off, the next post every 1, 3 or 6 seconds, or a steady glide. Strings so they can be toggle-group values. */
export type AutoScroll = 'off' | '1' | '3' | '6' | 'flow'

/** How fast the glide moves, in CSS pixels per second. */
const FLOW_SPEED = 40
/** How long touching, wheeling or pressing a key holds the scrolling back. */
const HOLD_MS = 2500

interface Callbacks {
  /** Moves on one post. */
  step: () => void
  /** Whether there is nothing left to scroll to. */
  ended: () => boolean
  onEnd: () => void
}

/**
 * Scrolls the feed by itself while `active`: `step()` every few seconds, or a steady glide, until `ended()`.
 * Whatever the reader does by hand (touch, wheel, keys) pauses it for a moment, and a finger resting on the screen
 * holds it until lifted.
 */
export function useAutoScroll(mode: AutoScroll, active: boolean, callbacks: Callbacks) {
  const cb = useRef(callbacks)
  useEffect(() => {
    cb.current = callbacks
  })

  useEffect(() => {
    if (mode === 'off' || !active) return
    let heldUntil = 0
    let touching = false
    const hold = () => {
      heldUntil = performance.now() + HOLD_MS
    }
    const touchStart = () => {
      touching = true
      hold()
    }
    const touchEnd = () => {
      touching = false
      hold()
    }
    const held = () => touching || performance.now() < heldUntil || document.hidden

    const events: [string, () => void][] = [
      ['wheel', hold],
      ['keydown', hold],
      ['mousedown', hold],
      ['touchstart', touchStart],
      ['touchend', touchEnd],
      ['touchcancel', touchEnd],
    ]
    for (const [e, fn] of events) addEventListener(e, fn, { passive: true })
    const unlisten = () => events.forEach(([e, fn]) => removeEventListener(e, fn))

    if (mode === 'flow') {
      let raf = 0
      let last = performance.now()
      let carry = 0 // browsers round scrollBy to whole pixels, so keep the fraction for the next frame
      const frame = (now: number) => {
        if (cb.current.ended()) return cb.current.onEnd()
        const dt = Math.min(now - last, 100)
        last = now
        if (!held()) {
          carry += (FLOW_SPEED * dt) / 1000
          const px = Math.floor(carry)
          if (px) {
            carry -= px
            scrollBy(0, px)
          }
        }
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
      return () => {
        cancelAnimationFrame(raf)
        unlisten()
      }
    }

    const every = Number(mode) * 1000
    let timer = 0
    const tick = () => {
      if (cb.current.ended()) return cb.current.onEnd()
      // after a pause, give a full interval to read before moving on
      if (held()) timer = window.setTimeout(tick, Math.max(0, heldUntil - performance.now()) + every)
      else {
        cb.current.step()
        timer = window.setTimeout(tick, every)
      }
    }
    timer = window.setTimeout(tick, every)
    return () => {
      clearTimeout(timer)
      unlisten()
    }
  }, [mode, active])
}
