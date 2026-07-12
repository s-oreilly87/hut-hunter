import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type StatusPillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONE_CLASSES: Record<StatusPillTone, string> = {
  neutral: 'bg-secondary text-muted-foreground',
  success: 'bg-emerald-500/12 text-emerald-700',
  warning: 'bg-amber-500/12 text-amber-700',
  danger: 'bg-destructive/12 text-destructive',
  info: 'bg-sky-500/12 text-sky-700',
}

/**
 * Compact status chip for settings cards (enabled/disabled, verification).
 * Prefer tone over raw className when the palette already covers the case.
 */
export function StatusPill({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: StatusPillTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-1 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
