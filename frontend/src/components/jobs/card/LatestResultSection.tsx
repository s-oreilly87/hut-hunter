import { LayoutDashboard } from 'lucide-react'
import type { ArtifactRecord, WatchJob } from '@/lib/api'
import { jobHasPartialAvailability } from '@/lib/availability'
import { formatRelativeTimeFromNow } from '@/lib/time'
import { BookButton, PartialAvailabilityHelp } from '@/components/jobs/BookButton'
import { LastResultView } from '@/components/jobs/results/LastResultView'

function formatRelativeTime(value: string | null): string {
  return formatRelativeTimeFromNow(value, {
    emptyLabel: 'Never checked',
    justNowLabel: 'just now',
    prefix: 'Checked',
  })
}

/**
 * Shown for a "settled" non-terminal job (not booking-complete, not hold-
 * placed, not currently checking, and not mid-booking-flow).
 *
 * Two visual variants based on whether `job.last_result` is populated:
 *  - With a result: render the result tiles + partial-availability hint.
 *  - Without one:   render an empty placeholder pointing at "Check Now".
 *
 * Both variants share the header row that pairs the section title with the
 * BookButton.
 */
export function LatestResultSection({
  job,
  unavailableArtifact,
}: {
  job: WatchJob
  unavailableArtifact: ArtifactRecord | null
}) {
  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="size-4 text-primary" />
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
            Latest Result
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatRelativeTime(job.last_checked_at)}
        </p>
      </div>
      <BookButton job={job} className="w-full sm:w-auto" size="default" />
    </div>
  )

  if (!job.last_result) {
    return (
      <section className="space-y-3">
        {header}
        <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/40 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            No automation result has been stored for this hunt yet.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      {header}
      <LastResultView
        result={job.last_result}
        artifactPng={job.last_artifact_png}
        artifactHtml={job.last_artifact_html}
        unavailableArtifact={unavailableArtifact}
      />
      {jobHasPartialAvailability(job) && (
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
          <PartialAvailabilityHelp />
        </div>
      )}
    </section>
  )
}
