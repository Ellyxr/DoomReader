// Builds the offline dictionary in public/dict/ from WordNet 3.1 (the wordnet-db package).
// One JSON file per first letter, { word: [[pos, definition, example?], ...] }, most common senses first.
// Runs before `dev` and `build`; skips the work when the output is already there.
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const src = path.join(root, 'node_modules/wordnet-db/dict')
const VERSION = 'v1' // bump with src/lib/dictionary.ts when the format changes
const out = path.join(root, 'public/dict', VERSION)

if (existsSync(path.join(out, 'a.json')) && !process.argv.includes('--force')) process.exit(0)

const POS = { noun: 'n', verb: 'v', adj: 'adj', adv: 'adv' }
const SENSES_PER_POS = 3
const MAX_SENSES = 5

// how often each sense was seen in the tagged corpora, to put a word's common part of speech first
const SS_TYPE = { 1: 'n', 2: 'v', 3: 'adj', 4: 'adv', 5: 'adj' }
const tagged = new Map()
for (const line of readFileSync(path.join(src, 'index.sense'), 'latin1').split('\n')) {
  const [key, offset, , count] = line.split(' ')
  if (!count) continue
  const [lemma, rest] = key.split('%')
  const k = `${lemma}|${SS_TYPE[rest[0]]}|${offset}`
  tagged.set(k, (tagged.get(k) ?? 0) + Number(count))
}

/** word → one group per part of speech: its senses, plus how common that part of speech is for the word */
const groups = new Map()

for (const [file, pos] of Object.entries(POS)) {
  const data = readFileSync(path.join(src, `data.${file}`), 'latin1')
  const glossAt = new Map()
  for (const line of data.split('\n')) {
    if (!line || line.startsWith('  ')) continue // license header
    const bar = line.indexOf(' | ')
    if (bar < 0) continue
    const gloss = line.slice(bar + 3).trim()
    // "definition; definition; \"example\"; \"example\""
    const q = gloss.indexOf('"')
    const def = (q < 0 ? gloss : gloss.slice(0, q)).replace(/[;\s]+$/, '').trim()
    const ex = q < 0 ? '' : (gloss.slice(q).match(/"([^"]+)"/)?.[1] ?? '')
    glossAt.set(line.slice(0, 8), ex ? [pos, def, ex] : [pos, def])
  }

  const index = readFileSync(path.join(src, `index.${file}`), 'latin1')
  for (const line of index.split('\n')) {
    if (!line || line.startsWith('  ')) continue
    const f = line.trim().split(' ')
    const word = f[0]
    if (word.includes('_') || !/^[a-z][a-z'.-]*$/.test(word)) continue // only what can be held as one word
    const ptrs = Number(f[3])
    const offsets = f.slice(4 + ptrs + 2)
    const senses = offsets
      .slice(0, SENSES_PER_POS)
      .map(o => glossAt.get(o))
      .filter(Boolean)
    if (!senses.length) continue
    const tags = offsets.reduce((n, o) => n + (tagged.get(`${word}|${pos}|${o}`) ?? 0), 0)
    if (!groups.has(word)) groups.set(word, [])
    groups.get(word).push({ senses, tags, count: offsets.length })
  }
}

const dict = new Map()
for (const [word, gs] of groups) {
  gs.sort((a, b) => b.tags - a.tags || b.count - a.count)
  dict.set(word, gs.flatMap(g => g.senses).slice(0, MAX_SENSES))
}

mkdirSync(out, { recursive: true })
const shards = new Map()
for (const [word, senses] of [...dict].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const k = word[0]
  if (!shards.has(k)) shards.set(k, {})
  shards.get(k)[word] = senses
}
let total = 0
for (const [k, words] of shards) {
  const json = JSON.stringify(words)
  total += json.length
  writeFileSync(path.join(out, `${k}.json`), json)
}
copyFileSync(path.join(root, 'node_modules/wordnet-db/LICENSE'), path.join(out, 'LICENSE.txt'))
console.log(`dictionary: ${dict.size} words, ${(total / 1e6).toFixed(1)} MB in ${shards.size} files`)
