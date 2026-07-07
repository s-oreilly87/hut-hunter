import type { WatchJob } from '@/lib/api'
import { getDisplayStatus, hasHoldExpired, isLiveJob } from '@/lib/availability'

export type JobFilterKey =
  | 'all'
  | 'active'
  | 'ready'
  | 'holds'
  | 'watching'
  | 'booking_complete'
  | 'cancelled'
  | 'expired'

export interface JobFilterDefinition {
  key: JobFilterKey
  label: string
  emptyLabel: string
  matches: (job: WatchJob, pendingBookings: Set<string>) => boolean
}

// Re-export so consumers that already import from this module keep working.
export { isLiveJob }

export const JOB_FILTERS: JobFilterDefinition[] = [
  {
    key: 'all',
    label: 'All',
    emptyLabel: 'No hunts available yet.',
    matches: () => true,
  },
  {
    key: 'active',
    label: 'Active',
    emptyLabel: 'No active hunts right now.',
    matches: (job) => isLiveJob(job),
  },
  {
    key: 'ready',
    label: 'Ready',
    emptyLabel: 'No hunts are fully available right now.',
    matches: (job, pendingBookings) => getDisplayStatus(job, pendingBookings) === 'result_available',
  },
  {
    key: 'holds',
    label: 'Holds',
    emptyLabel: 'No hunts are holding inventory right now.',
    // THR-122: needs_attention also has a live cart parked (just waiting on
    // a human instead of payment), so it belongs in "Holds" too.
    matches: (job) => (
      (job.status === 'hold_placed' || job.status === 'needs_attention') && !hasHoldExpired(job)
    ),
  },
  {
    key: 'watching',
    label: 'Watching',
    emptyLabel: 'No hunts are on an automatic schedule.',
    matches: (job) => job.enable_monitoring && isLiveJob(job),
  },
  {
    key: 'booking_complete',
    label: 'Booked',
    emptyLabel: 'No completed bookings yet.',
    matches: (job) => job.status === 'booking_complete',
  },
  {
    key: 'cancelled',
    label: 'Cancelled',
    emptyLabel: 'No cancelled hunts.',
    matches: (job) => job.status === 'cancelled',
  },
  {
    key: 'expired',
    label: 'Expired',
    emptyLabel: 'No expired hunts.',
    matches: (job) => job.status === 'expired',
  },
]

export function getJobFilterDefinition(filterKey: JobFilterKey): JobFilterDefinition {
  return JOB_FILTERS.find((filter) => filter.key === filterKey) ?? JOB_FILTERS[0]
}

export function matchesJobFilter(
  job: WatchJob,
  filterKey: JobFilterKey,
  pendingBookings: Set<string>,
): boolean {
  return getJobFilterDefinition(filterKey).matches(job, pendingBookings)
}

export function matchesJobFilters(
  job: WatchJob,
  filterKeys: JobFilterKey[],
  pendingBookings: Set<string>,
): boolean {
  if (!filterKeys.length || filterKeys.includes('all')) return true
  return filterKeys.some((key) => matchesJobFilter(job, key, pendingBookings))
}
