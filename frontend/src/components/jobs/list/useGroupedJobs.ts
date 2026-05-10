import { useMemo } from 'react'
import type { WatchJob } from '@/lib/api'
import {
  type JobFilterKey,
  matchesJobFilters,
} from '@/components/jobs/jobFilters'
import { getAdapterDisplayName } from '@/components/jobs/jobParamDisplay'

export interface JobGroup {
  adapterId: string
  adapterName: string
  jobs: WatchJob[]
}

export interface UseGroupedJobsResult {
  filteredJobs: WatchJob[]
  groups: JobGroup[]
}

/**
 * Filters jobs by the active status filters and groups the result by
 * adapter id, preserving the order in which groups first appear in the
 * filtered list.
 */
export function useGroupedJobs({
  jobs,
  statusFilters,
  pendingBookings,
  adapterNameById,
}: {
  jobs: WatchJob[]
  statusFilters: JobFilterKey[]
  pendingBookings: Set<string>
  adapterNameById: Map<string, string>
}): UseGroupedJobsResult {
  const filteredJobs = useMemo(
    () => jobs.filter((job) => matchesJobFilters(job, statusFilters, pendingBookings)),
    [jobs, pendingBookings, statusFilters],
  )

  const groups = useMemo(() => {
    const byAdapter = new Map<string, WatchJob[]>()

    for (const job of filteredJobs) {
      const list = byAdapter.get(job.adapter_id)
      if (list) {
        list.push(job)
      } else {
        byAdapter.set(job.adapter_id, [job])
      }
    }

    return [...byAdapter.entries()].map(([adapterId, adapterJobs]) => ({
      adapterId,
      adapterName: getAdapterDisplayName(adapterId, adapterNameById),
      jobs: adapterJobs,
    }))
  }, [adapterNameById, filteredJobs])

  return { filteredJobs, groups }
}
