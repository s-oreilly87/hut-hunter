import { Clock3 } from 'lucide-react'

/**
 * Skeleton placeholder shown while the initial jobs query is in flight.
 * Four rounded blocks in a 2-up grid mirror the steady-state mobile card
 * layout closely enough to avoid jarring on first paint.
 */
export function JobListLoadingSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="h-32 animate-pulse rounded-3xl border border-border/70 bg-muted/50 max-sm:rounded-none max-sm:border-x-0"
        />
      ))}
    </div>
  )
}

/**
 * Empty state for two adjacent cases the JobList caller shouldn't have to
 * distinguish in JSX:
 *  - "No hunts at all" — happy onboarding copy nudging towards Create.
 *  - "Filters hide everything" — short hint that filters are the cause.
 */
export function JobListEmptyState({
  variant,
}: {
  variant: 'no-jobs' | 'no-matches' | 'no-matches-unfiltered'
}) {
  const isNoJobs = variant === 'no-jobs'
  const isFiltered = variant === 'no-matches'

  const title = isNoJobs ? 'No hunts yet' : 'No matching hunts'
  const description = isNoJobs
    ? 'Create a hunt to start checking availability, storing result history, and preparing the booking path when space opens.'
    : isFiltered
      ? 'No hunts match the selected filters. Try adjusting or clearing them.'
      : 'No hunts available.'

  const minHeight = isNoJobs ? 'min-h-72' : 'min-h-56'

  return (
    <div className={`flex ${minHeight} flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border/80 bg-muted/25 px-6 py-10 text-center max-sm:rounded-none max-sm:border-x-0`}>
      <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <Clock3 className="size-5" />
      </div>
      <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      <p className="mt-2 max-w-sm text-sm/6 text-pretty text-muted-foreground">
        {description}
      </p>
    </div>
  )
}
