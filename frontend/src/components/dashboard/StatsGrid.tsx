import { Clock3, LockKeyhole, Plus, Users } from 'lucide-react'
import type { JobFilterKey } from '@/components/jobs/jobFilters'
import type { DashboardStat } from '@/components/layout/types'
import { InfoTooltip } from '@/components/ui/SectionHeading'
import { cn } from '@/lib/utils'

export type { DashboardStat }

function OccupantsTile({ onOpen, className }: { onOpen: () => void; className?: string }) {
  return (
    <article className={cn('app-panel flex min-h-28 flex-col px-5 py-3.5', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
            <Users className="size-4" />
          </div>
          <p className="text-sm font-semibold tracking-tight text-foreground">
            Campers
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/8 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-500/10 hover:bg-amber-500/14"
          onClick={onOpen}
        >
          <Plus className="size-3" />
          Add
        </button>
      </div>
      <p className="mt-2.5 text-xs leading-4 text-pretty text-muted-foreground">
        Add camper details to enable automated booking. Hut Hunter needs this info to complete checkout.
      </p>
    </article>
  )
}

function CredentialsTile({
  onOpen,
  missingCount,
  className,
}: {
  onOpen: () => void
  missingCount: number
  className?: string
}) {
  return (
    <article className={cn('app-panel flex min-h-28 flex-col px-5 py-3.5', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700">
            <LockKeyhole className="size-4" />
          </div>
          <p className="text-sm font-semibold tracking-tight text-foreground">
            Sign-Ins
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/8 px-2 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-500/10 hover:bg-sky-500/14"
          onClick={onOpen}
        >
          <Plus className="size-3" />
          Add
        </button>
      </div>
      <p className="mt-2.5 text-xs leading-4 text-pretty text-muted-foreground">
        Save your booking site logins so Hut Hunter can seamlessly move from availability checks into the booking flow.
        {missingCount > 1 ? ` ${missingCount} sites still need a sign-in.` : ''}
      </p>
    </article>
  )
}

function NoJobsTile({ onCreateJob, className }: { onCreateJob: () => void; className?: string }) {
  return (
    <article className={cn('flex min-h-28 flex-col justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-card/50 px-6 py-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Clock3 className="size-4.5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">
              No hunts yet
            </p>
            <p className="text-xs text-muted-foreground">
              Create a hunt to start monitoring.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/8 px-4 py-2 text-sm font-medium text-primary ring-1 ring-primary/10 hover:bg-primary/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={onCreateJob}
        >
          <Plus className="size-4" />
          Create a Hunt
        </button>
      </div>
    </article>
  )
}

function CreateMoreJobsTile({ onCreateJob, className }: { onCreateJob: () => void; className?: string }) {
  return (
    <article className={cn('flex w-full min-h-28 flex-col justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-card/50 px-6 py-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-tight text-foreground">
            New Hunt
          </p>
          <p className="text-xs text-muted-foreground">
            Monitor more routes or dates.
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/8 px-4 py-2 text-sm font-medium text-primary ring-1 ring-primary/10 hover:bg-primary/12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          onClick={onCreateJob}
        >
          <Plus className="size-4" />
          Create
        </button>
      </div>
    </article>
  )
}

export function StatsGrid({
  stats,
  totalJobs,
  activeFilters,
  hasOccupants,
  missingCredentialCount,
  onFilterSelect,
  onCreateJob,
  onOpenOccupants,
  onOpenCredentials,
  showNewHuntTile = true,
  compact = false,
}: {
  stats: DashboardStat[]
  totalJobs: number
  activeFilters: JobFilterKey[]
  hasOccupants: boolean
  missingCredentialCount: number
  onFilterSelect: (filterKey: JobFilterKey) => void
  onCreateJob: () => void
  onOpenOccupants: () => void
  onOpenCredentials: () => void
  showNewHuntTile?: boolean
  // THR-129 item 5: desktop-only — moves each tile's description into an
  // info tooltip beside the label and drops the min-h-28 floor so the
  // status/filter tile row tightens up, leaving more room for the
  // Index/Show cards below it. Mobile keeps the full description text.
  compact?: boolean
}) {
  const visibleStats = stats.filter((s) => s.value > 0)
  const showOccupantsTile = !hasOccupants
  const showCredentialsTile = missingCredentialCount > 0
  const showNoJobsTile = totalJobs === 0 && showNewHuntTile

  return (
    <section className="flex flex-wrap items-stretch justify-center xl:justify-start gap-3">
      {showOccupantsTile && (
        <OccupantsTile onOpen={onOpenOccupants} className="w-full sm:w-64" />
      )}

      {showCredentialsTile && (
        <CredentialsTile
          onOpen={onOpenCredentials}
          missingCount={missingCredentialCount}
          className="w-full sm:w-64"
        />
      )}

      {showNoJobsTile ? (
        <NoJobsTile onCreateJob={onCreateJob} className="w-full sm:w-64" />
      ) : (
        <>
          {visibleStats.map((stat) => {
            const isActive = activeFilters.includes(stat.filterKey)
            return (
              <article
                key={stat.filterKey}
                role="button"
                tabIndex={0}
                className={cn(
                  'app-panel w-full overflow-hidden px-5 py-3.5 text-left sm:w-60',
                  !compact && 'min-h-28',
                  isActive && 'ring-2 ring-primary/25',
                )}
                onClick={() => onFilterSelect(stat.filterKey)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onFilterSelect(stat.filterKey)
                  }
                }}
              >
                <div className="flex w-full items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-1">
                      <p className="text-sm font-medium text-muted-foreground">
                        {stat.label}
                      </p>
                      {compact && (
                        <span onClick={(e) => e.stopPropagation()}>
                          <InfoTooltip content={stat.description} align="start" />
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                      {stat.value}
                    </p>
                  </div>
                  <div className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-2xl',
                    isActive ? 'bg-primary/15 text-primary' : 'bg-primary/10 text-primary',
                  )}>
                    <stat.icon className="size-5" />
                  </div>
                </div>

                {!compact && (
                  <p className="mt-2 text-xs leading-4 text-pretty text-muted-foreground">
                    {stat.description}
                  </p>
                )}
              </article>
            )
          })}

          {showNewHuntTile && (
            <CreateMoreJobsTile onCreateJob={onCreateJob} className="w-full sm:w-64" />
          )}
        </>
      )}
    </section>
  )
}
