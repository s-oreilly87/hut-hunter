import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTheme, type Theme } from '@/lib/useTheme'

const THEME_META: Record<Theme, { label: string; next: string; Icon: typeof Monitor }> = {
  system: { label: 'System theme', next: 'Switch to light', Icon: Monitor },
  light: { label: 'Light theme', next: 'Switch to dark', Icon: Sun },
  dark: { label: 'Dark theme', next: 'Switch to system', Icon: Moon },
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, cycleNext } = useTheme()
  const { label, next, Icon } = THEME_META[theme]

  return (
    <button
      type="button"
      aria-label={`${label} — click to ${next}`}
      title={`${label} — click to ${next}`}
      onClick={cycleNext}
      className={cn(
        'flex size-9 items-center justify-center rounded-xl border border-border/50 bg-background/70 text-muted-foreground transition hover:bg-secondary/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none',
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  )
}
