import type { JobFilterKey } from '@/components/jobs/jobFilters'
import type { DashboardStat } from '@/components/layout/types'
import { InfoTooltip } from '@/components/ui/SectionHeading'
import {
  CreateMoreJobsTile,
  CredentialsTile,
  NoJobsTile,
  OccupantsTile,
} from './SetupTiles'
import { cn } from '@/lib/utils'

export type { DashboardStat }

function StatFilterTile({
  stat,
  isActive,
  compact,
  onSelect,
  className,
}: {
  stat: DashboardStat
  isActive: boolean
  compact: boolean
  onSelect: () => void
  className?: string
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      className={cn(
        'app-panel w-full overflow-hidden px-5 py-3.5 text-left sm:w-60',
        !compact && 'min-h-28',
        isActive && 'ring-2 ring-primary/25',
        className,
      )}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
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
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
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
        <p className="mt-2 text-xs/4 text-pretty text-muted-foreground">
          {stat.description}
        </p>
      )}
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
  className,
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
  className?: string
}) {
  const visibleStats = stats.filter((s) => s.value > 0)
  const showOccupantsTile = !hasOccupants
  const showCredentialsTile = missingCredentialCount > 0
  const showNoJobsTile = totalJobs === 0 && showNewHuntTile

  return (
    <section className={cn('flex flex-wrap items-stretch justify-center xl:justify-start gap-3', className)}>
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
          {visibleStats.map((stat) => (
            <StatFilterTile
              key={stat.filterKey}
              stat={stat}
              isActive={activeFilters.includes(stat.filterKey)}
              compact={compact}
              onSelect={() => onFilterSelect(stat.filterKey)}
            />
          ))}

          {showNewHuntTile && (
            <CreateMoreJobsTile onCreateJob={onCreateJob} className="w-full sm:w-64" />
          )}
        </>
      )}
    </section>
  )
}
