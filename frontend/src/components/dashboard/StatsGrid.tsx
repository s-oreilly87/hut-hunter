import { Clock3, LockKeyhole, Plus, Users } from 'lucide-react'
import type { JobFilterKey } from '@/components/jobs/jobFilters'
import type { DashboardStat } from '@/components/layout/types'
import { cn } from '@/lib/utils'

export type { DashboardStat }

function OccupantsTile({ onOpen }: { onOpen: () => void }) {
  return (
    <article className="app-panel flex min-h-28 flex-col px-5 py-3.5">
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
        Add camper details to enable automated booking. Hut Hunter needs passenger info to complete checkout.
      </p>
    </article>
  )
}

function CredentialsTile({
  onOpen,
  missingCount,
}: {
  onOpen: () => void
  missingCount: number
}) {
  return (
    <article className="app-panel flex min-h-28 flex-col px-5 py-3.5">
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
        Save your DOC login so Hut Hunter can continue from checks into booking.
        {missingCount > 1 ? ` ${missingCount} sites still need a sign-in.` : ''}
      </p>
    </article>
  )
}

function NoJobsTile({ onCreateJob }: { onCreateJob: () => void }) {
  return (
    <article className="flex min-h-28 flex-col justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-card/50 px-6 py-4">
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

function CreateMoreJobsTile({ onCreateJob }: { onCreateJob: () => void }) {
  return (
    <article className="flex w-full min-h-28 flex-col justify-center rounded-[1.75rem] border border-dashed border-border/70 bg-card/50 px-6 py-4 sm:w-64">
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
}) {
  const visibleStats = stats.filter((s) => s.value > 0)
  const showOccupantsTile = !hasOccupants
  const showCredentialsTile = missingCredentialCount > 0
  const showNoJobsTile = totalJobs === 0 && showNewHuntTile

  return (
    <section className="flex flex-wrap items-start justify-center xl:justify-start gap-3">
      {showNoJobsTile ? (
        <div className="w-full sm:w-80">
          <NoJobsTile onCreateJob={onCreateJob} />
        </div>
      ) : (
        <>
          {visibleStats.map((stat) => {
            const isActive = activeFilters.includes(stat.filterKey)
            return (
              <article
                key={stat.filterKey}
                className={cn(
                  'app-panel w-full min-h-28 overflow-hidden px-5 py-3.5 sm:w-64',
                  isActive && 'ring-2 ring-primary/25',
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 text-left"
                  onClick={() => onFilterSelect(stat.filterKey)}
                >
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      {stat.label}
                    </p>
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
                </button>

                <p className="mt-2 text-xs leading-4 text-pretty text-muted-foreground">
                  {stat.description}
                </p>
              </article>
            )
          })}

          {showNewHuntTile && (
            <div className="w-full sm:w-64">
              <CreateMoreJobsTile onCreateJob={onCreateJob} />
            </div>
          )}
        </>
      )}

      {showOccupantsTile && (
        <div className="w-full sm:w-80">
          <OccupantsTile onOpen={onOpenOccupants} />
        </div>
      )}

      {showCredentialsTile && (
        <div className="w-full sm:w-80">
          <CredentialsTile onOpen={onOpenCredentials} missingCount={missingCredentialCount} />
        </div>
      )}
    </section>
  )
}
