import type { WatchJob } from '@/lib/api'
import { getDisplayStatus, hasHoldExpired } from '@/lib/availability'

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

export function isLiveJob(job: WatchJob): boolean {
  return (
    job.status !== 'booking_complete'
    && job.status !== 'cancelled'
    && job.status !== 'expired'
  )
}

export const JOB_FILTERS: JobFilterDefinition[] = [
  {
    key: 'all',
    label: 'All',
    emptyLabel: 'No jobs available yet.',
    matches: () => true,
  },
  {
    key: 'active',
    label: 'Active',
    emptyLabel: 'No active jobs right now.',
    matches: (job) => isLiveJob(job),
  },
  {
    key: 'ready',
    label: 'Ready',
    emptyLabel: 'No jobs are fully available right now.',
    matches: (job, pendingBookings) => getDisplayStatus(job, pendingBookings) === 'result_available',
  },
  {
    key: 'holds',
    label: 'Holds',
    emptyLabel: 'No jobs are holding inventory right now.',
    matches: (job) => job.status === 'hold_placed' && !hasHoldExpired(job),
  },
  {
    key: 'watching',
    label: 'Watching',
    emptyLabel: 'No jobs are on an automatic monitoring schedule.',
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
    emptyLabel: 'No cancelled jobs.',
    matches: (job) => job.status === 'cancelled',
  },
  {
    key: 'expired',
    label: 'Expired',
    emptyLabel: 'No expired jobs.',
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
