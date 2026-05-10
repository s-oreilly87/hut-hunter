import type { ReactNode } from 'react'
import { SectionHeading } from '@/components/ui/SectionHeading'

/**
 * Visual grouping used inside the dialog presentation of the job form to
 * separate hunt setup, booking inputs, automation, and the submit button
 * into distinct cards.
 */
export function FormSection({
  title,
  tooltip,
  children,
}: {
  title?: string
  tooltip?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[1.5rem] border border-border/70 bg-secondary/35 p-4 sm:p-5">
      {title && (
        <div className="mb-4">
          <SectionHeading title={title} tooltip={tooltip} />
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </section>
  )
}
