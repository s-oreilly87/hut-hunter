import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import { jobsApi, type WatchJob } from '@/lib/api'

export const JOBS_QUERY_KEY = ['jobs'] as const
export const JOBS_POLL_INTERVAL_MS = 5_000

type JobsQueryOptions<TData> = Omit<
  UseQueryOptions<WatchJob[], Error, TData, typeof JOBS_QUERY_KEY>,
  'queryKey' | 'queryFn'
>

export function useJobsQuery<TData = WatchJob[]>(
  options?: JobsQueryOptions<TData>,
) {
  return useQuery({
    queryKey: JOBS_QUERY_KEY,
    queryFn: jobsApi.list,
    refetchInterval: JOBS_POLL_INTERVAL_MS,
    ...options,
  })
}
