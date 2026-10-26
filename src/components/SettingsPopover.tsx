import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { setPref, usePrefs, type Prefs } from '@/hooks/prefs'
import { downloadDictionary, useDictStatus } from '@/lib/dictionary'

type Choice = Exclude<keyof Prefs, 'define'>
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
  size: {
    title: 'Text size',
    options: [
      ['s', 'Small'],
      ['m', 'Medium'],
      ['l', 'Large'],
    ],
  },
  font: {
    title: 'Typeface',
    options: [
      ['sans', 'Sans'],
      ['serif', 'Serif'],
    ],
  },
}

function Segmented<K extends Choice>({ k }: { k: K }) {
  const prefs = usePrefs()
  const { title, options } = SECTIONS[k]
  return (
    <div>
      <h4 className="mb-1.5 text-[13px] font-bold text-muted-foreground">{title}</h4>
      <ToggleGroup
        type="single"
        value={prefs[k]}
        onValueChange={v => v && setPref(k, v as Prefs[K])}
        className="w-full gap-1.5"
        aria-label={title}
      >
        {options.map(([value, label]) => (
          <ToggleGroupItem
            key={value}
            value={value}
            className="h-auto rounded-full border px-1 py-2 text-sm font-normal hover:bg-accent hover:text-foreground data-[state=on]:border-transparent data-[state=on]:bg-pill data-[state=on]:font-bold data-[state=on]:text-pill-foreground"
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
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

/** The "Aa" button. The library shows only the theme; the reader shows everything. */
export function SettingsPopover({ reader = false }: { reader?: boolean }) {
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
        {reader && (
          <>
            <Segmented k="len" />
            <Segmented k="size" />
            <Segmented k="font" />
            <DefineSwitch />
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
