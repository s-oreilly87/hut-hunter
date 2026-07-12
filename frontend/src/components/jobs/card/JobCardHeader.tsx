import type { ReactNode } from 'react'
import { ArrowLeft, Pencil } from 'lucide-react'
import type { WatchJob } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { CardHeader, CardTitle } from '@/components/ui/Card'

/**
 * The top of a JobCard. Renders the job name, an inline edit pencil (when
 * the job isn't locked) and any additional actions passed in by the consumer
 * (typically the Delete button).
 *
 * Two layouts share this component, picked by whether `onBack` is provided:
 *
 *  - Desktop layout (no onBack): a two-column flex with the title on the left
 *    and actions on the right.
 *  - Mobile-back layout (with onBack): a three-column grid where the back
 *    button, the centered title, and the actions each get their own column.
 */
export function JobCardHeader({
  job,
  isLocked,
  onEditTitle,
  onBack,
  backLabel,
  actions,
}: {
  job: WatchJob
  isLocked: boolean
  /** Edit pencil next to the title; opens the wizard at step 0 (name+site). */
  onEditTitle: () => void
  /** When provided, switch to the centered mobile-back layout. */
  onBack?: () => void
  backLabel?: string
  actions?: ReactNode
}) {
  const editPencil = !isLocked
    ? (
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0 text-muted-foreground/50"
        onClick={onEditTitle}
      >
        <Pencil className="size-4" />
      </Button>
    )
    : null

  if (onBack) {
    return (
      <div className="shrink-0 border-b border-border/70 p-4 sm:px-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="min-w-0">
            <Button size="sm" variant="ghost" className="-ml-2 w-fit" onClick={onBack}>
              <ArrowLeft className="size-4" />
              {backLabel}
            </Button>
          </div>
          <div className="flex min-w-0 items-center justify-center gap-1">
            {!isLocked && <span className="size-8 shrink-0" aria-hidden="true" />}
            <CardTitle className="truncate text-base font-semibold tracking-tight">
              {job.name}
            </CardTitle>
            {editPencil}
          </div>
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            {actions}
          </div>
        </div>
      </div>
    )
  }

  return (
    <CardHeader className="shrink-0 gap-4 border-b border-border/70 pt-6 pb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold tracking-tight sm:text-lg">{job.name}</CardTitle>
            {editPencil}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {actions}
        </div>
      </div>
    </CardHeader>
  )
}
