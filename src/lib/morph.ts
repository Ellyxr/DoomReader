/**
 * Opening a book from its Home preview: the preview card grows into the same post inside the book (a View
 * Transition). The browser holds the old screen while the book loads, so the transition waits for the reader to say
 * its post is in place (bookShown), or gives up waiting after a moment. Browsers without View Transitions, and
 * reduced motion, just open the book.
 */

const NAME = 'opening-post'
/** The longest the screen is held while a big book loads; after this the morph is skipped. */
const WAIT_MS = 1200

let waiting: { id: string; done: () => void } | null = null
let target: HTMLElement | null = null

export function openWithMorph(card: HTMLElement, id: string, go: () => void) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return go()
  card.style.viewTransitionName = NAME
  const t = document.startViewTransition(
    () =>
      new Promise<void>(done => {
        waiting = { id, done }
        go()
        setTimeout(done, WAIT_MS)
      }),
  )
  void t.finished.finally(() => {
    waiting = null
    if (target) target.style.viewTransitionName = ''
    target = null
  })
}

/** Called by the reader once the post it opened at is on screen. */
export function bookShown(id: string, post: Element | null | undefined) {
  if (waiting?.id !== id) return
  if (post instanceof HTMLElement) {
    target = post
    post.style.viewTransitionName = NAME
  }
  const { done } = waiting
  waiting = null
  done()
}
