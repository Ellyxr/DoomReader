import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

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

/* ---------- the word being spoken ---------- */

/**
 * Where in the current sentence the voice is: the start of the word being spoken, as a character offset. Kept outside
 * React state so only the screen that shows words re-renders for each one, not the whole reader.
 */
let spoken = { key: '', at: -1 }
const wordListeners = new Set<() => void>()
const setSpoken = (key: string, at: number) => {
  if (spoken.key === key && spoken.at === at) return
  spoken = { key, at }
  wordListeners.forEach(l => l())
}
const subscribeWord = (l: () => void) => {
  wordListeners.add(l)
  return () => wordListeners.delete(l)
}
/** `{ key: "<post>:<chunk>", at }`, the start of the word being spoken in that sentence (-1 before the first). */
export const useSpokenWord = () => useSyncExternalStore(subscribeWord, () => spoken)

/** Characters a voice speaks per second at 1×, for timing words when the browser doesn't report them. */
const CHARS_PER_SEC = 14

/** Word starts in `text`, for stepping through it by estimate. */
const wordStarts = (text: string) => [...text.matchAll(/\S+/g)].map(m => m.index)

/**
 * Reads the feed aloud with the browser's own voices (Web Speech API), a sentence at a time, calling `onPost` as each
 * post starts so the reader can scroll along. Pausing cancels and remembers the sentence, because
 * `speechSynthesis.pause()` is unreliable on Android; resuming starts that sentence again.
 */
export function useSpeech(posts: Post[], onPost: (i: number) => void, onFail: () => void) {
  const [playing, setPlaying] = useState(false)
  const [post, setPost] = useState<number | null>(null)
  /** The sentence being read, as an index into `speechChunks(posts[post])`. */
  const [chunk, setChunk] = useState(0)
  const [rate, setRateState] = useState(loadRate)

  const pos = useRef({ post: 0, chunk: 0 })
  const run = useRef(0) // bumped to orphan the callbacks of utterances that were cancelled
  const errors = useRef(0)
  const guess = useRef(0) // the timer stepping through words by estimate
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
    if (pos.current.chunk === 0) live.current.onPost(pos.current.post)
    setPost(pos.current.post)
    setChunk(pos.current.chunk)

    const text = chunks[pos.current.chunk]
    const key = `${pos.current.post}:${pos.current.chunk}`
    const u = new SpeechSynthesisUtterance(text)
    u.rate = live.current.rate
    u.lang = document.documentElement.lang || 'en'
    setSpoken(key, -1)
    // Word timing: the voice's own word events where the browser sends them (most desktop voices, Safari); otherwise,
    // as with many Android voices, an estimate from each word's length and the speed, which those events replace if
    // they turn up after all.
    let reported = false
    const starts = wordStarts(text)
    const estimate = (k: number) => {
      if (reported || token !== run.current || k >= starts.length) return
      setSpoken(key, starts[k])
      const len = (starts[k + 1] ?? text.length) - starts[k]
      guess.current = window.setTimeout(() => estimate(k + 1), (len / (CHARS_PER_SEC * u.rate)) * 1000)
    }
    u.onstart = () => {
      if (token !== run.current) return
      clearTimeout(guess.current)
      guess.current = window.setTimeout(() => estimate(0), 250)
    }
    u.onboundary = e => {
      if (token !== run.current || e.name !== 'word') return
      reported = true
      clearTimeout(guess.current)
      setSpoken(key, e.charIndex)
    }
    u.onend = () => {
      clearTimeout(guess.current)
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
    clearTimeout(guess.current)
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

  /** Moves `by` sentences back or forward, across posts; keeps reading if it was. */
  const skip = useCallback(
    (by: number) => {
      const { posts } = live.current
      let { post: p, chunk: c } = pos.current
      c += by
      while (c < 0 && p > 0) c += speechChunks(posts[--p]).length
      while (p < posts.length && c >= speechChunks(posts[p]).length) c -= speechChunks(posts[p++]).length
      if (p >= posts.length || c < 0) return
      halt()
      pos.current = { post: p, chunk: c }
      if (p !== post) live.current.onPost(p)
      setPost(p)
      setChunk(c)
      if (playing) speak()
    },
    [playing, post, speak],
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

  return { playing, post, chunk, rate, play, pause, stop, skip, setRate }
}
