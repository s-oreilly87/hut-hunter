import type { WatchJob } from '@/lib/api'
import {
  getJobMetaLine,
  getJobSubtitle,
  getJobTitle,
} from '@/components/jobs/jobParamDisplay'
import { OutdatedCampersIcon } from '@/components/jobs/shared/OutdatedCampers'

/**
 * Three-line header for a job in the list view: name + outdated-campers
 * indicator, then the subtitle (facility/track + start date), then the meta
 * line (nights/people).
 *
 * Used by both the mobile card and the desktop table row variants.
 */
export function JobIdentity({
  job,
  adapterDateFieldKeyById,
  adapterTrackFieldKeyById,
  hasOutdatedCampers,
}: {
  job: WatchJob
  adapterDateFieldKeyById: Map<string, string>
  adapterTrackFieldKeyById: Map<string, string>
  hasOutdatedCampers: boolean
}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="flex min-w-0 items-center gap-1.5 text-base font-semibold tracking-tight text-foreground sm:text-sm">
        <span className="truncate">{getJobTitle(job)}</span>
        {hasOutdatedCampers && <OutdatedCampersIcon />}
      </p>
      <p className="text-base tracking-tight text-muted-foreground/90 sm:text-sm">
        {getJobSubtitle(job, adapterDateFieldKeyById, adapterTrackFieldKeyById)}
      </p>
      <p className="text-base text-muted-foreground/60 sm:text-sm">
        {getJobMetaLine(job)}
      </p>
    </div>
  )
}
