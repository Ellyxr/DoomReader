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

/* ---------- timing words by estimate ---------- */

/**
 * Seconds one unit of speech (about a syllable) takes at 1×. Starts at a typical voice's pace and is learned from how
 * long sentences really take with this device's voice, so the estimate settles on its speed after a few sentences.
 */
const PACE_KEY = 'doomreader:tts-pace'
const PACE = { start: 0.19, min: 0.08, max: 0.45 }
/** Seconds between the voice starting and the first word being heard. */
const LEAD = 0.1
/** Word reports closer together than this (ms) weren't sent as the words were spoken, so they can't be trusted. */
const BURST_MS = 40

function loadPace() {
  try {
    const v = Number(localStorage.getItem(PACE_KEY))
    return v >= PACE.min && v <= PACE.max ? v : PACE.start
  } catch {
    return PACE.start
  }
}
let pace = loadPace()

function learnPace(seconds: number, units: number) {
  const sample = Math.min(PACE.max, Math.max(PACE.min, seconds / units))
  pace = pace * 0.7 + sample * 0.3
  try {
    localStorage.setItem(PACE_KEY, pace.toFixed(4))
  } catch {
    /* learned again next time */
  }
}

/** Some voices report every word at once rather than as it's spoken; once seen, their reports are ignored. */
let burstyVoice = false

/**
 * Each word's start in `text` and when it is reached, in units from the start of the sentence: about one unit per
 * syllable (vowel groups, or one per three letters for scripts without them), plus a pause after punctuation.
 */
function wordTimes(text: string) {
  const words = [...text.matchAll(/\S+/g)]
  let t = 0
  const at: number[] = []
  const when: number[] = []
  words.forEach((m, i) => {
    at.push(m.index)
    when.push(t)
    const w = m[0]
    const core = w.replace(/[^\p{L}\p{N}]/gu, '')
    t += Math.max(1, core.match(/[aeiouyàáâäèéêëìíîïòóôöùúûü]+/gi)?.length || Math.ceil(core.length / 3))
    t += /\d/.test(core) ? core.replace(/\D/g, '').length * 0.6 : 0
    if (i < words.length - 1) {
      if (/[.!?…]["”’)\]]*$/.test(w)) t += 2.2
      else if (/[,;:)\]]["”’]*$|[—–-]$/.test(w) || /^[—–(]/.test(words[i + 1][0])) t += 1.2
    }
  })
  return { at, when, total: t }
}

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
    // Word timing runs on a clock: each word is shown when the voice should reach it, from its syllables, the pauses
    // before it and the pace learned for this voice. The voice's own word reports (most desktop voices, Safari) set
    // the clock right as they come; voices that send none, or only some, are carried along by the estimate.
    const { at, when, total } = wordTimes(text)
    const secs = (units: number) => (LEAD + (units * pace) / u.rate) * 1000
    let t0 = 0 // when the clock says the sentence started (performance.now())
    let started = 0 // when the voice really started, for learning its pace
    let lastReport = -Infinity
    const show = (k: number) => {
      clearTimeout(guess.current)
      if (token !== run.current || k >= at.length) return
      setSpoken(key, at[k])
      if (k + 1 < at.length)
        guess.current = window.setTimeout(() => show(k + 1), Math.max(0, t0 + secs(when[k + 1]) - performance.now()))
    }
    u.onstart = () => {
      if (token !== run.current) return
      started = t0 = performance.now()
      guess.current = window.setTimeout(() => show(0), secs(0))
    }
    u.onboundary = e => {
      if (token !== run.current || e.name !== 'word' || burstyVoice) return
      const now = performance.now()
      if (now - lastReport < BURST_MS) {
        // reports arriving all at once say nothing about timing: back to the clock, where it would have been
        burstyVoice = true
        let k = 0
        while (k + 1 < at.length && t0 + secs(when[k + 1]) <= now) k++
        return show(k)
      }
      lastReport = now
      let k = 0
      while (k + 1 < at.length && at[k + 1] <= e.charIndex) k++
      // the voice is at word k now: move the clock so the words after it follow from here
      t0 = now - secs(when[k])
      show(k)
    }
    u.onend = () => {
      clearTimeout(guess.current)
      if (token !== run.current) return
      // learn this voice's pace from sentences long enough to say something about it
      const heard = (performance.now() - started) / 1000 - LEAD
      if (started && at.length >= 4 && heard > 0.5) learnPace(heard * u.rate, total)
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
