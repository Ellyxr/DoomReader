import { useSyncExternalStore } from 'react'

/**
 * An English dictionary that works offline, built from WordNet by scripts/build-dict.mjs. It is served from this site
 * as one JSON file per first letter (about 3.4 MB compressed in all) and kept in the Cache API once downloaded, so
 * looking a word up never sends it anywhere.
 */
export type Pos = 'n' | 'v' | 'adj' | 'adv'
/** Part of speech, definition, and an example sentence when WordNet has one. */
export type Sense = [Pos, string, string?]
export interface Entry {
  word: string
  senses: Sense[]
}

const VERSION = 'v1' // must match scripts/build-dict.mjs
const BASE = `${import.meta.env.BASE_URL}dict/${VERSION}/`
const CACHE = `doomreader-dict-${VERSION}`
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

/* ---------- download state, for the settings switch ---------- */

export type DictStatus = { state: 'idle' } | { state: 'loading'; done: number } | { state: 'ready' } | { state: 'error' }

let status: DictStatus = { state: 'idle' }
const listeners = new Set<() => void>()
const setStatus = (s: DictStatus) => {
  status = s
  listeners.forEach(l => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const useDictStatus = () => useSyncExternalStore(subscribe, () => status)

const openCache = async () => {
  try {
    return (await globalThis.caches?.open(CACHE)) ?? null
  } catch {
    return null // not a secure context, or storage is blocked
  }
}

async function fetchShard(letter: string, cache: Cache | null) {
  const url = BASE + letter + '.json'
  const hit = await cache?.match(url)
  if (hit) return hit
  const res = await fetch(url)
  if (!res.ok) throw new Error(`dictionary ${letter}: ${res.status}`)
  await cache?.put(url, res.clone()).catch(() => {})
  return res
}

let downloading: Promise<void> | null = null

/** Downloads every letter that isn't stored yet, so lookups work offline. Safe to call again; it only fetches what's missing. */
export function downloadDictionary() {
  if (status.state === 'ready') return Promise.resolve()
  downloading ??= (async () => {
    const cache = await openCache()
    // drop dictionaries from earlier versions
    try {
      for (const k of (await globalThis.caches?.keys()) ?? [])
        if (k.startsWith('doomreader-dict-') && k !== CACHE) await caches.delete(k)
    } catch {
      /* nothing to clean */
    }
    let done = 0
    setStatus({ state: 'loading', done: 0 })
    try {
      // a few at a time, so a slow connection still shows progress
      const queue = [...LETTERS]
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          for (let l = queue.shift(); l; l = queue.shift()) {
            const res = await fetchShard(l, cache)
            if (!cache) await res.arrayBuffer() // without the Cache API, the browser's HTTP cache keeps it
            setStatus({ state: 'loading', done: Math.round((++done / LETTERS.length) * 100) })
          }
        }),
      )
      setStatus({ state: 'ready' })
    } catch {
      setStatus({ state: 'error' })
    } finally {
      downloading = null
    }
  })()
  return downloading
}

/* ---------- lookup ---------- */

type Shard = Record<string, Sense[]>
const shards = new Map<string, Promise<Shard>>()
const KEEP = 6 // letters held in memory

function shard(letter: string) {
  let p = shards.get(letter)
  if (p) {
    // most recently used last
    shards.delete(letter)
    shards.set(letter, p)
    return p
  }
  p = openCache()
    .then(cache => fetchShard(letter, cache))
    .then(res => res.json() as Promise<Shard>)
  p.catch(() => shards.delete(letter))
  shards.set(letter, p)
  if (shards.size > KEEP) shards.delete(shards.keys().next().value!)
  return p
}

async function find(word: string) {
  const letter = word[0]
  if (!letter || !LETTERS.includes(letter)) return undefined
  return (await shard(letter))[word]
}

// common irregular forms WordNet's data files leave out
const IRREGULAR: Record<string, string> = Object.fromEntries(
  `arose:arise arisen:arise awoke:awake awoken:awake was:be were:be been:be am:be is:be are:be bore:bear borne:bear
  beat:beat beaten:beat became:become began:begin begun:begin bent:bend bet:bet bit:bite bitten:bite bled:bleed
  blew:blow blown:blow broke:break broken:break bred:breed brought:bring built:build burnt:burn bought:buy caught:catch
  chose:choose chosen:choose clung:cling came:come crept:creep dealt:deal dug:dig did:do done:do does:do drew:draw
  drawn:draw dreamt:dream drank:drink drunk:drink drove:drive driven:drive dwelt:dwell ate:eat eaten:eat fell:fall
  fallen:fall fed:feed felt:feel fought:fight found:find fled:flee flung:fling flew:fly flown:fly forbade:forbid
  forbidden:forbid forgot:forget forgotten:forget forgave:forgive forgiven:forgive froze:freeze frozen:freeze got:get
  gotten:get gave:give given:give went:go gone:go goes:go ground:grind grew:grow grown:grow hung:hang had:have has:have
  heard:hear hid:hide hidden:hide held:hold kept:keep knelt:kneel knew:know known:know laid:lay led:lead leapt:leap
  learnt:learn left:leave lent:lend lay:lie lain:lie lit:light lost:lose made:make meant:mean met:meet paid:pay
  rode:ride ridden:ride rang:ring rung:ring rose:rise risen:rise ran:run said:say saw:see seen:see sought:seek
  sold:sell sent:send shook:shake shaken:shake shone:shine shot:shoot showed:show shown:show shrank:shrink shut:shut
  sang:sing sung:sing sank:sink sunk:sink sat:sit slept:sleep slid:slide slung:sling smelt:smell spoke:speak
  spoken:speak sped:speed spent:spend spun:spin spat:spit split:split spread:spread sprang:spring sprung:spring
  stood:stand stole:steal stolen:steal stuck:stick stung:sting stank:stink strode:stride struck:strike strove:strive
  swore:swear sworn:swear swept:sweep swam:swim swum:swim swung:swing took:take taken:take taught:teach tore:tear
  torn:tear told:tell thought:think threw:throw thrown:throw trod:tread understood:understand woke:wake woken:wake
  wore:wear worn:wear wove:weave woven:weave wept:weep won:win wound:wind withdrew:withdraw wrung:wring wrote:write
  written:write men:man women:woman children:child feet:foot teeth:tooth geese:goose mice:mouse oxen:ox people:person
  lice:louse dice:die better:good best:good worse:bad worst:bad further:far furthest:far farther:far farthest:far
  less:little least:little more:much most:much elder:old eldest:old thee:you thou:you thy:your thine:your hath:have
  doth:do art:be wast:be wert:be shalt:shall wilt:will canst:can couldst:could didst:do hast:have`
    .trim()
    .split(/\s+/)
    .map(p => p.split(':')),
)

// WordNet's "morphy" suffix rules: ending → replacement
const RULES: [string, string][] = [
  ['ies', 'y'], ['ves', 'f'], ['ves', 'fe'], ['ses', 's'], ['xes', 'x'], ['zes', 'z'], ['ches', 'ch'], ['shes', 'sh'],
  ['men', 'man'], ['es', 'e'], ['es', ''], ['s', ''], ['ied', 'y'], ['ed', 'e'], ['ed', ''], ['ing', 'e'], ['ing', ''],
  ['ier', 'y'], ['iest', 'y'], ['er', 'e'], ['er', ''], ['est', 'e'], ['est', ''], ['ly', ''], ['ily', 'y'],
]

/** Base forms a word might be an inflection of, most likely first. */
function candidates(word: string) {
  const out: string[] = []
  const add = (w: string) => w.length > 1 && !out.includes(w) && out.push(w)
  if (IRREGULAR[word]) add(IRREGULAR[word])
  add(word)
  for (const [end, rep] of RULES) {
    if (!word.endsWith(end) || word.length - end.length < 2) continue
    const stem = word.slice(0, -end.length)
    add(stem + rep)
    // running → run, stopped → stop, bigger → big
    if (!rep && /([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1))
  }
  return out
}

/**
 * The entries for a word as it appears in a book ("ran", "Children's", "well-known"), base forms first. Up to two, so
 * a word like "saw" shows both "see" and the tool. Rejects when the dictionary can't be reached.
 */
export async function lookup(raw: string): Promise<Entry[]> {
  const word = raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/'s$/, '')
    .replace(/^['-]+|['-]+$/g, '')
  const tries = [word, ...(word.includes('-') ? word.split('-') : [])]
  const out: Entry[] = []
  for (const t of tries) {
    for (const c of candidates(t)) {
      if (out.some(e => e.word === c)) continue
      const senses = await find(c)
      if (senses) out.push({ word: c, senses })
      if (out.length === 2) return out
    }
    if (out.length) return out
  }
  return out
}

/** The word at character `i` of `text`, as [start, end), or null when `i` is on a space or punctuation. */
export function wordAt(text: string, i: number): [number, number] | null {
  const isWord = (k: number) => /[\p{L}\p{M}'’-]/u.test(text[k] ?? '')
  if (!/[\p{L}\p{M}]/u.test(text[i] ?? '')) {
    // the nearest character was punctuation right beside a word
    if (/[\p{L}\p{M}]/u.test(text[i - 1] ?? '')) i--
    else if (/[\p{L}\p{M}]/u.test(text[i + 1] ?? '')) i++
    else return null
  }
  let a = i
  let b = i + 1
  while (a > 0 && isWord(a - 1)) a--
  while (b < text.length && isWord(b)) b++
  // quotes and dashes around the word aren't part of it
  while (a < b && /['’-]/.test(text[a])) a++
  while (b > a && /['’-]/.test(text[b - 1])) b--
  return a < b ? [a, b] : null
}
