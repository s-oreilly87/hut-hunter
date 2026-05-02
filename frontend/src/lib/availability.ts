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

export function hasHoldExpired(job: WatchJob): boolean {
  if (job.status !== 'hold_placed' || !job.cart_expires_at) return false
  return new Date(job.cart_expires_at).getTime() <= Date.now()
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
