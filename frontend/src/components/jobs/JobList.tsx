import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adaptersApi, occupantsApi } from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
import { TooltipProvider } from '../ui/Tooltip'
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
import { type JobFilterKey } from '@/components/jobs/jobFilters'
import { buildAdapterFieldMaps } from '@/components/jobs/jobParamDisplay'
import { JobGroupSection } from '@/components/jobs/list/JobGroupSection'
import {
  JobListEmptyState,
  JobListLoadingSkeleton,
} from '@/components/jobs/list/JobListEmptyStates'
import { useAutoPauseOutdatedJobs } from '@/components/jobs/list/useAutoPauseOutdatedJobs'
import { useExpandedAdapters } from '@/components/jobs/list/useExpandedAdapters'
import { useGroupedJobs } from '@/components/jobs/list/useGroupedJobs'
import { useScrollSelectedIntoView } from '@/components/jobs/list/useScrollSelectedIntoView'

/**
 * Top-level list of all hunts, grouped by booking site.
 *
 * This component is mostly orchestration: it fetches the data, wires up the
 * shared hooks (auto-pause, scroll-into-view, expanded-groups), and renders
 * the resulting JobGroupSection list. The row-level UI lives in `./list/`.
 */
export function JobList({
  collapseGroupsByDefault = false,
  onJobSelect,
  statusFilters = [],
}: {
  collapseGroupsByDefault?: boolean
  onJobSelect?: (jobId: string) => void
  statusFilters?: JobFilterKey[]
} = {}) {
  const { selectedJobId, setSelectedJobId, pendingBookings } = useJobsStore()

  const { data: jobs = [], isLoading } = useJobsQuery({
    select: (data) =>
      [...data].sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
  })

  const { data: adapters = [] } = useQuery({
    queryKey: ['adapters'],
    queryFn: adaptersApi.list,
  })

  const { data: occupants = [] } = useQuery({
    queryKey: ['occupants'],
    queryFn: occupantsApi.list,
  })

  const {
    nameById: adapterNameById,
    byId: adapterById,
    dateFieldKeyById: adapterDateFieldKeyById,
    trackFieldKeyById: adapterTrackFieldKeyById,
  } = useMemo(() => buildAdapterFieldMaps(adapters), [adapters])

  const { filteredJobs, groups } = useGroupedJobs({
    jobs,
    statusFilters,
    pendingBookings,
    adapterNameById,
  })

  const { effectiveExpandedAdapters, toggleAdapter } = useExpandedAdapters({
    groups,
    selectedJobId,
    collapseGroupsByDefault,
  })

  useAutoPauseOutdatedJobs(jobs, occupants, adapterById)

  const { setJobRef, markJobSelected } = useScrollSelectedIntoView(
    selectedJobId,
    [effectiveExpandedAdapters, groups],
  )

  const selectJob = (jobId: string) => {
    setSelectedJobId(jobId)
    markJobSelected()
    onJobSelect?.(jobId)
  }

  if (isLoading) {
    return <JobListLoadingSkeleton />
  }

  if (!jobs.length) {
    return <JobListEmptyState variant="no-jobs" />
  }

  if (!filteredJobs.length) {
    const isFiltered = statusFilters.length > 0 && !statusFilters.includes('all')
    return (
      <JobListEmptyState variant={isFiltered ? 'no-matches' : 'no-matches-unfiltered'} />
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {groups.map((group) => (
          <JobGroupSection
            key={group.adapterId}
            group={group}
            isExpanded={effectiveExpandedAdapters.has(group.adapterId)}
            onToggle={toggleAdapter}
            selectedJobId={selectedJobId}
            pendingBookings={pendingBookings}
            occupants={occupants}
            adapterById={adapterById}
            adapterDateFieldKeyById={adapterDateFieldKeyById}
            adapterTrackFieldKeyById={adapterTrackFieldKeyById}
            onSelectJob={selectJob}
            setMobileRef={setJobRef}
            setDesktopRef={setJobRef}
          />
        ))}
      </div>
    </TooltipProvider>
  )
}
