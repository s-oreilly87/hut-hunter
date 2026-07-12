import { LayoutDashboard, Loader2 } from 'lucide-react'
import type { ArtifactRecord, WatchJob } from '@/lib/api'
import { jobHasPartialAvailability } from '@/lib/availability'
import { PartialAvailabilityHelp } from '@/components/jobs/BookButton'
import { LastResultView } from '@/components/jobs/results/LastResultView'

/**
 * Shown while the automation is mid-flow on a hold attempt — i.e. the
 * displayStatus is `booking` or `attempting_hold` but the job is not yet
 * `booking_complete`, `hold_placed`, or in a hold-expired state.
 *
 * Surfaces the spinner and, if a `last_result` is already attached,
 * the availability that triggered the booking attempt.
 */
export function BookingInProgressSection({
  job,
  unavailableArtifact,
}: {
  job: WatchJob
  unavailableArtifact: ArtifactRecord | null
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <LayoutDashboard className="size-4 text-primary" />
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
          Last Result
        </h3>
      </div>
      <div className="rounded-[1.25rem] border border-amber-500/25 bg-amber-500/8 p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-700">
            <Loader2 className="size-5 animate-spin" />
          </div>
          <div>
            <p className="font-medium tracking-tight text-foreground">Booking in progress</p>
            <p className="mt-1 text-sm/5 text-muted-foreground">
              Attempting to secure your hold…
            </p>
          </div>
        </div>
      </div>
      {job.last_result && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Latest availability that triggered the booking attempt:
          </p>
          <LastResultView
            result={job.last_result}
            artifactPng={job.last_artifact_png}
            artifactHtml={job.last_artifact_html}
            unavailableArtifact={unavailableArtifact}
            parkUrl={job.park_url}
          />
          {jobHasPartialAvailability(job) && (
            <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
              <PartialAvailabilityHelp />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
