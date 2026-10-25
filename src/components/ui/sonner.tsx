import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { useResolvedTheme } from '@/hooks/prefs'

// shadcn's Sonner wrapper, reading the theme from our prefs instead of next-themes.
const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useResolvedTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
