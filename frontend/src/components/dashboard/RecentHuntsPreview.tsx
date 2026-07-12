import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { adaptersApi } from '@/lib/api'
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
import { useJobsStore } from '@/store/jobs'
import { buildAdapterFieldMaps } from '@/components/jobs/jobParamDisplay'
import { getDisplayStatus } from '@/lib/availability'
import { StatusBadge } from '@/components/jobs/StatusBadge'
import { JobIdentity } from '@/components/jobs/list/JobIdentity'
import { formatTimeAgo } from '@/components/jobs/list/jobListHelpers'

const PREVIEW_COUNT = 3

/**
 * THR-129 item 5: compact "recent hunts" teaser for the mobile dashboard.
 *
 * The mobile dashboard route used to render only StatsGrid, which goes
 * mostly blank once the setup tiles (Campers/Sign-Ins) are configured away
 * and every count tile happens to read zero — there was nothing left to
 * look at. This shows the 2-3 most recently created hunts with their status
 * badge (which already encodes the latest-check result — Available/
 * Unavailable/etc, see StatusBadge) and last-checked time, tapping through
 * to the job detail page.
 *
 * Reuses `useJobsQuery`/the `adapters` query cache — both are already
 * fetched elsewhere in the app (JobList, App.tsx), so this adds no extra
 * network traffic, just a second read of the same cached data.
 */
export function RecentHuntsPreview({
  onSelectJob,
}: {
  onSelectJob: (jobId: string) => void
}) {
  const { pendingBookings } = useJobsStore()

  const { data: jobs = [] } = useJobsQuery({
    select: (data) =>
      [...data].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
  })

  const { data: adapters = [] } = useQuery({
    queryKey: ['adapters'],
    queryFn: adaptersApi.list,
  })

  const { dateFieldKeyById, trackFieldKeyById } = useMemo(
    () => buildAdapterFieldMaps(adapters),
    [adapters],
  )

  const recentJobs = jobs.slice(0, PREVIEW_COUNT)
  if (!recentJobs.length) return null

  return (
    <section className="app-panel app-panel-frame">
      <div className="border-b border-border/70 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          Recent Hunts
        </h2>
      </div>
      <div className="divide-y divide-border/70">
        {recentJobs.map((job) => {
          const displayStatus = getDisplayStatus(job, pendingBookings)
          return (
            <div
              key={job.id}
              role="button"
              tabIndex={0}
              data-job-id={job.id}
              className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 sm:px-5"
              onClick={() => onSelectJob(job.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectJob(job.id)
                }
              }}
            >
              <div className="min-w-0 flex-1">
                <JobIdentity
                  job={job}
                  adapterDateFieldKeyById={dateFieldKeyById}
                  adapterTrackFieldKeyById={trackFieldKeyById}
                  hasOutdatedCampers={false}
                />
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
                <StatusBadge
                  status={displayStatus}
                  jobId={job.id}
                  cartExpiresAt={job.cart_expires_at}
                  artifactUrl={job.last_artifact_png}
                  windowOpensAt={job.window_opens_at}
                  windowOpensPrecise={job.window_opens_precise}
                />
                <div className="flex items-center gap-1 text-xs/4 text-muted-foreground/70">
                  {formatTimeAgo(job.last_checked_at)}
                  <ChevronRight className="size-3.5 text-muted-foreground/50" />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
