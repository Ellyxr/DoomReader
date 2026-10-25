import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { setPref, usePrefs, type Prefs } from '@/hooks/prefs'

type Option<K extends keyof Prefs> = [Prefs[K], string]

const SECTIONS: { [K in keyof Prefs]: { title: string; options: Option<K>[] } } = {
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

function Segmented<K extends keyof Prefs>({ k }: { k: K }) {
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
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
