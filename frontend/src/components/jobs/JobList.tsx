import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Clock3, Stamp } from 'lucide-react'
import { adaptersApi, type WatchJob } from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
import { getDisplayStatus } from '@/lib/availability'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/jobs/StatusBadge'
import { MonitoringBadge } from '@/components/jobs/MonitoringBadge'
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function getAdapterDisplayName(
  adapterId: string,
  adapterNameById: Map<string, string>,
): string {
  return adapterNameById.get(adapterId) ?? adapterId
}

function formatTimeAgo(value: string | null): string {
  if (!value) return 'Never'

  const diffMs = new Date(value).getTime() - Date.now()
  const diffSeconds = Math.round(diffMs / 1000)
  const absSeconds = Math.abs(diffSeconds)

  if (absSeconds < 45) return 'just now'

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['minute', 60],
    ['hour', 60 * 60],
    ['day', 60 * 60 * 24],
    ['week', 60 * 60 * 24 * 7],
    ['month', 60 * 60 * 24 * 30],
    ['year', 60 * 60 * 24 * 365],
  ]

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const [unit, unitSeconds] = units[index]
    if (absSeconds >= unitSeconds || unit === 'minute') {
      return relativeTimeFormatter.format(
        Math.round(diffSeconds / unitSeconds),
        unit,
      )
    }
  }

  return 'just now'
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatStartDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null

  const parts = value.split('/')
  if (parts.length !== 3) return value

  const [dd, mm, yyyy] = parts.map(Number)
  if ([dd, mm, yyyy].some(Number.isNaN)) return value

  const date = new Date(yyyy, mm - 1, dd)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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
  return trimmed || 'Untitled Job'
}

function getJobSubtitle(
  job: WatchJob,
  adapterDateFieldKeyById: Map<string, string>,
  adapterTrackFieldKeyById: Map<string, string>,
): string {
  const dateFieldKey = getDateFieldKey(job, adapterDateFieldKeyById)
  const trackFieldKey = getTrackFieldKey(job, adapterTrackFieldKeyById)
  const trackName = trackFieldKey ? String(job.params[trackFieldKey] ?? '').trim() : ''
  const startDate = dateFieldKey ? formatStartDate(job.params[dateFieldKey]) : null

  if (trackName && startDate) return `${trackName}, ${startDate}`
  if (trackName) return trackName
  if (startDate) return startDate
  return 'No track selected'
}

function formatCountLabel(value: unknown, singular: string, plural: string): string | null {
  const raw = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(raw) || raw <= 0) return null
  return `${raw} ${raw === 1 ? singular : plural}`
}

function getJobMetaLine(job: WatchJob): string {
  const nights = formatCountLabel(job.params.nights, 'Night', 'Nights')
  const people = formatCountLabel(job.params.people, 'Person', 'People')

  if (nights && people) return `${nights}, ${people}`
  if (nights) return nights
  if (people) return people
  return 'Party details not set'
}

export function JobList() {
  const { selectedJobId, setSelectedJobId, pendingBookings } = useJobsStore()
  const [collapsedAdapters, setCollapsedAdapters] = useState<Set<string>>(new Set())

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

  const adapterNameById = useMemo(
    () => new Map(adapters.map((adapter) => [adapter.adapter_id, adapter.name])),
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

  const groupedJobs = useMemo(() => {
    const groups = new Map<string, WatchJob[]>()

    for (const job of jobs) {
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
  }, [adapterNameById, jobs])

  const toggleAdapter = (adapterId: string) => {
    setCollapsedAdapters((current) => {
      const next = new Set(current)
      if (next.has(adapterId)) {
        next.delete(adapterId)
      } else {
        next.add(adapterId)
      }
      return next
    })
  }

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
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Clock3 className="h-5 w-5" />
        </div>
        <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
          No watch jobs yet
        </h3>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Create a job to start polling availability, store the result trail, and
          keep the booking path ready when space opens.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {groupedJobs.map((group) => {
        const isExpanded = !collapsedAdapters.has(group.adapterId)

        return (
          <section
            key={group.adapterId}
            className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-background/55"
          >
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 bg-secondary/55 px-4 py-4 text-left transition-colors hover:bg-secondary/70 sm:px-5"
              onClick={() => toggleAdapter(group.adapterId)}
            >
              <div className="min-w-0">
                <p className="truncate text-base font-semibold tracking-tight text-foreground">
                  {group.adapterName}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {group.jobs.length} job{group.jobs.length === 1 ? '' : 's'}
                </p>
              </div>
              <ChevronDown
                className={[
                  'h-5 w-5 shrink-0 text-muted-foreground transition-transform',
                  isExpanded ? 'rotate-180' : '',
                ].join(' ')}
              />
            </button>

            {isExpanded && (
              <div className="px-3 py-3 sm:px-4">
                <div className="grid gap-3 lg:hidden">
                  {group.jobs.map((job) => {
                    const displayStatus = getDisplayStatus(job, pendingBookings)
                    const isSelected = selectedJobId === job.id
                    const showStatusBadge = displayStatus !== 'checking'

                    return (
                      <button
                        key={job.id}
                        type="button"
                        className={[
                          'w-full rounded-[1.35rem] border px-4 py-4 text-left transition-all',
                          isSelected
                            ? 'border-primary/45 bg-primary/8 ring-2 ring-primary/20 shadow-[0_22px_55px_-34px_rgba(22,53,40,0.7)]'
                            : 'border-border/80 bg-background/75 hover:border-primary/20 hover:bg-background',
                        ].join(' ')}
                        onClick={() => setSelectedJobId(job.id)}
                      >
                        <div className="space-y-4">
                          <div className="space-y-1">
                            <h3 className="font-semibold tracking-tight text-foreground">
                              {getJobTitle(job)}
                            </h3>
                            <p className="font-mono text-xs tracking-wide text-muted-foreground">
                              {getJobSubtitle(job, adapterDateFieldKeyById, adapterTrackFieldKeyById)}
                            </p>
                            <p className="text-xs text-muted-foreground/85">
                              {getJobMetaLine(job)}
                            </p>
                          </div>

                          {showStatusBadge && (
                            <div>
                              <StatusBadge
                                status={displayStatus}
                                jobId={job.id}
                                artifactUrl={job.last_artifact_png}
                              />
                            </div>
                          )}

                          <div className="rounded-2xl bg-secondary/55 px-3 py-3 space-y-2">
                            {displayStatus === 'booking_complete' ? (
                              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <Stamp className="h-3.5 w-3.5 shrink-0" />
                                {formatDateTime(job.last_checked_at)}
                              </p>
                            ) : (
                              <>
                                <p className="text-sm text-muted-foreground">
                                  {formatTimeAgo(job.last_checked_at)}
                                </p>
                                <div>
                                  <MonitoringBadge job={job} displayStatus={displayStatus} />
                                </div>
                                <div>
                                  <Badge variant={job.auto_book ? 'default' : 'outline'}>
                                    {job.auto_book ? 'Auto-book' : 'Check only'}
                                  </Badge>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>

                <div className="hidden overflow-hidden rounded-[1.2rem] border border-border/70 lg:block">
                  <Table>
                    <TableHeader className="bg-secondary/60">
                      <TableRow className="border-border/80 hover:bg-secondary/60">
                        <TableHead className="w-[48%] pl-4">Job</TableHead>
                        <TableHead className="w-[32%]">Status</TableHead>
                        <TableHead className="pr-4">Last Checked</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.jobs.map((job) => {
                        const displayStatus = getDisplayStatus(job, pendingBookings)
                        const isSelected = selectedJobId === job.id
                        const showStatusBadge = displayStatus !== 'checking'

                        return (
                          <TableRow
                            key={job.id}
                            className={[
                              'cursor-pointer border-border/70 bg-background/60 transition-colors',
                              isSelected ? 'bg-primary/10 hover:bg-primary/10' : '',
                            ].join(' ')}
                            onClick={() => setSelectedJobId(job.id)}
                          >
                            <TableCell className={[
                              'relative w-[48%] pl-4 whitespace-normal align-top',
                              isSelected
                                ? 'pl-7 before:absolute before:top-3 before:bottom-3 before:left-2 before:w-1 before:rounded-full before:bg-primary'
                                : '',
                            ].join(' ')}
                            >
                              <div className="space-y-1">
                                <p className="font-medium tracking-tight text-foreground">
                                  {getJobTitle(job)}
                                </p>
                                <p className="font-mono text-xs tracking-wide text-muted-foreground">
                                  {getJobSubtitle(job, adapterDateFieldKeyById, adapterTrackFieldKeyById)}
                                </p>
                                <p className="text-xs text-muted-foreground/85">
                                  {getJobMetaLine(job)}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="w-[32%]">
                              <div className="flex h-full items-center justify-center">
                                {showStatusBadge && (
                                  <StatusBadge
                                    status={displayStatus}
                                    jobId={job.id}
                                    artifactUrl={job.last_artifact_png}
                                  />
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="pr-4 align-middle">
                              <div className="space-y-2">
                                {displayStatus === 'booking_complete' ? (
                                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                    <Stamp className="h-3.5 w-3.5 shrink-0" />
                                    {formatDateTime(job.last_checked_at)}
                                  </p>
                                ) : (
                                  <>
                                    <p className="text-sm text-muted-foreground">
                                      {formatTimeAgo(job.last_checked_at)}
                                    </p>
                                    <div>
                                      <MonitoringBadge job={job} displayStatus={displayStatus} />
                                    </div>
                                    <div>
                                      <Badge variant={job.auto_book ? 'default' : 'outline'}>
                                        {job.auto_book ? 'Auto-book' : 'Check only'}
                                      </Badge>
                                    </div>
                                  </>
                                )}
                              </div>
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
  )
}
