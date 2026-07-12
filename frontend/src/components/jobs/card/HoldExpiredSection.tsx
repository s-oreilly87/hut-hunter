import { AlertTriangle } from 'lucide-react'
import type { ArtifactRecord, WatchJob } from '@/lib/api'
import { BookButton } from '@/components/jobs/BookButton'
import { ArtifactGallery } from '@/components/jobs/results/ArtifactGallery'

/**
 * Shown when a hold was placed but the 25-minute payment window passed.
 * The user can re-attempt the hold from here (BookButton) or run a fresh
 * availability check first.
 */
export function HoldExpiredSection({
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
          <AlertTriangle className="size-4 text-primary" />
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
            Hold Expired
          </h3>
        </div>
        <BookButton job={job} className="w-full sm:w-auto" size="default" />
      </div>
      <div className="rounded-[1.25rem] border border-zinc-500/25 bg-zinc-500/8 p-4">
        <p className="text-base font-medium tracking-tight text-foreground">
          The 25-minute payment window has closed.
        </p>
        <p className="mt-2 text-sm/5 text-muted-foreground">
          You can attempt the hold again from here, or run a fresh check first if you want to reconfirm availability.
        </p>
      </div>
      {holdArtifacts.length > 0 ? (
        <ArtifactGallery artifacts={holdArtifacts} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/40 p-4">
          <p className="text-sm text-muted-foreground">
            No cart-stage snapshots are available from the expired hold.
          </p>
        </div>
      )}
    </section>
  )
}
