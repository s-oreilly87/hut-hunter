import type { WatchJob } from '@/lib/api'
import type { DisplayStatus } from '@/lib/availability'
import { formatDateTime } from '@/lib/time'
import { TableCell, TableRow } from '@/components/ui/Table'
import { StatusBadge } from '@/components/jobs/StatusBadge'
import { MonitoringBadge } from '@/components/jobs/MonitoringBadge'
import { AutoBookBadge } from '@/components/jobs/shared/AutoBookBadge'
import { JobIdentity } from './JobIdentity'
import { formatTimeAgo, isJobFinished } from './jobListHelpers'
import { cn } from '@/lib/utils'

function JobAutomationMeta({
  job,
  displayStatus,
}: {
  job: WatchJob
  displayStatus: DisplayStatus
}) {
  if (isJobFinished(displayStatus)) return null

  return (
    <div className="flex flex-col items-start gap-2">
      <AutoBookBadge job={job} />
      <MonitoringBadge job={job} displayStatus={displayStatus} />
    </div>
  )
}

function JobStatusMeta({
  job,
  displayStatus,
  showStatusBadge,
}: {
  job: WatchJob
  displayStatus: DisplayStatus
  showStatusBadge: boolean
}) {
  const finished = isJobFinished(displayStatus)
  const checkedLabel = finished
    ? formatDateTime(job.last_checked_at)
    : formatTimeAgo(job.last_checked_at)
  const checkedPrefix = finished ? '' : 'Last checked'

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {showStatusBadge && (
          <StatusBadge
            status={displayStatus}
            jobId={job.id}
            cartExpiresAt={job.cart_expires_at}
            artifactUrl={job.last_artifact_png}
            windowOpensAt={job.window_opens_at}
            windowOpensPrecise={job.window_opens_precise}
          />
        )}
      </div>
      <p className="text-xs leading-4 text-muted-foreground/75">
        {checkedPrefix} {checkedLabel}
      </p>
    </div>
  )
}

/**
 * Desktop-layout (lg:block) row for a single job inside the JobList table.
 * Shows the job identity in column 1, the automation badges in column 2,
 * and the status + last-checked label in column 3.
 *
 * The selection styling adds a coloured left rail to the identity cell so
 * the active row reads as visually distinct without competing with the
 * sticky table header.
 */
export function JobListDesktopRow({
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
  setRef: (jobId: string, node: HTMLTableRowElement | null) => void
}) {
  const showStatusBadge = displayStatus !== 'checking'

  return (
    <TableRow
      data-job-id={job.id}
      ref={(node) => setRef(job.id, node)}
      className={cn(
        'cursor-pointer border-border/70 bg-background/60',
        isSelected && 'bg-primary/10 hover:bg-primary/10',
      )}
      onClick={() => onSelect(job.id)}
    >
      <TableCell
        className={cn(
          'relative w-[56%] whitespace-normal py-4 pl-4 pr-6 align-middle',
          isSelected
            && 'pl-7 before:absolute before:top-3 before:bottom-3 before:left-2 before:w-1 before:rounded-full before:bg-primary',
        )}
      >
        <JobIdentity
          job={job}
          adapterDateFieldKeyById={adapterDateFieldKeyById}
          adapterTrackFieldKeyById={adapterTrackFieldKeyById}
          hasOutdatedCampers={hasOutdatedCampers}
        />
      </TableCell>
      <TableCell className="w-[22%] py-4 pr-5 align-middle">
        <JobAutomationMeta job={job} displayStatus={displayStatus} />
      </TableCell>
      <TableCell className="py-4 pr-5 align-middle">
        <JobStatusMeta
          job={job}
          displayStatus={displayStatus}
          showStatusBadge={showStatusBadge}
        />
      </TableCell>
    </TableRow>
  )
}
