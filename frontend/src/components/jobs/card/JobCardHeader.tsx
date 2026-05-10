import type { ReactNode } from 'react'
import { ArrowLeft, Pencil } from 'lucide-react'
import type { WatchJob } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { CardDescription, CardHeader, CardTitle } from '@/components/ui/Card'
import { HeaderParamSummary } from '@/components/jobs/shared/HeaderParamSummary'

/**
 * The top of a JobCard. Renders the job name, an inline edit pencil (when
 * the job isn't locked), the param-summary line, and any additional actions
 * passed in by the consumer (typically the Delete button).
 *
 * Two layouts share this component, picked by whether `onBack` is provided:
 *
 *  - Desktop layout (no onBack): a two-column flex with title + summary on
 *    the left and actions on the right.
 *  - Mobile-back layout (with onBack): a three-column grid where the back
 *    button, the centered title, and the actions each get their own column,
 *    with the param summary centered below.
 */
export function JobCardHeader({
  job,
  isLocked,
  onEditTitle,
  onEditParams,
  onBack,
  backLabel,
  actions,
}: {
  job: WatchJob
  isLocked: boolean
  /** Edit pencil next to the title; opens the wizard at step 0 (name+site). */
  onEditTitle: () => void
  /** Edit pencil next to the param summary; opens the wizard at step 1. */
  onEditParams: () => void
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
      <CardHeader className="shrink-0 gap-4 border-b border-border/70 pt-6 pb-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
          <div className="min-w-0">
            <Button size="sm" variant="ghost" className="-ml-2 w-fit" onClick={onBack}>
              <ArrowLeft className="size-4" />
              {backLabel}
            </Button>
          </div>
          <div className="flex min-w-0 items-center justify-center gap-1 pt-1">
            {!isLocked && <span className="size-8 shrink-0" aria-hidden="true" />}
            <CardTitle className="truncate text-lg tracking-tight sm:text-xl">
              {job.name}
            </CardTitle>
            {editPencil}
          </div>
          <div className="flex min-w-0 flex-wrap justify-end gap-2">
            {actions}
          </div>
        </div>
        <CardDescription className="text-center text-sm leading-5">
          <HeaderParamSummary
            params={job.params}
            onEdit={!isLocked ? onEditParams : undefined}
            centered
          />
        </CardDescription>
      </CardHeader>
    )
  }

  return (
    <CardHeader className="shrink-0 gap-4 border-b border-border/70 pt-6 pb-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CardTitle className="text-xl tracking-tight">{job.name}</CardTitle>
            {editPencil}
          </div>
          <CardDescription className="mt-2 max-w-3xl text-sm leading-5">
            <HeaderParamSummary
              params={job.params}
              onEdit={!isLocked ? onEditParams : undefined}
            />
          </CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {actions}
        </div>
      </div>
    </CardHeader>
  )
}
