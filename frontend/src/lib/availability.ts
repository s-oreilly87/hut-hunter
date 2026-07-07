import type {
  AvailabilityResult, LastResultEntry, WatchJob,
} from '@/lib/api'

export type DisplayStatus =
  | 'booking'
  | 'attempting_hold'
  | 'hold_expired'
  | 'result_available'
  | 'result_partial'
  | 'result_unavailable'
  | 'result_hold_failed'
  | string  // JobStatus passthrough

/**
 * True once a parked cart's expiry has passed on the client clock — covers
 * both `hold_placed` (a secured hold awaiting payment) and, since THR-122,
 * `needs_attention` (a takeover session parked after an unexpected hold
 * failure) since both park the cart with the same expiry semantics and the
 * server doesn't push a status change the instant the countdown hits zero.
 */
export function hasHoldExpired(job: WatchJob): boolean {
  const isParked = job.status === 'hold_placed' || job.status === 'needs_attention'
  if (!isParked || !job.cart_expires_at) return false
  return new Date(job.cart_expires_at).getTime() <= Date.now()
}

export function jobHasOccupants(job: WatchJob): boolean {
  const occupants = job.params.occupants
  return Array.isArray(occupants) && occupants.length > 0
}

/**
 * A "live" job is one that is still actively tracked: not yet booked, not
 * cancelled, and not expired. Used as the gating predicate for monitoring,
 * outdated-camper checks, missing-occupants notices, etc.
 */
export function isLiveJob(job: WatchJob): boolean {
  return (
    job.status !== 'booking_complete'
    && job.status !== 'cancelled'
    && job.status !== 'expired'
  )
}

export function getDisplayStatus(
  job: WatchJob,
  pendingBookings: Set<string>,
): DisplayStatus {
  if (pendingBookings.has(job.id)) return 'booking'

  if (
    job.status === 'checking'
    && job.auto_book
    && jobAllFullyAvailable(job)
  ) {
    return 'attempting_hold'
  }

  if (hasHoldExpired(job)) {
    return 'hold_expired'
  }

  if (
    (job.status === 'paused' || job.status === 'waiting')
    && job.last_result?.length
  ) {
    const hasHoldFailed = job.last_result.some(
      e => typeof e === 'object' && e !== null && 'type' in e
        && (e as Record<string, unknown>).type === 'hold_failed',
    )
    if (hasHoldFailed) return 'result_hold_failed'

    const avail = job.last_result.filter(
      e => typeof e === 'object' && e !== null && 'status' in e,
    ) as AvailabilityResult[]

    if (avail.length > 0) {
      if (avail.every(r => r.status === 'available')) return 'result_available'
      if (avail.every(r => r.status === 'unavailable')) return 'result_unavailable'
      return 'result_partial'
    }
  }

  return job.status
}

function isFullyAvailable(entry: LastResultEntry): entry is AvailabilityResult {
  return (
    typeof entry === 'object'
    && entry !== null
    && 'status' in entry
    && (entry as AvailabilityResult).status === 'available'
  )
}

export function jobAllFullyAvailable(job: WatchJob): boolean {
  if (!job.last_result || !job.last_result.length) return false
  return job.last_result.every(isFullyAvailable)
}

export function jobHasPartialAvailability(job: WatchJob): boolean {
  if (!job.last_result || !job.last_result.length) return false
  const hasPartial = job.last_result.some(
    e => typeof e === 'object' && e !== null && 'status' in e
      && (e as AvailabilityResult).status === 'partially_available'
  )
  if (hasPartial) return true
  const hasAvailable = job.last_result.some(isFullyAvailable)
  const hasUnavailable = job.last_result.some(
    e => typeof e === 'object' && e !== null && 'status' in e
      && (e as AvailabilityResult).status === 'unavailable'
  )
  return hasAvailable && hasUnavailable
}
