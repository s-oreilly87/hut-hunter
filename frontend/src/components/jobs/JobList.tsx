import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, Clock3 } from 'lucide-react'
import { adaptersApi, jobsApi, occupantsApi, type WatchJob } from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
import { type DisplayStatus, getDisplayStatus } from '@/lib/availability'
import { Badge } from '../ui/Badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/Tooltip'
import { StatusBadge } from '@/components/jobs/StatusBadge'
import { MonitoringBadge } from '@/components/jobs/MonitoringBadge'
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
import { jobHasOutdatedOccupantSnapshots } from '@/lib/occupantSnapshots'
import {
  type JobFilterKey,
  matchesJobFilters,
} from '@/components/jobs/jobFilters'
import {
  formatCountLabel,
  formatDateLabel,
  parseFacilityOption,
} from '@/components/jobs/jobParamDisplay'
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

function getAdapterDisplayName(
  adapterId: string,
  adapterNameById: Map<string, string>,
): string {
  return adapterNameById.get(adapterId) ?? adapterId
}

function formatTimeAgo(value: string | null): string {
  return formatRelativeTimeFromNow(value, { justNowLabel: 'just now' })
}

function getDateFieldKey(
  job: WatchJob,
  adapterDateFieldKeyById: Map<string, string>,
): string | null {
  return adapterDateFieldKeyById.get(job.adapter_id) ?? ('date' in job.params ? 'date' : null)
}

function getTrackFieldKey(
  job: WatchJob,
  adapterTrackFieldKeyById: Map<string, string>,
): string | null {
  return adapterTrackFieldKeyById.get(job.adapter_id) ?? ('track' in job.params ? 'track' : null)
}

function getJobTitle(job: WatchJob): string {
  const trimmed = job.name.trim()
  return trimmed || 'Untitled Hunt'
}

function getJobSubtitle(
  job: WatchJob,
  adapterDateFieldKeyById: Map<string, string>,
  adapterTrackFieldKeyById: Map<string, string>,
): string {
  const dateFieldKey = getDateFieldKey(job, adapterDateFieldKeyById)

  const facilityStr = typeof job.params.facility === 'string' ? job.params.facility.trim() : ''
  if (facilityStr) {
    const parsedFacility = parseFacilityOption(facilityStr)
    const facilityName = parsedFacility?.facilityName ?? facilityStr
    const startDate = dateFieldKey ? formatDateLabel(job.params[dateFieldKey]) : null
    if (facilityName && startDate) return `${facilityName}, ${startDate}`
    if (facilityName) return facilityName
  }

  const trackFieldKey = getTrackFieldKey(job, adapterTrackFieldKeyById)
  const trackName = trackFieldKey ? String(job.params[trackFieldKey] ?? '').trim() : ''
  const startDate = dateFieldKey ? formatDateLabel(job.params[dateFieldKey]) : null

  if (trackName && startDate) return `${trackName}, ${startDate}`
  if (trackName) return trackName
  if (startDate) return startDate
  return 'No track selected'
}

function getJobMetaLine(job: WatchJob): string {
  const nights = formatCountLabel(job.params.nights, 'Night', 'Nights')
  const people = formatCountLabel(job.params.people, 'Person', 'People')

  if (nights && people) return `${nights}, ${people}`
  if (nights) return nights
  if (people) return people
  return 'Party details not set'
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
        {hasOutdatedCampers && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-amber-700"
                onClick={(event) => event.stopPropagation()}
                aria-label="Camper details changed"
                tabIndex={0}
              >
                <AlertTriangle className="size-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Campers attached to this hunt have been edited since this job was created. Save this job again to update the camper details.
            </TooltipContent>
          </Tooltip>
        )}
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

function AutoBookBadge({ job }: { job: WatchJob }) {
  const isAutoBook = job.auto_book && job.credentials_configured
  return (
    <Badge variant={isAutoBook ? 'default' : 'outline'}>
      {isAutoBook ? 'Auto-book' : 'Notify only'}
    </Badge>
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

  const adapterNameById = useMemo(
    () => new Map(adapters.map((adapter) => [adapter.adapter_id, adapter.name])),
    [adapters],
  )

  const adapterById = useMemo(
    () => new Map(adapters.map((adapter) => [adapter.adapter_id, adapter])),
    [adapters],
  )

  const adapterDateFieldKeyById = useMemo(
    () => new Map(
      adapters.flatMap((adapter) => {
        const dateField = adapter.param_fields.find((field) => field.type === 'date')
        return dateField ? [[adapter.adapter_id, dateField.key] as const] : []
      }),
    ),
    [adapters],
  )

  const adapterTrackFieldKeyById = useMemo(
    () => new Map(
      adapters.flatMap((adapter) => {
        const trackField = adapter.param_fields.find(
          (field) => field.key === 'track' || field.label.toLowerCase() === 'track',
        )
        return trackField ? [[adapter.adapter_id, trackField.key] as const] : []
      }),
    ),
    [adapters],
  )

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
      if (job.status === 'booking_complete' || job.status === 'cancelled' || job.status === 'expired') continue

      const adapter = adapterById.get(job.adapter_id)
      if (adapter && jobHasOutdatedOccupantSnapshots(job, occupants, adapter)) {
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
                    const hasOutdatedCampers = Boolean(
                      job.status !== 'booking_complete' &&
                        job.status !== 'cancelled' &&
                        job.status !== 'expired' &&
                        adapter &&
                        jobHasOutdatedOccupantSnapshots(job, occupants, adapter),
                    )

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
                        const hasOutdatedCampers = Boolean(
                          job.status !== 'booking_complete' &&
                            job.status !== 'cancelled' &&
                            job.status !== 'expired' &&
                            adapter &&
                            jobHasOutdatedOccupantSnapshots(job, occupants, adapter),
                        )

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
