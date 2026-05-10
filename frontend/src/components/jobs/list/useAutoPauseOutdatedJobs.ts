import { useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { jobsApi, type AdapterInfo, type Occupant, type WatchJob } from '@/lib/api'
import { isJobOutdatedOnCampers } from '@/lib/occupantSnapshots'

/**
 * Whenever the jobs list changes, scan for any monitoring-enabled job whose
 * stored camper snapshots have drifted out of sync with the current camper
 * roster. Auto-pause the first one we find and let the next refetch trigger
 * the next pass.
 *
 * The "one at a time" loop is intentional: pausing a job invalidates the
 * jobs query, which re-runs this effect with the freshly paused state.
 */
export function useAutoPauseOutdatedJobs(
  jobs: WatchJob[],
  occupants: Occupant[],
  adapterById: Map<string, AdapterInfo>,
) {
  const qc = useQueryClient()

  const pauseJob = useMutation({
    mutationFn: (id: string) => jobsApi.update(id, { enable_monitoring: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })

  useEffect(() => {
    if (pauseJob.isPending) return

    for (const job of jobs) {
      if (!job.enable_monitoring) continue
      const adapter = adapterById.get(job.adapter_id)
      if (isJobOutdatedOnCampers(job, occupants, adapter)) {
        pauseJob.mutate(job.id)
        break
      }
    }
  }, [jobs, occupants, adapterById, pauseJob])
}
