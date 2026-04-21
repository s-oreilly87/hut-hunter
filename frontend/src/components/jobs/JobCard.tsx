import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  FileCode2,
  ImageIcon,
  LayoutDashboard,
  Loader2,
  Pause,
  Play,
  Search,
  Settings2,
  Stamp,
  Trash2,
  XCircle,
} from 'lucide-react'
import {
  type ArtifactRecord,
  jobsApi,
  type AvailabilityResult,
  type LastResultEntry,
  type WatchJob,
} from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { StatusBadge } from '@/components/jobs/StatusBadge'
import { EditJobDialog } from '@/components/jobs/CreateJobDialog'
import {
  BookButton,
  PartialAvailabilityHelp,
} from '@/components/jobs/BookButton'
import {
  type DisplayStatus,
  getDisplayStatus,
  jobHasPartialAvailability,
} from '@/lib/availability'
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
import { getHeaderFields } from '@/components/jobs/jobParamDisplay'

function titleize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function formatRelativeTime(value: string | null): string {
  if (!value) return 'Never checked'

  const diffSeconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
  const absSeconds = Math.abs(diffSeconds)

  if (absSeconds < 45) return 'Checked just now'

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['minute', 60],
    ['hour', 60 * 60],
    ['day', 60 * 60 * 24],
    ['week', 60 * 60 * 24 * 7],
  ]

  for (let index = units.length - 1; index >= 0; index -= 1) {
    const [unit, unitSeconds] = units[index]
    if (absSeconds >= unitSeconds || unit === 'minute') {
      return `Checked ${relativeTimeFormatter.format(
        Math.round(diffSeconds / unitSeconds),
        unit,
      )}`
    }
  }

  return 'Checked just now'
}

function parseAvailabilityEvidence(evidence: string): {
  totalAvailable: number | null
  peopleWanted: number | null
} {
  const totalMatch = evidence.match(/total=([0-9]+|None|null)/i)
  const peopleMatch = evidence.match(/peopleWanted=([0-9]+)/i)

  const totalAvailable = totalMatch
    ? (/none|null/i.test(totalMatch[1]) ? null : Number(totalMatch[1]))
    : null
  const peopleWanted = peopleMatch ? Number(peopleMatch[1]) : null

  return {
    totalAvailable: Number.isFinite(totalAvailable) ? totalAvailable : null,
    peopleWanted: Number.isFinite(peopleWanted) ? peopleWanted : null,
  }
}

function getAvailabilityVisual(status: AvailabilityResult['status']) {
  switch (status) {
    case 'available':
      return {
        icon: CheckCircle2,
        tileClass: 'border-emerald-500/25 bg-emerald-500/8',
        iconClass: 'bg-emerald-500/12 text-emerald-700',
        badgeClass: 'bg-emerald-600 text-white hover:bg-emerald-600',
      }
    case 'partially_available':
      return {
        icon: AlertTriangle,
        tileClass: 'border-amber-500/25 bg-amber-500/10',
        iconClass: 'bg-amber-500/12 text-amber-700',
        badgeClass: 'bg-amber-500 text-white hover:bg-amber-500',
      }
    case 'unavailable':
      return {
        icon: XCircle,
        tileClass: 'border-rose-500/25 bg-rose-500/8',
        iconClass: 'bg-rose-500/12 text-rose-700',
        badgeClass: 'bg-rose-600 text-white hover:bg-rose-600',
      }
    default:
      return {
        icon: CircleHelp,
        tileClass: 'border-border/70 bg-background/80',
        iconClass: 'bg-secondary text-muted-foreground',
        badgeClass: '',
      }
  }
}

function getAvailabilityCopy(entry: AvailabilityResult): {
  summary: string
  details: string[]
} {
  const parsed = parseAvailabilityEvidence(entry.evidence)
  const totalAvailable = entry.total_available ?? parsed.totalAvailable
  const peopleWanted = parsed.peopleWanted
  const details: string[] = []

  if (totalAvailable != null) {
    details.push(`${totalAvailable} spot${totalAvailable === 1 ? '' : 's'} found`)
  }
  if (peopleWanted != null) {
    details.push(`Party of ${peopleWanted}`)
  }

  switch (entry.status) {
    case 'available':
      return {
        summary:
          totalAvailable != null && peopleWanted != null
            ? `${totalAvailable} spots cover the requested party of ${peopleWanted}.`
            : 'Availability is open for this site.',
        details,
      }
    case 'partially_available':
      return {
        summary:
          totalAvailable != null && peopleWanted != null
            ? `${totalAvailable} spots are available, which is fewer than the requested ${peopleWanted}.`
            : 'Some capacity exists, but not enough for the full party.',
        details,
      }
    case 'unavailable':
      return {
        summary:
          peopleWanted != null
            ? `No spots are available for the requested party of ${peopleWanted}.`
            : 'No availability was found for this site.',
        details,
      }
    default:
      if (entry.evidence.includes('not found in results table')) {
        return {
          summary: 'This site did not appear in the returned results.',
          details: ['The latest search did not include this stop.'],
        }
      }
      if (entry.evidence.includes('No cell found')) {
        return {
          summary: 'The availability table was missing the expected date cell.',
          details: ['The returned page shape did not match the requested site and date.'],
        }
      }
      return {
        summary: 'Availability could not be classified from the latest check.',
        details: details.length ? details : ['Check the underlying artifact if you need the raw page state.'],
      }
  }
}

function formatResultValue(value: unknown): string {
  if (value == null) return 'Not provided'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || 'Not provided'
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function GenericResultView({
  entry,
  artifactPng,
  artifactHtml,
}: {
  entry: Record<string, unknown>
  artifactPng?: string | null
  artifactHtml?: string | null
}) {
  const primaryMessage = typeof entry.error === 'string'
    ? entry.error
    : typeof entry.message === 'string'
      ? entry.message
      : null
  const detailEntries = Object.entries(entry).filter(([key]) =>
    key !== 'error' && key !== 'message',
  )

  return (
    <div className="rounded-[1.25rem] border border-destructive/30 bg-destructive/5 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium tracking-tight text-foreground">
                Worker Error
              </p>
              <p className="text-sm leading-6 text-foreground/85">
                {primaryMessage ?? 'The latest run returned an unstructured error payload.'}
              </p>
            </div>
            <Badge variant="destructive">Needs Review</Badge>
          </div>

          {detailEntries.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {detailEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-2xl border border-destructive/15 bg-background/70 px-3 py-3"
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {titleize(key)}
                  </p>
                  <p className="mt-1 wrap-break-word text-sm text-foreground">
                    {formatResultValue(value)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {(artifactPng || artifactHtml) && (
            <div className="flex flex-wrap gap-2 border-t border-destructive/15 pt-4">
              {artifactPng && (
                <a
                  href={artifactPng}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <ImageIcon className="h-4 w-4" />
                  Screenshot
                </a>
              )}
              {artifactHtml && (
                <a
                  href={artifactHtml}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <FileCode2 className="h-4 w-4" />
                  HTML
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function isAvailabilityResult(entry: LastResultEntry): entry is AvailabilityResult {
  return (
    typeof entry === 'object'
    && entry !== null
    && 'site' in entry
    && 'status' in entry
  )
}

function isHoldFailedEntry(entry: LastResultEntry): entry is Record<string, unknown> & { type: 'hold_failed' } {
  return (
    typeof entry === 'object'
    && entry !== null
    && 'type' in entry
    && (entry as Record<string, unknown>).type === 'hold_failed'
  )
}

function HoldFailedView({
  entry,
  artifactPng,
  artifactHtml,
}: {
  entry: Record<string, unknown>
  artifactPng?: string | null
  artifactHtml?: string | null
}) {
  const errorMsg = typeof entry.error === 'string'
    ? entry.error
    : 'The hold attempt did not complete successfully.'

  return (
    <div className="rounded-[1.25rem] border border-rose-500/30 bg-rose-500/5 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600">
          <XCircle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium tracking-tight text-foreground">
                Hold Failed
              </p>
              <p className="text-sm leading-6 text-foreground/85">
                {errorMsg}
              </p>
            </div>
            <Badge className="bg-rose-600 text-white hover:bg-rose-600">
              Hold Failed
            </Badge>
          </div>

          {(artifactPng || artifactHtml) && (
            <div className="flex flex-wrap gap-2 border-t border-rose-500/15 pt-3">
              {artifactPng && (
                <a
                  href={artifactPng}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <ImageIcon className="h-4 w-4" />
                  Screenshot
                </a>
              )}
              {artifactHtml && (
                <a
                  href={artifactHtml}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <FileCode2 className="h-4 w-4" />
                  HTML
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LastResultView({
  result,
  artifactPng,
  artifactHtml,
}: {
  result: LastResultEntry[]
  artifactPng?: string | null
  artifactHtml?: string | null
}) {
  if (!result.length) {
    return <p className="text-sm text-muted-foreground">No results captured yet.</p>
  }

  return (
    <div className="space-y-3">
      {result.map((entry, index) => {
        if (isAvailabilityResult(entry)) {
          const visual = getAvailabilityVisual(entry.status)
          const copy = getAvailabilityCopy(entry)
          const Icon = visual.icon

          return (
            <div
              key={index}
              className={`rounded-[1.25rem] border px-4 py-4 ${visual.tileClass}`}
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${visual.iconClass}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium tracking-tight text-foreground">
                        {entry.site}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-foreground/85">
                        {copy.summary}
                      </p>
                    </div>
                    <Badge
                      variant={entry.status === 'unknown' ? 'outline' : 'default'}
                      className={visual.badgeClass}
                    >
                      {titleize(entry.status)}
                    </Badge>
                  </div>

                  {copy.details.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {copy.details.map((detail) => (
                        <span
                          key={detail}
                          className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground"
                        >
                          {detail}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        }

        if (isHoldFailedEntry(entry)) {
          return (
            <HoldFailedView
              key={index}
              entry={entry as Record<string, unknown>}
              artifactPng={artifactPng}
              artifactHtml={artifactHtml}
            />
          )
        }

        return (
          <GenericResultView
            key={index}
            entry={entry as Record<string, unknown>}
            artifactPng={artifactPng}
            artifactHtml={artifactHtml}
          />
        )
      })}
    </div>
  )
}

const ARTIFACT_LABELS: Record<string, string> = {
  reservation_details: 'Reservation Details',
  shopping_cart: 'Shopping Cart',
  payment_page_success: 'Payment Page',
  booking_complete: 'Receipt',
  book_great_walk_timeout: 'Book Great Walk Timeout',
  shopping_cart_timeout: 'Shopping Cart Timeout',
  payment_page_timeout: 'Payment Page Timeout',
}

function formatArtifactLabel(label: string): string {
  return ARTIFACT_LABELS[label] ?? titleize(label)
}

function HeaderParamSummary({
  params,
}: {
  params: Record<string, unknown>
}) {
  const fields = getHeaderFields(params)

  if (!fields.length) {
    return (
      <span className="text-sm text-muted-foreground">
        No booking parameters stored.
      </span>
    )
  }

  const facilityFields = fields.filter((field) => field.key === 'facility' || field.key === 'facility_park')
  const primaryFields = fields.filter((field) => field.key === 'track' || field.key === 'date')
  const secondaryFields = fields.filter(
    (field) => field.key === 'nights' || field.key === 'people' || field.key === 'direction',
  )
  const tertiaryFields = fields.filter((field) => field.key === 'sites')
  const rows = [facilityFields, primaryFields, secondaryFields, tertiaryFields].filter((row) => row.length > 0)

  return (
    <div className="space-y-1.5">
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm leading-5 text-muted-foreground"
        >
          {row.map((field) => {
            const Icon = field.icon
            const textClass = field.isSubtitle ? 'text-xs text-muted-foreground/70' : ''

            return (
              <span key={field.key} className={`inline-flex items-center gap-2 ${textClass}`}>
                <Icon className={field.isSubtitle ? 'h-3 w-3 text-foreground/45' : 'h-3.5 w-3.5 text-foreground/65'} />
                <span className="sr-only">{field.label}: </span>
                {field.href ? (
                  <a
                    href={field.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="hover:underline underline-offset-2 decoration-muted-foreground/40 transition-colors hover:text-foreground"
                  >
                    {field.value}
                  </a>
                ) : (
                  <span>{field.value}</span>
                )}
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function getReceiptArtifact(artifacts: ArtifactRecord[] | null | undefined): ArtifactRecord | null {
  if (!artifacts?.length) return null
  return [...artifacts].reverse().find((artifact) => artifact.label === 'booking_complete') ?? null
}

function getHoldFlowArtifacts(artifacts: ArtifactRecord[] | null | undefined): ArtifactRecord[] {
  if (!artifacts?.length) return []

  const orderedLabels = [
    'reservation_details',
    'shopping_cart',
  ]

  const relevant = artifacts.filter((artifact) => orderedLabels.includes(artifact.label))
  if (!relevant.length) return []

  return orderedLabels.flatMap((label) =>
    relevant.filter((artifact) => artifact.label === label),
  )
}

function ArtifactGallery({
  artifacts,
}: {
  artifacts: ArtifactRecord[]
}) {
  if (!artifacts.length) return null

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {artifacts.map((artifact, index) => (
        <div
          key={`${artifact.label}:${artifact.png_url}:${index}`}
          className="overflow-hidden rounded-[1.25rem] border border-border/70 bg-background/80"
        >
          <div className="border-b border-border/70 px-4 py-3">
            <p className="text-sm font-medium tracking-tight text-foreground">
              {formatArtifactLabel(artifact.label)}
            </p>
          </div>

          {artifact.png_url && (
            <a
              href={artifact.png_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-muted/40"
            >
              <img
                src={artifact.png_url}
                alt={formatArtifactLabel(artifact.label)}
                className="aspect-[4/3] w-full object-cover"
                loading="lazy"
              />
            </a>
          )}

          <div className="flex flex-wrap gap-2 px-4 py-3">
            {artifact.png_url && (
              <a
                href={artifact.png_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <ImageIcon className="h-4 w-4" />
                Screenshot
              </a>
            )}
            {artifact.html_url && (
              <a
                href={artifact.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <FileCode2 className="h-4 w-4" />
                HTML
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  )
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

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const mm = Math.floor(s / 60).toString().padStart(2, '0')
  const ss = (s % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

// ---------------------------------------------------------------------------
// MonitoringSection — always rendered at the top of the JobCard body.
// Shows last-checked time, auto-book state, monitoring toggle, interval, live
// countdown, and the Check Now trigger button.
// ---------------------------------------------------------------------------
function MonitoringSection({
  job,
  displayStatus,
  onTrigger,
  triggerQueued,
  hideTrigger,
}: {
  job: WatchJob
  displayStatus: DisplayStatus
  onTrigger: () => void
  triggerQueued: boolean
  hideTrigger: boolean
}) {
  const qc = useQueryClient()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const mutation = useMutation({
    mutationFn: (next: boolean) => jobsApi.update(job.id, { enable_monitoring: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  })

  if (displayStatus === 'booking_complete') return null

  // Terminal and transient states — toggle is not user-actionable.
  const isTerminal = (
    displayStatus === 'cancelled'
    || displayStatus === 'expired'
  )
  const isTransient = (
    displayStatus === 'checking'
    || displayStatus === 'attempting_hold'
    || displayStatus === 'hold_placed'
    || displayStatus === 'booking'
  )
  const showToggle = !isTerminal && !isTransient

  const isOn = job.enable_monitoring
  const countdownSeconds = isOn && job.next_check_at
    ? (new Date(job.next_check_at).getTime() - nowMs) / 1000
    : null

  return (
    <section>
      <div className="rounded-[1.25rem] border border-border/70 bg-background/80 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Monitoring
            </h3>
            <Badge variant={job.auto_book ? 'default' : 'outline'}>
              {job.auto_book ? 'Auto-book' : 'Check only'}
            </Badge>
          </div>
          {showToggle && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(!isOn)}
            >
              {isOn
                ? <><Pause className="h-3.5 w-3.5" /> Pause</>
                : <><Play className="h-3.5 w-3.5" /> Resume</>
              }
            </Button>
          )}
        </div>

        <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
          {displayStatus === 'checking' ? (
            <p>Checking now…</p>
          ) : (
            <p>{formatRelativeTime(job.last_checked_at)}</p>
          )}
          {isOn && (
            <p>Every {job.interval_minutes} min</p>
          )}
        </div>

        {!hideTrigger && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={triggerQueued || displayStatus === 'checking'}
              onClick={onTrigger}
            >
              {displayStatus === 'checking' ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…</>
              ) : triggerQueued ? (
                'Queued…'
              ) : countdownSeconds !== null ? (
                <><Search className="h-3.5 w-3.5" /> Check Now · <span className="tabular-nums">{formatCountdown(countdownSeconds)}</span></>
              ) : (
                <><Search className="h-3.5 w-3.5" /> Check Now</>
              )}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

export function JobCard() {
  const queryClient = useQueryClient()
  const {
    selectedJobId,
    setSelectedJobId,
    markTriggered,
    clearTriggered,
    optimisticTriggers,
    pendingBookings,
  } = useJobsStore()
  const [editOpen, setEditOpen] = useState(false)

  const { data: job, isLoading } = useJobsQuery({
    select: (jobs) => jobs.find((candidate) => candidate.id === selectedJobId),
    enabled: !!selectedJobId,
  })

  const trigger = useMutation({
    mutationFn: jobsApi.trigger,
    onMutate: (id: string) => markTriggered(id),
    onSettled: (_, __, id) => {
      clearTriggered(id)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })

  const remove = useMutation({
    mutationFn: jobsApi.remove,
    onSuccess: (_, id) => {
      if (selectedJobId === id) setSelectedJobId(null)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })

  const handleDelete = (id: string, name: string) => {
    if (
      !window.confirm(
        `Delete "${name}"?\n\nThis removes the job and its booking state. You can't undo this.`,
      )
    ) {
      return
    }

    remove.mutate(id)
  }

  if (!selectedJobId) {
    return (
      <Card className="app-panel border-border/80 bg-card/85">
        <CardHeader className="pb-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <CardTitle className="mt-4 text-xl tracking-tight">
            Job details stay here
          </CardTitle>
          <CardDescription className="max-w-md text-sm leading-6">
            Pick any watch job to inspect adapter params, the latest availability
            evidence, and the booking controls tied to that workflow.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 pb-6">
          <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/40 px-4 py-4">
            <p className="text-sm font-medium text-foreground">What you get here</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The selected job shows its stored inputs, current state, latest worker
              result, and artifact links in one place so the list can stay lightweight.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <Card className="app-panel border-border/80 bg-card/85">
        <CardContent className="grid gap-3 px-6 py-6">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-20 animate-pulse rounded-2xl bg-muted/60"
            />
          ))}
        </CardContent>
      </Card>
    )
  }

  if (!job) return null

  const displayStatus = getDisplayStatus(job, pendingBookings)
  const hideTrigger =
    job.status === 'booking_complete'
    || job.status === 'expired'
    || displayStatus === 'booking'
    || displayStatus === 'attempting_hold'
  const queued = optimisticTriggers.has(job.id)
  const deleting = remove.isPending
  const showStatusBadge = displayStatus !== 'paused' && displayStatus !== 'checking'
  const receiptArtifact = getReceiptArtifact(job.artifact_history) ?? (
    job.status === 'booking_complete' && job.last_artifact_png && job.last_artifact_html
      ? {
          label: 'booking_complete',
          png_url: job.last_artifact_png,
          html_url: job.last_artifact_html,
        }
      : null
  )
  const holdArtifacts = getHoldFlowArtifacts(job.artifact_history)

  return (
    <>
      <Card className="app-panel border-border/80 bg-card/90">
        <CardHeader className="gap-4 border-b border-border/70 pb-5">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {showStatusBadge && (
                  <StatusBadge
                    status={displayStatus}
                    jobId={job.id}
                    artifactUrl={job.last_artifact_png}
                  />
                )}
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                  <Settings2 className="h-4 w-4" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleting}
                  onClick={() => handleDelete(job.id, job.name)}
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>

            <div className="min-w-0">
              <CardTitle className="text-xl tracking-tight">{job.name}</CardTitle>
              <CardDescription className="mt-2 max-w-3xl text-sm leading-5">
                <HeaderParamSummary params={job.params} />
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 px-6 py-6">
          <MonitoringSection
            job={job}
            displayStatus={displayStatus}
            onTrigger={() => trigger.mutate(job.id)}
            triggerQueued={queued}
            hideTrigger={hideTrigger}
          />

          {job.status === 'booking_complete' && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Stamp className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Booking Complete
                </h3>
              </div>
              <div className="rounded-[1.25rem] border border-emerald-500/25 bg-emerald-500/8 px-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Booking flow completed at {formatDateTime(job.last_checked_at)}
                </p>
              </div>
              {receiptArtifact && <ArtifactGallery artifacts={[receiptArtifact]} />}
            </section>
          )}

          {job.status === 'hold_placed' && (
            <section className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Complete Payment
                  </h3>
                </div>
                <BookButton job={job} className="w-full sm:w-auto" size="default" />
              </div>
              <div className="rounded-[1.25rem] border border-amber-500/25 bg-amber-500/8 px-4 py-4">
                <p className="text-base font-medium tracking-tight text-foreground">
                  The hold is active and waiting for payment.
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Review the captured cart stages below if you want to confirm the itinerary before paying.
                </p>
              </div>
              {holdArtifacts.length > 0 ? (
                <ArtifactGallery artifacts={holdArtifacts} />
              ) : (
                <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/40 px-4 py-4">
                  <p className="text-sm text-muted-foreground">
                    No cart-stage snapshots are available for this hold yet.
                  </p>
                </div>
              )}
            </section>
          )}

          {job.status !== 'booking_complete' && job.status !== 'hold_placed' && (
            displayStatus === 'booking' || displayStatus === 'attempting_hold'
          ) && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Last Result
                </h3>
              </div>
              <div className="rounded-[1.25rem] border border-amber-500/25 bg-amber-500/8 px-4 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-700">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                  <div>
                    <p className="font-medium tracking-tight text-foreground">Booking in progress</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Attempting to secure your hold…
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {job.status !== 'booking_complete' && job.status !== 'hold_placed'
            && displayStatus !== 'booking' && displayStatus !== 'attempting_hold'
            && job.last_result && (
            <section className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <LayoutDashboard className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Latest Result
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatRelativeTime(job.last_checked_at)}
                  </p>
                </div>
                <BookButton job={job} className="w-full sm:w-auto" size="default" />
              </div>
              <LastResultView
                result={job.last_result}
                artifactPng={job.last_artifact_png}
                artifactHtml={job.last_artifact_html}
              />
              {jobHasPartialAvailability(job) && (
                <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
                  <PartialAvailabilityHelp />
                </div>
              )}
            </section>
          )}

          {job.status !== 'booking_complete' && job.status !== 'hold_placed'
            && displayStatus !== 'booking' && displayStatus !== 'attempting_hold'
            && !job.last_result && (
            <section className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <LayoutDashboard className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Latest Result
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatRelativeTime(job.last_checked_at)}
                  </p>
                </div>
                <BookButton job={job} className="w-full sm:w-auto" size="default" />
              </div>
              <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/40 px-4 py-4">
                <p className="text-sm text-muted-foreground">
                  No worker result has been stored for this job yet.
                </p>
              </div>
            </section>
          )}
        </CardContent>
      </Card>

      <EditJobDialog open={editOpen} onOpenChange={setEditOpen} job={job} />
    </>
  )
}
