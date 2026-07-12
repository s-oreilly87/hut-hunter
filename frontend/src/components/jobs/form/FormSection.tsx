import type { ReactNode } from 'react'
import { InsetPanel } from '@/components/ui/InsetPanel'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { cn } from '@/lib/utils'

/**
 * Visual grouping used inside the dialog presentation of the job form to
 * separate hunt setup, booking inputs, automation, and the submit button
 * into distinct cards.
 */
export function FormSection({
  title,
  tooltip,
  children,
  className,
}: {
  title?: string
  tooltip?: string
  children: ReactNode
  className?: string
}) {
  return (
    <InsetPanel as="section" className={cn(className)}>
      {title && (
        <div className="mb-4">
          <SectionHeading title={title} tooltip={tooltip} />
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </InsetPanel>
  )
}
