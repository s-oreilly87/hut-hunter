import type { WatchJob } from '@/lib/api'
import type { DisplayStatus } from '@/lib/availability'
import { formatRelativeTimeFromNow } from '@/lib/time'
import { StatusBadge } from '@/components/jobs/StatusBadge'
import { MonitoringBadge } from '@/components/jobs/MonitoringBadge'
import { AutoBookBadge } from '@/components/jobs/shared/AutoBookBadge'
import { JobIdentity } from './JobIdentity'
import { cn } from '@/lib/utils'

function formatTimeAgo(value: string | null): string {
  return formatRelativeTimeFromNow(value, { justNowLabel: 'just now' })
}

function isJobFinished(displayStatus: DisplayStatus): boolean {
  return (
    displayStatus === 'booking_complete'
    || displayStatus === 'cancelled'
    || displayStatus === 'expired'
  )
}

/**
 * Mobile-layout (lg:hidden) card variant of a single job in the JobList.
 *
 * The status badge and last-checked timestamp sit in a right-aligned column;
 * the auto-book + monitoring badges drop below the identity for live jobs
 * (booked / cancelled / expired jobs collapse to just the identity + status).
 */
export function JobListMobileCard({
  job,
  isSelected,
  displayStatus,
  hasOutdatedCampers,
  adapterDateFieldKeyById,
  adapterTrackFieldKeyById,
  onSelect,
  setRef,
}: {
  job: WatchJob
  isSelected: boolean
  displayStatus: DisplayStatus
  hasOutdatedCampers: boolean
  adapterDateFieldKeyById: Map<string, string>
  adapterTrackFieldKeyById: Map<string, string>
  onSelect: (jobId: string) => void
  setRef: (jobId: string, node: HTMLDivElement | null) => void
}) {
  const showStatusBadge = displayStatus !== 'checking'
  const showLiveBadges = !isJobFinished(displayStatus)

  return (
    <div
      role="button"
      tabIndex={0}
      data-job-id={job.id}
      ref={(node) => setRef(job.id, node)}
      className={cn(
        'w-full cursor-pointer rounded-[1.35rem] border px-4 py-4 text-left transition-colors',
        isSelected
          ? 'border-primary/45 bg-primary/8 ring-2 ring-primary/20 shadow-[0_22px_55px_-34px_rgba(22,53,40,0.7)]'
          : 'border-border/80 bg-background/75 hover:border-primary/20 hover:bg-background',
      )}
      onClick={() => onSelect(job.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(job.id)
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <JobIdentity
            job={job}
            adapterDateFieldKeyById={adapterDateFieldKeyById}
            adapterTrackFieldKeyById={adapterTrackFieldKeyById}
            hasOutdatedCampers={hasOutdatedCampers}
          />
          {showLiveBadges && (
            <div className="flex flex-wrap items-center gap-2">
              <AutoBookBadge job={job} />
              <MonitoringBadge job={job} displayStatus={displayStatus} />
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5 text-right">
          {showStatusBadge && (
            <StatusBadge
              status={displayStatus}
              jobId={job.id}
              cartExpiresAt={job.cart_expires_at}
              artifactUrl={job.last_artifact_png}
            />
          )}
          <p className="text-xs leading-4 text-muted-foreground/70">
            {formatTimeAgo(job.last_checked_at)}
          </p>
        </div>
      </div>
    </div>
  )
}
