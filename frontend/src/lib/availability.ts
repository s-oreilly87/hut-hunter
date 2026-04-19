// Availability classification helpers derived from a WatchJob's last_result.
//
// Lives outside the BookButton component file so both BookButton and its
// callers (JobCard, JobList) can import these without tripping the
// react-refresh/only-export-components lint rule.

import type {
  AvailabilityResult, LastResultEntry, WatchJob,
} from '@/lib/api'

// ---------------------------------------------------------------------------
// DisplayStatus — the visual status shown in the UI, which may differ from
// the raw backend job.status:
//
//   booking         — user clicked Attempt Booking, hold worker running
//                     (backend shows "checking" but context is different)
//   result_available    — paused after a check; every site fully available
//   result_partial      — paused after a check; some partial/mixed results
//   result_unavailable  — paused after a check; nothing available
//
// All other values are the raw JobStatus strings passed through unchanged.
// ---------------------------------------------------------------------------

export type DisplayStatus =
  | 'booking'
  | 'result_available'
  | 'result_partial'
  | 'result_unavailable'
  | string  // JobStatus passthrough

export function getDisplayStatus(
  job: WatchJob,
  pendingBookings: Set<string>,
): DisplayStatus {
  // Hold attempt in flight — show "Booking" regardless of backend status
  if (pendingBookings.has(job.id)) return 'booking'

  // Paused with results — derive from what the last check found
  if (job.status === 'paused' && job.last_result?.length) {
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

// A last_result entry counts as fully-available availability info when it's
// the AvailabilityResult shape and its status is "available". Error-shaped
// entries (e.g. {error: "..."}) fail both checks.
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

// Partial means "something is bookable but we can't book it as one cart" —
// i.e. at least one partial, OR a mix of available + unavailable.
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
