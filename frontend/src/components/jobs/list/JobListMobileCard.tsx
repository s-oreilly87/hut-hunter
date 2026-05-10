import type { WatchJob } from '@/lib/api'
import type { DisplayStatus } from '@/lib/availability'
import { StatusBadge } from '@/components/jobs/StatusBadge'
import { MonitoringBadge } from '@/components/jobs/MonitoringBadge'
import { AutoBookBadge } from '@/components/jobs/shared/AutoBookBadge'
import { JobIdentity } from './JobIdentity'
import { formatTimeAgo, isJobFinished } from './jobListHelpers'

/**
 * Mobile-layout (lg:hidden) card variant of a single job in the JobList.
 *
 * The status badge and last-checked timestamp sit in a right-aligned column;
 * the auto-book + monitoring badges drop below the identity for live jobs
 * (booked / cancelled / expired jobs collapse to just the identity + status).
 */
export function JobListMobileCard({
  job,
  displayStatus,
  hasOutdatedCampers,
  adapterDateFieldKeyById,
  adapterTrackFieldKeyById,
  onSelect,
  setRef,
}: {
  job: WatchJob
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
      className="w-full cursor-pointer rounded-[1.35rem] border border-border/80 bg-background/75 px-4 py-4 text-left transition-colors hover:border-primary/20 hover:bg-background max-sm:rounded-none max-sm:border-x-0 max-sm:border-t-0"
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
