import { AlertTriangle } from 'lucide-react'
import type { ArtifactRecord, WatchJob } from '@/lib/api'
import { ArtifactGallery } from '@/components/jobs/results/ArtifactGallery'
import { HoldExpiryCountdown } from './HoldExpiryCountdown'

/**
 * Shown when the hold worker hit an unexpected condition mid-funnel (THR-122)
 * — an unrecognized blocking dialog, a locator timeout — and parked the
 * session for manual takeover instead of tearing the browser down. Mirrors
 * HoldActiveSection's shape (same countdown, same cart-stage gallery); the
 * difference is the copy and that the CTA opens the live browser to finish
 * or cancel the booking yourself, rather than to pay.
 */
export function NeedsAttentionSection({
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
          <AlertTriangle className="size-4 text-amber-500" />
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
            Attention Needed
          </h3>
        </div>
        <a
          href={`/pay/${job.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 sm:w-auto"
        >
          Open Live Browser
        </a>
      </div>
      <div className="rounded-[1.25rem] border border-amber-500/25 bg-amber-500/8 px-4 py-4">
        <p className="text-base font-medium tracking-tight text-foreground">
          We hit something unexpected placing this hold.
        </p>
        <p className="mt-2 text-sm leading-5 text-muted-foreground">
          The browser is still open on the live site and waiting for you. Open the live
          browser to take over and finish or cancel the booking yourself before the
          cart expires.
        </p>
        <HoldExpiryCountdown cartExpiresAt={job.cart_expires_at} />
      </div>
      {holdArtifacts.length > 0 ? (
        <ArtifactGallery artifacts={holdArtifacts} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/40 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            No cart-stage snapshots are available for this session yet.
          </p>
        </div>
      )}
    </section>
  )
}
