import { useRef, useState } from 'react'
import { Link, ScanQrCode, Smartphone } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { toast } from 'sonner'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { clampSize, FONT_SIZE, setPref, usePrefs, type Prefs } from '@/hooks/prefs'
import type { AutoScroll } from '@/hooks/useAutoScroll'
import { downloadDictionary, useDictStatus } from '@/lib/dictionary'
import { addCustomFont, FONT_ACCEPT, removeCustomFont, useCustomFont } from '@/lib/fonts'
import { MAX_SHORTCUTS, useShortcuts } from '@/lib/shortcuts'
import { GOAL } from '@/lib/streak'
import { canBadge } from '@/lib/widgets'

type Choice = Exclude<keyof Prefs, 'define' | 'tabBook' | 'size' | 'streakBadge' | 'view'>
type Option<K extends Choice> = [Prefs[K], string]

const SECTIONS: { [K in Choice]: { title: string; options: Option<K>[] } } = {
  theme: {
    title: 'Appearance',
    options: [
      ['light', 'Light'],
      ['dark', 'Dark'],
      ['system', 'System'],
    ],
  },
  len: {
    title: 'Post length',
    options: [
      ['s', 'Short'],
      ['m', 'Medium'],
      ['l', 'Long'],
    ],
  },
  font: {
    title: 'Typeface',
    options: [
      ['sans', 'Sans'],
      ['serif', 'Serif'],
      ['custom', 'Custom'],
    ],
  },
}

/** A titled row of pills, one of which is chosen. */
function Pills<V extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string
  options: [V, string, boolean?][]
  value: V
  onChange: (v: V) => void
}) {
  return (
    <div>
      <h4 className="mb-1.5 text-[13px] font-bold text-muted-foreground">{title}</h4>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={v => v && onChange(v as V)}
        className="w-full gap-1.5"
        aria-label={title}
      >
        {options.map(([value, label, disabled]) => (
          <ToggleGroupItem
            key={value}
            value={value}
            disabled={disabled}
            className="h-auto rounded-full border px-1 py-2 text-sm font-normal hover:bg-accent hover:text-foreground data-[state=on]:border-transparent data-[state=on]:bg-pill data-[state=on]:font-bold data-[state=on]:text-pill-foreground"
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function Segmented<K extends Choice>({ k }: { k: K }) {
  const prefs = usePrefs()
  const { title, options } = SECTIONS[k]
  return <Pills title={title} options={options} value={prefs[k]} onChange={v => setPref(k, v)} />
}

/**
 * Text size in px: a slider for big jumps, A buttons for one step at a time. The posts behind the popover change as it
 * moves, so they are the preview.
 */
function TextSize() {
  const { size } = usePrefs()
  const set = (n: number) => setPref('size', clampSize(n))
  const step = 'grid size-8 shrink-0 place-items-center rounded-full border font-bold hover:bg-accent disabled:opacity-40'
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <h4 id="text-size" className="text-[13px] font-bold text-muted-foreground">
          Text size
        </h4>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {size !== FONT_SIZE.default && (
            <>
              <button className="font-bold text-primary hover:underline" onClick={() => set(FONT_SIZE.default)}>
                Reset
              </button>
              {' · '}
            </>
          )}
          {size}px
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          aria-label="Smaller text"
          className={`${step} text-[12px]`}
          disabled={size <= FONT_SIZE.min}
          onClick={() => set(size - 1)}
        >
          A
        </button>
        <input
          type="range"
          min={FONT_SIZE.min}
          max={FONT_SIZE.max}
          value={size}
          onChange={e => set(+e.target.value)}
          aria-labelledby="text-size"
          aria-valuetext={`${size} pixels`}
          className="h-8 min-w-0 flex-1 cursor-pointer accent-primary"
        />
        <button
          aria-label="Larger text"
          className={`${step} text-[18px]`}
          disabled={size >= FONT_SIZE.max}
          onClick={() => set(size + 1)}
        >
          A
        </button>
      </div>
    </div>
  )
}

const AUTO_SCROLL: [AutoScroll, string][] = [
  ['off', 'Off'],
  ['1', '1s'],
  ['3', '3s'],
  ['6', '6s'],
  ['flow', 'Flow'],
]

/** Sans, Serif or a font the reader uploaded, with the upload itself. Custom can be picked once there is one. */
function TypefacePicker() {
  const { font } = usePrefs()
  const custom = useCustomFont()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const options: [Prefs['font'], string, boolean?][] = SECTIONS.font.options.map(([v, label]) =>
    v === 'custom' ? [v, 'Custom', !custom] : [v, label],
  )
  const upload = async (file: File) => {
    setBusy(true)
    try {
      await addCustomFont(file)
      setPref('font', 'custom')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not use that font.', { description: file.name })
    } finally {
      setBusy(false)
    }
  }
  const link = 'font-bold text-primary hover:underline disabled:opacity-50'
  return (
    <div>
      <Pills title="Typeface" options={options} value={font} onChange={v => setPref('font', v)} />
      <p className="mt-1 text-[13px] leading-4 text-muted-foreground">
        {custom ? (
          <>
            Custom: <span className="text-foreground">{custom.name}</span> ·{' '}
            <button className={link} disabled={busy} onClick={() => input.current?.click()}>
              Change
            </button>{' '}
            ·{' '}
            <button
              className={link}
              onClick={() =>
                void removeCustomFont().then(() => {
                  if (font === 'custom') setPref('font', 'sans')
                })
              }
            >
              Remove
            </button>
          </>
        ) : (
          <button className={link} disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Loading font…' : 'Upload your own font (TTF, OTF, WOFF)'}
          </button>
        )}
      </p>
      <input
        ref={input}
        type="file"
        accept={FONT_ACCEPT}
        hidden
        onChange={e => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/** The switch for looking words up, with how the offline dictionary's download is going. */
function DefineSwitch() {
  const { define } = usePrefs()
  const dict = useDictStatus()
  const note =
    dict.state === 'loading'
      ? `Downloading dictionary… ${dict.done}%`
      : dict.state === 'error'
        ? "Couldn't download the dictionary. Words you look up while online still work."
        : dict.state === 'ready'
          ? 'English only. Saved on this device, so it works offline.'
          : 'English only.'
  return (
    <div>
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="text-[15px] leading-5">Hold a word to see its meaning</span>
        <Switch
          checked={define}
          onCheckedChange={on => {
            setPref('define', on)
            if (on) void downloadDictionary()
          }}
        />
      </label>
      {define && <p className="mt-1 text-[13px] leading-4 text-muted-foreground">{note}</p>}
    </div>
  )
}

/** Whether the browser tab shows the book read last, instead of DoomReader. */
function TabBookSwitch() {
  const { tabBook } = usePrefs()
  return (
    <div>
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="text-[15px] leading-5">Show last read book in the browser tab</span>
        <Switch checked={tabBook} onCheckedChange={on => setPref('tabBook', on)} />
      </label>
      <p className="mt-1 text-[13px] leading-4 text-muted-foreground">
        Its title and cover replace DoomReader's. The installed app's icon stays the same.
      </p>
    </div>
  )
}

/** Whether the streak shows on the installed app's icon. Only where the browser can badge icons. */
function StreakBadgeSwitch() {
  const { streakBadge } = usePrefs()
  if (!canBadge()) return null
  return (
    <div>
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="text-[15px] leading-5">Show your streak on the app icon</span>
        <Switch checked={streakBadge} onCheckedChange={on => setPref('streakBadge', on)} />
      </label>
      <p className="mt-1 text-[13px] leading-4 text-muted-foreground">
        A day counts once you read {GOAL} posts. The number updates when you open DoomReader.
      </p>
    </div>
  )
}

const ROW =
  'flex items-center gap-2.5 rounded-xl px-1.5 py-2 text-left text-[15px] hover:bg-accent disabled:pointer-events-none disabled:opacity-50'

/** Home and Library's actions: picking up a book from another device, and adding a link shortcut. */
function LibraryActions({ onScan, onAddShortcut }: { onScan?: () => void; onAddShortcut?: () => void }) {
  const used = useShortcuts().length
  const full = used >= MAX_SHORTCUTS
  return (
    <div className="-mx-1.5 -mb-1.5 grid border-t pt-1.5">
      {onScan && (
        <PopoverPrimitive.Close onClick={onScan} className={ROW}>
          <ScanQrCode className="size-[18px] shrink-0" />
          Scan a sync code
        </PopoverPrimitive.Close>
      )}
      {onAddShortcut && (
        <PopoverPrimitive.Close onClick={onAddShortcut} disabled={full} className={ROW}>
          <Link className="size-[18px] shrink-0" />
          <span className="flex-1">Add a shortcut link</span>
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {full ? 'Full' : `${used} of ${MAX_SHORTCUTS}`}
          </span>
        </PopoverPrimitive.Close>
      )}
      {full && (
        <p className="px-1.5 pb-1 text-[13px] leading-4 text-muted-foreground">
          Long-press a shortcut (or right-click it) to change or remove it.
        </p>
      )}
    </div>
  )
}

/**
 * The "Aa" button. Home and Library show the theme, the tab and badge switches, and the scan and shortcut actions;
 * the reader shows the reading settings, plus auto-scroll when given one (it lasts only while the book is open, so it
 * is not a saved pref).
 */
export function SettingsPopover({
  reader = false,
  autoScroll,
  onAutoScroll,
  onSync,
  onScan,
  onAddShortcut,
}: {
  reader?: boolean
  autoScroll?: AutoScroll
  onAutoScroll?: (v: AutoScroll) => void
  /** Opens "Continue on another device". */
  onSync?: () => void
  /** Home and Library: opens the sync code scanner. */
  onScan?: () => void
  /** Home and Library: opens the dialog for a new link shortcut. */
  onAddShortcut?: () => void
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Settings"
        className="grid size-[38px] shrink-0 place-items-center rounded-full text-[15px] font-bold tracking-tight hover:bg-accent"
      >
        Aa
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="grid w-[min(300px,calc(100vw-24px))] gap-3.5 rounded-2xl p-3.5 shadow-pop"
      >
        <Segmented k="theme" />
        {reader ? (
          <>
            <Segmented k="len" />
            <TextSize />
            <TypefacePicker />
            {autoScroll && onAutoScroll && (
              <Pills title="Auto-scroll" options={AUTO_SCROLL} value={autoScroll} onChange={onAutoScroll} />
            )}
            <DefineSwitch />
            {onSync && (
              <PopoverPrimitive.Close
                onClick={onSync}
                className="-mx-1.5 -mb-1.5 flex items-center gap-2.5 rounded-xl px-1.5 py-2 text-left text-[15px] hover:bg-accent"
              >
                <Smartphone className="size-[18px] shrink-0" />
                Continue on another device
              </PopoverPrimitive.Close>
            )}
          </>
        ) : (
          <>
            <TabBookSwitch />
            <StreakBadgeSwitch />
            {(onScan || onAddShortcut) && <LibraryActions onScan={onScan} onAddShortcut={onAddShortcut} />}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
