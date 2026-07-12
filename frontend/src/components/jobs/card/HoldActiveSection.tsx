import { ImageIcon } from 'lucide-react'
import type { ArtifactRecord, WatchJob } from '@/lib/api'
import { BookButton } from '@/components/jobs/BookButton'
import { ArtifactGallery } from '@/components/jobs/results/ArtifactGallery'
import { HoldExpiryCountdown } from './HoldExpiryCountdown'

/**
 * Shown when the job is in `hold_placed` and the cart hasn't yet expired.
 * The hold is paid for from here via the BookButton; the cart-stage
 * snapshots below let the user double-check the itinerary first.
 */
export function HoldActiveSection({
  job,
  holdArtifacts,
}: {
  job: WatchJob
  holdArtifacts: ArtifactRecord[]
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="size-4 text-primary" />
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
            Complete Payment
          </h3>
        </div>
        <BookButton job={job} className="w-full sm:w-auto" size="default" />
      </div>
      <div className="rounded-[1.25rem] border border-amber-500/25 bg-amber-500/8 p-4">
        <p className="text-base font-medium tracking-tight text-foreground">
          The hold is active and waiting for payment.
        </p>
        <p className="mt-2 text-sm/5 text-muted-foreground">
          Review the captured cart stages below if you want to confirm the itinerary before paying.
        </p>
        <HoldExpiryCountdown cartExpiresAt={job.cart_expires_at} />
      </div>
      {holdArtifacts.length > 0 ? (
        <ArtifactGallery artifacts={holdArtifacts} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/40 p-4">
          <p className="text-sm text-muted-foreground">
            No cart-stage snapshots are available for this hold yet.
          </p>
        </div>
      )}
    </section>
  )
}
