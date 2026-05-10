import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Clock3 } from 'lucide-react'
import { adaptersApi, jobsApi, occupantsApi, type WatchJob } from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
import { type DisplayStatus, getDisplayStatus } from '@/lib/availability'
import { TooltipProvider } from '../ui/Tooltip'
import { StatusBadge } from '@/components/jobs/StatusBadge'
import { MonitoringBadge } from '@/components/jobs/MonitoringBadge'
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
import { isJobOutdatedOnCampers } from '@/lib/occupantSnapshots'
import {
  type JobFilterKey,
  matchesJobFilters,
} from '@/components/jobs/jobFilters'
import {
  buildAdapterFieldMaps,
  getAdapterDisplayName,
  getJobMetaLine,
  getJobSubtitle,
  getJobTitle,
} from '@/components/jobs/jobParamDisplay'
import { AutoBookBadge } from '@/components/jobs/shared/AutoBookBadge'
import { OutdatedCampersIcon } from '@/components/jobs/shared/OutdatedCampers'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/Table'
import { formatDateTime, formatRelativeTimeFromNow } from '@/lib/time'
import { cn } from '@/lib/utils'

function formatTimeAgo(value: string | null): string {
  return formatRelativeTimeFromNow(value, { justNowLabel: 'just now' })
}

function JobIdentity({
  job,
  adapterDateFieldKeyById,
  adapterTrackFieldKeyById,
  hasOutdatedCampers,
}: {
  job: WatchJob
  adapterDateFieldKeyById: Map<string, string>
  adapterTrackFieldKeyById: Map<string, string>
  hasOutdatedCampers: boolean
}) {
  return (
    <div className="space-y-0.5">
      <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
        <span className="truncate">{getJobTitle(job)}</span>
        {hasOutdatedCampers && <OutdatedCampersIcon />}
      </p>
      <p className="text-xs tracking-tight text-muted-foreground/90">
        {getJobSubtitle(job, adapterDateFieldKeyById, adapterTrackFieldKeyById)}
      </p>
      <p className="text-xs text-muted-foreground/60">
        {getJobMetaLine(job)}
      </p>
    </div>
  )
}

function JobStatusMeta({
  job,
  displayStatus,
  showStatusBadge,
}: {
  job: WatchJob
  displayStatus: DisplayStatus
  showStatusBadge: boolean
}) {
  const isFinished =
    displayStatus === 'booking_complete' ||
    displayStatus === 'cancelled' ||
    displayStatus === 'expired'
  const checkedLabel = isFinished
    ? formatDateTime(job.last_checked_at)
    : formatTimeAgo(job.last_checked_at)
  const checkedPrefix = isFinished ? '' : 'Last checked'

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {showStatusBadge && (
          <StatusBadge
            status={displayStatus}
            jobId={job.id}
            cartExpiresAt={job.cart_expires_at}
            artifactUrl={job.last_artifact_png}
          />
        )}
      </div>
      <p className="text-xs leading-4 text-muted-foreground/75">
        {checkedPrefix} {checkedLabel}
      </p>
    </div>
  )
}

function JobAutomationMeta({
  job,
  displayStatus,
}: {
  job: WatchJob
  displayStatus: DisplayStatus
}) {
  if (
    displayStatus === 'booking_complete' ||
    displayStatus === 'cancelled' ||
    displayStatus === 'expired'
  ) {
    return null
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <AutoBookBadge job={job} />
      <MonitoringBadge job={job} displayStatus={displayStatus} />
    </div>
  )
}

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
  const [expandedAdapters, setExpandedAdapters] = useState<Set<string> | null>(null)
  const jobRefs = useRef(new Map<string, HTMLDivElement | HTMLTableRowElement>())
  const hasAutoScrolledRef = useRef(false)

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

  const filteredJobs = useMemo(
    () => jobs.filter((job) => matchesJobFilters(job, statusFilters, pendingBookings)),
    [jobs, pendingBookings, statusFilters],
  )

  const groupedJobs = useMemo(() => {
    const groups = new Map<string, WatchJob[]>()

    for (const job of filteredJobs) {
      const list = groups.get(job.adapter_id)
      if (list) {
        list.push(job)
      } else {
        groups.set(job.adapter_id, [job])
      }
    }

    return [...groups.entries()].map(([adapterId, adapterJobs]) => ({
      adapterId,
      adapterName: getAdapterDisplayName(adapterId, adapterNameById),
      jobs: adapterJobs,
    }))
  }, [adapterNameById, filteredJobs])

  const selectedGroupId = useMemo(
    () => groupedJobs.find((group) => group.jobs.some((job) => job.id === selectedJobId))?.adapterId ?? null,
    [groupedJobs, selectedJobId],
  )

  const effectiveExpandedAdapters = useMemo(() => {
    if (expandedAdapters) return expandedAdapters

    const defaultExpanded = collapseGroupsByDefault
      ? new Set<string>()
      : new Set(groupedJobs.map((group) => group.adapterId))

    if (selectedGroupId) {
      defaultExpanded.add(selectedGroupId)
    }

    return defaultExpanded
  }, [collapseGroupsByDefault, expandedAdapters, groupedJobs, selectedGroupId])

  const toggleAdapter = (adapterId: string) => {
    setExpandedAdapters((current) => {
      const next = new Set(
        current
        ?? effectiveExpandedAdapters,
      )

      if (next.has(adapterId)) {
        next.delete(adapterId)
      } else {
        next.add(adapterId)
      }

      return next
    })
  }

  const selectJob = (jobId: string) => {
    setSelectedJobId(jobId)
    hasAutoScrolledRef.current = false
    onJobSelect?.(jobId)
  }

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

  const setJobRef = (
    jobId: string,
    node: HTMLDivElement | HTMLTableRowElement | null,
  ) => {
    if (node) {
      jobRefs.current.set(jobId, node)
    } else {
      jobRefs.current.delete(jobId)
    }
  }

  useEffect(() => {
    if (!selectedJobId) {
      hasAutoScrolledRef.current = false
      return
    }

    const selectedNode = jobRefs.current.get(selectedJobId)
    if (!selectedNode || hasAutoScrolledRef.current) return

    hasAutoScrolledRef.current = true
    const timeoutId = window.setTimeout(() => {
      selectedNode.scrollIntoView({
        block: 'start',
        behavior: 'auto',
      })
    }, 40)

    return () => window.clearTimeout(timeoutId)
  }, [selectedJobId, effectiveExpandedAdapters, groupedJobs])

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-3xl border border-border/70 bg-muted/50"
          />
        ))}
      </div>
    )
  }

  if (!jobs.length) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border/80 bg-muted/25 px-6 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Clock3 className="size-5" />
        </div>
        <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
          No hunts yet
        </h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground text-pretty">
          Create a hunt to start checking availability, storing result history, and preparing the booking path when space opens.
        </p>
      </div>
    )
  }

  if (!filteredJobs.length) {
    const isFiltered = statusFilters.length > 0 && !statusFilters.includes('all')

    return (
      <div className="flex min-h-56 flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border/80 bg-muted/25 px-6 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Clock3 className="size-5" />
        </div>
        <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
          No matching hunts
        </h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground text-pretty">
          {isFiltered
            ? 'No hunts match the selected filters. Try adjusting or clearing them.'
            : 'No hunts available.'}
        </p>
      </div>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
      {groupedJobs.map((group) => {
        const isExpanded = effectiveExpandedAdapters.has(group.adapterId)

        return (
          <section
            key={group.adapterId}
            className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-background/55"
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 bg-secondary/50 px-4 py-3.5 text-left hover:bg-secondary/70 sm:px-5"
              onClick={() => toggleAdapter(group.adapterId)}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight text-foreground">
                  {group.adapterName}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {group.jobs.length} hunt{group.jobs.length === 1 ? '' : 's'}
                </p>
              </div>
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 text-muted-foreground',
                  isExpanded && 'rotate-180',
                )}
              />
            </button>

            {isExpanded && (
              <div className="px-3 py-3 sm:px-4">
                <div className="grid gap-3 lg:hidden">
                  {group.jobs.map((job) => {
                    const displayStatus = getDisplayStatus(job, pendingBookings)
                    const isSelected = selectedJobId === job.id
                    const showStatusBadge = displayStatus !== 'checking'
                    const adapter = adapterById.get(job.adapter_id)
                    const hasOutdatedCampers = isJobOutdatedOnCampers(job, occupants, adapter)

                    return (
                      <div
                        key={job.id}
                        role="button"
                        tabIndex={0}
                        data-job-id={job.id}
                        ref={(node) => setJobRef(job.id, node)}
                        className={cn(
                          'w-full cursor-pointer rounded-[1.35rem] border px-4 py-4 text-left transition-colors',
                          isSelected
                            ? 'border-primary/45 bg-primary/8 ring-2 ring-primary/20 shadow-[0_22px_55px_-34px_rgba(22,53,40,0.7)]'
                            : 'border-border/80 bg-background/75 hover:border-primary/20 hover:bg-background',
                        )}
                        onClick={() => selectJob(job.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            selectJob(job.id)
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-3">
                            <JobIdentity
                              job={job}
                              adapterDateFieldKeyById={adapterDateFieldKeyById}
                              adapterTrackFieldKeyById={adapterTrackFieldKeyById}
                              hasOutdatedCampers={hasOutdatedCampers}
                            />
                            {displayStatus !== 'booking_complete' &&
                              displayStatus !== 'cancelled' &&
                              displayStatus !== 'expired' && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <AutoBookBadge job={job} />
                                  <MonitoringBadge job={job} displayStatus={displayStatus} />
                                </div>
                              )}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5 text-right">
                            {showStatusBadge && (
                              <StatusBadge
                                status={displayStatus}
                                jobId={job.id}
                                cartExpiresAt={job.cart_expires_at}
                                artifactUrl={job.last_artifact_png}
                              />
                            )}
                            <p className="text-xs leading-4 text-muted-foreground/70">
                              {formatTimeAgo(job.last_checked_at)}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="hidden overflow-hidden rounded-[1.2rem] border border-border/70 lg:block">
                  <Table>
                    <TableHeader className="bg-secondary/60">
                      <TableRow className="border-border/80 hover:bg-secondary/60">
                        <TableHead className="w-[56%] pl-4 text-muted-foreground">Hunt</TableHead>
                        <TableHead className="w-[22%] text-muted-foreground">Automation</TableHead>
                        <TableHead className="pr-5 text-muted-foreground">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.jobs.map((job) => {
                        const displayStatus = getDisplayStatus(job, pendingBookings)
                        const isSelected = selectedJobId === job.id
                        const showStatusBadge = displayStatus !== 'checking'
                        const adapter = adapterById.get(job.adapter_id)
                        const hasOutdatedCampers = isJobOutdatedOnCampers(job, occupants, adapter)

                        return (
                          <TableRow
                            key={job.id}
                            data-job-id={job.id}
                            ref={(node) => setJobRef(job.id, node)}
                            className={cn(
                              'cursor-pointer border-border/70 bg-background/60',
                              isSelected && 'bg-primary/10 hover:bg-primary/10',
                            )}
                            onClick={() => selectJob(job.id)}
                          >
                            <TableCell
                              className={cn(
                                'relative w-[56%] whitespace-normal py-4 pl-4 pr-6 align-middle',
                                isSelected
                                  && 'pl-7 before:absolute before:top-3 before:bottom-3 before:left-2 before:w-1 before:rounded-full before:bg-primary',
                              )}
                            >
                              <JobIdentity
                                job={job}
                                adapterDateFieldKeyById={adapterDateFieldKeyById}
                                adapterTrackFieldKeyById={adapterTrackFieldKeyById}
                                hasOutdatedCampers={hasOutdatedCampers}
                              />
                            </TableCell>
                            <TableCell className="w-[22%] py-4 pr-5 align-middle">
                              <JobAutomationMeta job={job} displayStatus={displayStatus} />
                            </TableCell>
                            <TableCell className="py-4 pr-5 align-middle">
                              <JobStatusMeta
                                job={job}
                                displayStatus={displayStatus}
                                showStatusBadge={showStatusBadge}
                              />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </section>
        )
      })}
      </div>
    </TooltipProvider>
  )
}
