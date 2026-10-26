import { useEffect, useMemo, useState } from 'react'
import { Highlighter, Volume2 } from 'lucide-react'

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import type { HeldWord } from '@/hooks/useSentenceSelect'
import { lookup, type Entry, type Pos } from '@/lib/dictionary'

const POS: Record<Pos, string> = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' }
const SHOWN = 3 // senses before "More meanings"

const headerBottom = () => document.querySelector('header')?.getBoundingClientRect().bottom ?? 0

type Result ={ key: string } & ({ entries: Entry[] } | { error: true })

/**
 * What a held word means, in a small card above it. The word itself is drawn as a selection mark in its post, which
 * the card points at; it closes on Escape or a touch anywhere else.
 */
export function WordTip({
  word,
  speak,
  onClose,
  onQuote,
}: {
  word: HeldWord | null
  /** Offer to say the word aloud (not while a post is being read). */
  speak: boolean
  onClose: () => void
  onQuote: () => void
}) {
  const text = word?.word
  const key = word ? `${word.post}:${word.a}:${word.word}` : ''
  const [result, setResult] = useState<Result | null>(null)
  // the word whose card shows every meaning
  const [moreKey, setMoreKey] = useState('')
  const more = moreKey === key

  useEffect(() => {
    if (!text) return
    let live = true
    lookup(text).then(
      entries => live && setResult({ key, entries }),
      () => live && setResult({ key, error: true }),
    )
    return () => {
      live = false
    }
  }, [key, text])

  // read from the page each time, since the post's HTML is redrawn whenever its marks change
  const anchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () =>
          document
            .querySelector(`main article[data-i="${word?.post}"] .post-text mark.sel`)
            ?.getBoundingClientRect() ?? new DOMRect(),
      },
    }),
    [word?.post],
  )

  const res = result?.key === key ? result : null
  const entries = res && 'entries' in res ? res.entries : []
  const total = entries.reduce((n, e) => n + e.senses.length, 0)
  // the first few senses across the entries, unless all are asked for
  const shown: Entry[] = []
  let left = more ? Infinity : SHOWN
  for (const e of entries) {
    if (left <= 0) break
    shown.push({ word: e.word, senses: e.senses.slice(0, left) })
    left -= e.senses.length
  }

  const say = (text: string) => {
    speechSynthesis.cancel()
    speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  }

  return (
    <Popover open={!!word} onOpenChange={open => !open && onClose()}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="top"
        sideOffset={8}
        // stay clear of the sticky header (taller with its tabs than without)
        collisionPadding={{ top: headerBottom() + 8, bottom: 12, left: 12, right: 12 }}
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
        aria-label={word ? `Meaning of ${word.word}` : undefined}
        className="max-h-[min(360px,50dvh)] w-[min(340px,calc(100vw-24px))] overflow-y-auto overscroll-contain rounded-2xl p-0 shadow-pop"
      >
        <div className="px-4 pt-3 pb-2">
          {!res && <p className="py-1 text-[15px] text-muted-foreground">Looking up “{word?.word}”…</p>}

          {res && 'error' in res && (
            <>
              <b className="text-[17px]">{word?.word}</b>
              <p className="mt-1 text-[15px] leading-snug text-muted-foreground">
                The dictionary hasn’t been downloaded yet. Connect to the internet once and it will work offline from then on.
              </p>
            </>
          )}

          {res && 'entries' in res && !entries.length && (
            <>
              <b className="text-[17px]">{word?.word}</b>
              <p className="mt-1 text-[15px] leading-snug text-muted-foreground">No meaning found for this word.</p>
            </>
          )}

          {shown.map(({ word: base, senses }) => {
            const inflected = word && base !== word.word.toLowerCase().replace(/’/g, "'")
            return (
              <section key={base} className="mb-1.5">
                <div className="flex items-center gap-1">
                  <b className="text-[17px] leading-7">{base}</b>
                  {inflected && <span className="text-[13px] text-muted-foreground">from “{word.word}”</span>}
                  {speak && (
                    <button
                      onClick={() => say(base)}
                      className="-my-1 grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Say “${base}”`}
                    >
                      <Volume2 className="size-4" />
                    </button>
                  )}
                </div>
                <ol className="grid gap-1.5">
                  {senses.map(([pos, def, ex], i) => (
                    <li key={i} className="text-[15px] leading-snug">
                      <i className="mr-1 text-[13px] text-muted-foreground">{POS[pos]}</i>
                      {def}
                      {ex && <span className="mt-0.5 block text-[14px] text-muted-foreground">“{ex}”</span>}
                    </li>
                  ))}
                </ol>
              </section>
            )
          })}
        </div>

        <div className="sticky bottom-0 flex items-center gap-1 border-t bg-popover px-2 py-1.5">
          <button
            onClick={onQuote}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-2.5 text-[14px] font-bold hover:bg-accent"
          >
            <Highlighter className="size-4" />
            Quote sentence
          </button>
          {total > SHOWN && (
            <button
              onClick={() => setMoreKey(more ? '' : key)}
              className="ml-auto inline-flex min-h-10 items-center rounded-full px-2.5 text-[14px] font-bold text-primary hover:bg-primary/10"
            >
              {more ? 'Fewer' : 'More meanings'}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
