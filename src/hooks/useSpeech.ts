import { useCallback, useEffect, useRef, useState } from 'react'

import { speechChunks, type Post } from '@/lib/feed'

export const speechSupported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'

export const RATES = [0.8, 1, 1.25, 1.5, 2] as const
const RATE_KEY = 'doomreader:tts-rate'

function loadRate() {
  try {
    const r = Number(localStorage.getItem(RATE_KEY))
    return (RATES as readonly number[]).includes(r) ? r : 1
  } catch {
    return 1
  }
}

/**
 * Reads the feed aloud with the browser's own voices (Web Speech API), post by post, calling `onPost` as each
 * post starts so the reader can scroll along. Pausing cancels and remembers the paragraph, because
 * `speechSynthesis.pause()` is unreliable on Android; resuming starts that paragraph again.
 */
export function useSpeech(posts: Post[], onPost: (i: number) => void, onFail: () => void) {
  const [playing, setPlaying] = useState(false)
  const [post, setPost] = useState<number | null>(null)
  const [rate, setRateState] = useState(loadRate)

  const pos = useRef({ post: 0, chunk: 0 })
  const run = useRef(0) // bumped to orphan the callbacks of utterances that were cancelled
  const errors = useRef(0)
  const live = useRef({ posts, onPost, onFail, rate })
  useEffect(() => {
    live.current = { posts, onPost, onFail, rate }
  })

  const speak = useCallback(function speak() {
    const token = run.current
    const { posts } = live.current
    let chunks = posts[pos.current.post] ? speechChunks(posts[pos.current.post]) : []
    // move past finished and empty posts
    while (pos.current.chunk >= chunks.length) {
      pos.current = { post: pos.current.post + 1, chunk: 0 }
      if (pos.current.post >= posts.length) {
        setPlaying(false)
        setPost(null)
        return
      }
      chunks = speechChunks(posts[pos.current.post])
    }
    if (pos.current.chunk === 0) {
      setPost(pos.current.post)
      live.current.onPost(pos.current.post)
    }

    const u = new SpeechSynthesisUtterance(chunks[pos.current.chunk])
    u.rate = live.current.rate
    u.lang = document.documentElement.lang || 'en'
    u.onend = () => {
      if (token !== run.current) return
      errors.current = 0
      pos.current.chunk++
      speak()
    }
    u.onerror = e => {
      if (token !== run.current || e.error === 'interrupted' || e.error === 'canceled') return
      // give up after a few failures in a row rather than racing through the book
      if (++errors.current >= 3) {
        run.current++
        setPlaying(false)
        live.current.onFail()
        return
      }
      pos.current.chunk++
      speak()
    }
    if (speechSynthesis.paused) speechSynthesis.resume()
    speechSynthesis.speak(u)
  }, [])

  const halt = () => {
    run.current++
    speechSynthesis.cancel()
  }

  /** Starts reading at post `from`, or picks up where it paused when `from` is the paused post. */
  const play = useCallback(
    (from: number) => {
      if (!speechSupported) return
      halt()
      if (from !== pos.current.post || post === null) pos.current = { post: from, chunk: 0 }
      errors.current = 0
      setPlaying(true)
      setPost(pos.current.post)
      speak() // synchronously, so iOS sees it as part of the tap
    },
    [speak, post],
  )

  const pause = useCallback(() => {
    halt()
    setPlaying(false)
  }, [])

  const stop = useCallback(() => {
    halt()
    setPlaying(false)
    setPost(null)
  }, [])

  const setRate = useCallback(
    (r: number) => {
      setRateState(r)
      live.current.rate = r
      try {
        localStorage.setItem(RATE_KEY, String(r))
      } catch {
        /* the rate just isn't remembered */
      }
      if (playing) {
        halt()
        speak()
      }
    },
    [playing, speak],
  )

  // a new post length regroups the posts, so the remembered position no longer means anything
  useEffect(() => stop, [posts, stop])

  return { playing, post, rate, play, pause, stop, setRate }
}
