import { Stamp } from 'lucide-react'
import type { ArtifactRecord, WatchJob } from '@/lib/api'
import { formatDateTime } from '@/lib/time'
import { ArtifactGallery } from '@/components/jobs/results/ArtifactGallery'

/**
 * Shown when `job.status === 'booking_complete'`. Confirms the time the
 * booking flow finished and surfaces all captured artifacts (cart stages
 * plus the receipt).
 */
export function BookingCompleteSection({
  job,
  completedArtifacts,
}: {
  job: WatchJob
  completedArtifacts: ArtifactRecord[]
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Stamp className="size-4 text-primary" />
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
          Booking Complete
        </h3>
      </div>
      <div className="rounded-[1.25rem] border border-emerald-500/25 bg-emerald-500/8 px-4 py-4">
        <p className="text-sm text-muted-foreground">
          Booking flow completed at {formatDateTime(job.last_checked_at)}
        </p>
      </div>
      {completedArtifacts.length > 0 && <ArtifactGallery artifacts={completedArtifacts} />}
    </section>
  )
}
