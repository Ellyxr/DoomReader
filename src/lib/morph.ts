/**
 * Opening a book from its Home preview, in three moves: the other previews ease away (leaveHome), the card glides
 * into the same post inside the book (a View Transition), and the posts after it ease in below (arrive). The browser
 * holds the old screen while the book loads, so the transition waits for the reader to say its post is in place
 * (bookShown), or gives up waiting after a moment. Without View Transitions the book just opens, and its posts still
 * ease in; with reduced motion nothing moves.
 */

const NAME = 'opening-post'
/** The longest the screen is held while a big book loads; after this the morph is skipped. */
const WAIT_MS = 1200
export const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)' // quick start, soft landing

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

let waiting: { id: string; done: () => void } | null = null
let target: HTMLElement | null = null
/** The book being opened from Home, so its reader knows to bring its posts in. */
let arriving: string | null = null

/**
 * The other previews ease out, away from `card`: those above drift up, those below drift down, the nearest first.
 * Resolves once they are gone.
 */
export async function leaveHome(card: HTMLElement, cards: HTMLElement[]) {
  if (still()) return
  const at = cards.indexOf(card)
  const runs = cards.map((el, i) => {
    if (el === card) return null
    const away = i < at ? -1 : 1
    return el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${away * 18}px)` }], {
      duration: 240,
      delay: Math.min(3, Math.abs(i - at) - 1) * 45,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    }).finished
  })
  await Promise.all(runs).catch(() => {})
}

export function openWithMorph(card: HTMLElement, id: string, go: () => void) {
  arriving = id
  if (!document.startViewTransition || still()) return go()
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

/**
 * Called by the reader once the post it opened at is on screen. When it was opened from Home, the card lands on
 * `post` and the posts after it ease in below, one after another.
 */
export function bookShown(id: string, post: Element | null | undefined) {
  const fromHome = arriving === id
  arriving = null
  if (fromHome && post instanceof HTMLElement && !still()) {
    let next = post.nextElementSibling
    for (let k = 0; next instanceof HTMLElement && k < 6; k++, next = next.nextElementSibling)
      next.animate([{ opacity: 0, transform: 'translateY(36px)' }, { opacity: 1, transform: 'none' }], {
        duration: 520,
        // starts as the card settles, so the book grows out from under it
        delay: 240 + k * 70,
        easing: EASE,
        fill: 'backwards',
      })
  }
  if (waiting?.id !== id) return
  if (post instanceof HTMLElement) {
    target = post
    post.style.viewTransitionName = NAME
  }
  const { done } = waiting
  waiting = null
  done()
}
