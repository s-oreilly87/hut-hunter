import { useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { jobsApi, type WatchJob } from '@/lib/api'
import { jobAllFullyAvailable } from '@/lib/availability'
import { useJobsStore } from '@/store/jobs'
import { Button } from '@/components/ui/button'

// ---------------------------------------------------------------------------
// BookButton
// ---------------------------------------------------------------------------
// Renders one of three states based on the current job:
//   - idle:    "Attempt Booking" (green) — all sites fully available, ready to hold
//   - stale:   "Attempt Booking" (disabled) — last check is >30 min old
//   - booking: "Booking…" with spinner, disabled — hold worker running
//   - held:    "Open Payment" link to /pay/{id} — hold in place, user pays
//
// The booking spinner stays up while the Zustand pendingBookings flag is set;
// the flag is cleared when the job flips to HOLD_PLACED (success) or away
// from CHECKING without flipping to HOLD_PLACED (failure / recheck missed).

const STALE_MS = 30 * 60 * 1000 // 30 minutes

function isCheckStale(lastCheckedAt: string | null): boolean {
  if (!lastCheckedAt) return true
  return Date.now() - new Date(lastCheckedAt).getTime() > STALE_MS
}

export function BookButton({
  job,
  size = 'sm',
  className,
}: {
  job: WatchJob
  size?: 'sm' | 'default'
  className?: string
}) {
  const qc = useQueryClient()
  const { pendingBookings, markBooking, clearBooking } = useJobsStore()
  const isPendingLocal = pendingBookings.has(job.id)

  const mutation = useMutation({
    mutationFn: jobsApi.book,
    onMutate: (id: string) => markBooking(id),
    onError: (_e, id) => clearBooking(id),
    onSuccess: () => {
      // Keep pending flag set — it flips off when the job transitions out
      // of CHECKING (success → HOLD_PLACED, failure → PAUSED). Just make
      // sure our cached view gets refreshed.
      qc.invalidateQueries({ queryKey: ['jobs'] })
      qc.invalidateQueries({ queryKey: ['jobs', job.id] })
    },
  })

  // Clear the pending flag once the server-side status resolves. We watch
  // `job.status` from react-query's 5s poll: HOLD_PLACED means the hold
  // landed (success); anything terminal or a return to PAUSED means the
  // hold worker finished without placing a hold (failure).
  useEffect(() => {
    if (!isPendingLocal) return
    if (job.status !== 'checking') {
      clearBooking(job.id)
    }
  }, [isPendingLocal, job.status, job.id, clearBooking])

  const showBooking = isPendingLocal || mutation.isPending
  const stale = isCheckStale(job.last_checked_at)

  // Self-gate visibility so callers don't have to reproduce the logic.
  // Render when: (a) we think a book would succeed right now, (b) we're in
  // the middle of booking, or (c) a hold has landed and we want to be the
  // pay entry point. Never render for terminal states (completed, expired).
  const isTerminal = job.status === 'booking_complete' || job.status === 'expired'
  const visible =
    !isTerminal && (
      job.status === 'hold_placed'
      || showBooking
      || jobAllFullyAvailable(job)
    )
  if (!visible) return null

  // Hold landed — show a link to the pay page. StatusBadge already does this
  // but the Book button is what the user just clicked, so it's natural for
  // *it* to become the entry point.
  if (job.status === 'hold_placed') {
    return (
      <Button
        asChild
        size={size}
        className={`bg-emerald-600 hover:bg-emerald-700 text-white ${className ?? ''}`}
      >
        <a
          href={`/pay/${job.id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          title="Hold placed — open the payment page"
        >
          Open Payment
        </a>
      </Button>
    )
  }

  if (showBooking) {
    return (
      <Button
        size={size}
        disabled
        className={`bg-emerald-600 hover:bg-emerald-600 text-white ${className ?? ''}`}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Booking…
      </Button>
    )
  }

  // Idle — availability check was recent enough (≤30 min) to trust.
  // Stale checks are shown as disabled with an explanatory tooltip.
  // Disabled buttons don't fire mouse events, so we wrap in a span to
  // keep the title tooltip reachable.
  const staleTooltip =
    'Last check was more than 30 minutes ago — trigger a new check before attempting to book'

  const bookBtn = (
    <Button
      size={size}
      disabled={stale}
      className={`bg-emerald-600 hover:bg-emerald-700 text-white ${className ?? ''}`}
      onClick={stale ? undefined : e => {
        e.stopPropagation()
        mutation.mutate(job.id)
      }}
      title={stale ? undefined : (
        'Dispatch the hold worker now. Opens a headed browser to grab a '
        + '25-minute hold on every site in this job. You\'ll then complete '
        + 'payment in the /pay page.'
      )}
    >
      Attempt Booking
    </Button>
  )

  return stale ? (
    <span title={staleTooltip} className="cursor-not-allowed">
      {bookBtn}
    </span>
  ) : bookBtn
}

// ---------------------------------------------------------------------------
// PartialAvailabilityHelp
// ---------------------------------------------------------------------------
// Rendered next to the result list when a check found partial or mixed
// availability. Tells the user the "book partial" workflow: create a new
// watch job scoped down to the partial site(s) / smaller party, then Book
// that. The DOC cart can't mix party sizes across nights, so this is the
// only reliable way to land a partial booking.
export function PartialAvailabilityHelp() {
  return (
    <p className="text-xs text-muted-foreground leading-relaxed">
      Want to book what IS available?{' '}
      <span className="text-foreground">
        Create a new watch job scoped to just that site,
      </span>
      {' '}then hit <span className="font-medium">Book Now</span>{' '}
      on the new job. Note: The DOC cart can't mix party sizes across nights, so
      those watch jobs will have to be set separately too.
    </p>
  )
}
