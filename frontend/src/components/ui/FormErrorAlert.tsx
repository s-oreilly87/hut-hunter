import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Inline destructive error banner for forms and settings cards.
 * Call sites own margin; pass className for spacing variants.
 */
export function FormErrorAlert({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive',
        className,
      )}
      role="alert"
    >
      {children}
    </div>
  )
}
