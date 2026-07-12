import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Soft inset panel used for settings cards, form sections, and dialog side
 * columns. Call sites own margin; pass className to adjust padding/layout.
 */
export function InsetPanel({
  children,
  className,
  as: Comp = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'article'
}) {
  return (
    <Comp
      className={cn(
        'rounded-[1.5rem] border border-border/70 bg-secondary/35 p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </Comp>
  )
}
