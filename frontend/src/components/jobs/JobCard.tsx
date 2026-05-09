import { useMemo, useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
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
  adaptersApi,
  jobsApi,
  occupantsApi,
  type AvailabilityResult,
  type LastResultEntry,
  type WatchJob,
} from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/Card'
import { EditJobDialog } from '@/components/jobs/CreateJobDialog'
import {
  BookButton,
  PartialAvailabilityHelp,
} from '@/components/jobs/BookButton'
import {
  type DisplayStatus,
  getDisplayStatus,
  hasHoldExpired,
  jobHasPartialAvailability,
  jobHasOccupants,
} from '@/lib/availability'
import {
  formatCountdown,
  formatDateTime,
  formatRelativeTimeFromNow,
} from '@/lib/time'
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
import { getHeaderFields } from '@/components/jobs/jobParamDisplay'
import { jobHasOutdatedOccupantSnapshots } from '@/lib/occupantSnapshots'
import { cn } from '@/lib/utils'

function titleize(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatRelativeTime(value: string | null): string {
  return formatRelativeTimeFromNow(value, {
    emptyLabel: 'Never checked',
    justNowLabel: 'just now',
    prefix: 'Checked',
  })
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

  // Only include spot count when the summary text doesn't already state it
  // (people count is always in the summary, so never add it as a redundant detail)
  switch (entry.status) {
    case 'available':
      return {
        summary:
          totalAvailable != null && peopleWanted != null
            ? `${totalAvailable} spot${totalAvailable === 1 ? '' : 's'} cover the requested party of ${peopleWanted}.`
            : 'Availability is open for this site.',
        // Spot count is already in the summary when both values present; show when only total known
        details: totalAvailable != null && peopleWanted == null
          ? [`${totalAvailable} spot${totalAvailable === 1 ? '' : 's'} found`]
          : [],
      }
    case 'partially_available':
      return {
        summary:
          totalAvailable != null && peopleWanted != null
            ? `${totalAvailable} spot${totalAvailable === 1 ? '' : 's'} available — fewer than the requested ${peopleWanted}.`
            : 'Some capacity exists, but not enough for the full party.',
        details: totalAvailable != null && peopleWanted == null
          ? [`${totalAvailable} spot${totalAvailable === 1 ? '' : 's'} found`]
          : [],
      }
    case 'unavailable':
      return {
        summary:
          peopleWanted != null
            ? `Unavailable for a party of ${peopleWanted}.`
            : 'No availability was found for this site.',
        details: [],
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
        details: ['Check the underlying artifact if you need the raw page state.'],
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

function ArtifactLinkButton({
  href,
  icon: Icon,
  children,
}: {
  href: string
  icon: typeof ImageIcon
  children: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-foreground hover:bg-muted"
    >
      <Icon className="size-3.5" />
      {children}
    </a>
  )
}

function ArtifactActions({
  artifactPng,
  artifactHtml,
  borderClass = 'border-border/70',
}: {
  artifactPng?: string | null
  artifactHtml?: string | null
  borderClass?: string
}) {
  if (!artifactPng && !artifactHtml) return null

  return (
    <div className={`flex flex-wrap gap-1.5 border-t pt-3 ${borderClass}`}>
      {artifactPng && (
        <ArtifactLinkButton href={artifactPng} icon={ImageIcon}>
          Screenshot
        </ArtifactLinkButton>
      )}
      {artifactHtml && (
        <ArtifactLinkButton href={artifactHtml} icon={FileCode2}>
          HTML
        </ArtifactLinkButton>
      )}
    </div>
  )
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
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium tracking-tight text-foreground">
                Automation Error
              </p>
              <p className="text-sm leading-5 text-foreground/85">
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

          <ArtifactActions
            artifactPng={artifactPng}
            artifactHtml={artifactHtml}
            borderClass="border-destructive/15"
          />
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
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600">
          <XCircle className="size-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="font-medium tracking-tight text-foreground">
                Hold Failed
              </p>
              <p className="text-sm leading-5 text-foreground/85">
                {errorMsg}
              </p>
            </div>
            <Badge className="bg-rose-600 text-white hover:bg-rose-600">
              Hold Failed
            </Badge>
          </div>

          <ArtifactActions
            artifactPng={artifactPng}
            artifactHtml={artifactHtml}
            borderClass="border-rose-500/15"
          />
        </div>
      </div>
    </div>
  )
}

function LastResultView({
  result,
  artifactPng,
  artifactHtml,
  unavailableArtifact,
}: {
  result: LastResultEntry[]
  artifactPng?: string | null
  artifactHtml?: string | null
  unavailableArtifact?: ArtifactRecord | null
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
              <div className="flex items-start gap-3">
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${visual.iconClass}`}>
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium tracking-tight text-foreground">
                        {entry.site}
                      </p>
                      <p className="mt-1 text-sm leading-5 text-foreground/85">
                        {copy.summary}
                      </p>
                    </div>
                    <Badge
                      variant={entry.status === 'unknown' ? 'outline' : 'default'}
                      className={`shrink-0 ${visual.badgeClass}`}
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

                  {entry.status === 'unavailable' && unavailableArtifact && (
                    <ArtifactGallery artifacts={[unavailableArtifact]} />
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
  unavailable: 'Unavailable Snapshot',
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
              <span key={field.key} className={`inline-flex items-start gap-2 ${textClass}`}>
                <Icon className={`mt-0.5 shrink-0 ${field.isSubtitle ? 'size-3 text-foreground/45' : 'size-3.5 text-foreground/65'}`} />
                <span className="sr-only">{field.label}: </span>
                {field.tags ? (
                  <span className="flex flex-wrap gap-1">
                    {field.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground/75"
                      >
                        {tag}
                      </span>
                    ))}
                  </span>
                ) : field.href ? (
                  <a
                    href={field.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="hover:underline underline-offset-2 decoration-muted-foreground/40 hover:text-foreground"
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

function getUnavailableArtifact(artifacts: ArtifactRecord[] | null | undefined): ArtifactRecord | null {
  if (!artifacts?.length) return null
  return [...artifacts].reverse().find((artifact) => artifact.label === 'unavailable') ?? null
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

function getCompletedBookingArtifacts(
  holdArtifacts: ArtifactRecord[],
  receiptArtifact: ArtifactRecord | null,
): ArtifactRecord[] {
  if (!receiptArtifact) return holdArtifacts
  return [...holdArtifacts, receiptArtifact]
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
          className="overflow-hidden rounded-2xl border border-border/70 bg-background/80"
        >
          <div className="border-b border-border/70 px-3.5 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
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

          {artifact.html_url && (
            <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5">
              <ArtifactLinkButton href={artifact.html_url} icon={FileCode2}>
                HTML
              </ArtifactLinkButton>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

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
  const holdPausesMonitoring =
    displayStatus === 'hold_placed'
    || displayStatus === 'attempting_hold'
  const disableTrigger = holdPausesMonitoring || displayStatus === 'checking'

  return (
    <section>
      <div className="rounded-[1.25rem] border border-border/70 bg-background/80 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
              Monitoring
            </h3>
            {!job.credentials_configured ? (
              <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                No sign-in
              </Badge>
            ) : (
              <Badge variant={job.auto_book ? 'default' : 'outline'}>
                {job.auto_book ? 'Auto-book' : 'Notify only'}
              </Badge>
            )}
          </div>
          {showToggle && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(!isOn)}
            >
              {isOn
                ? <><Pause className="size-3.5" /> Pause</>
                : <><Play className="size-3.5" /> Resume</>
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
          {holdPausesMonitoring ? (
            <p>
              {displayStatus === 'hold_placed'
                ? 'Paused while the active hold waits for payment.'
                : 'Paused while Hut Hunter secures the hold.'}
            </p>
          ) : isOn && (
            <p>Every {job.interval_minutes} minutes</p>
          )}
        </div>

        {!hideTrigger && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={triggerQueued || disableTrigger}
              onClick={onTrigger}
            >
              {displayStatus === 'checking' ? (
                <><Loader2 className="size-3.5 animate-spin" /> Checking…</>
              ) : holdPausesMonitoring ? (
                <><Pause className="size-3.5" /> Check Now</>
              ) : triggerQueued ? (
                'Queued…'
              ) : countdownSeconds !== null ? (
                <><Search className="size-3.5" /> Check Now · <span className="tabular-nums">{formatCountdown(countdownSeconds)}</span></>
              ) : (
                <><Search className="size-3.5" /> Check Now</>
              )}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

function HoldExpiryCountdown({ cartExpiresAt }: { cartExpiresAt: string | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!cartExpiresAt) return undefined

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [cartExpiresAt])

  if (!cartExpiresAt) return null

  const countdownSeconds = Math.max(0, (new Date(cartExpiresAt).getTime() - nowMs) / 1000)

  return (
    <p className="mt-2 text-sm leading-5 text-muted-foreground">
      Time remaining to complete payment:{' '}
      <span className="font-medium tabular-nums text-foreground">
        {formatCountdown(countdownSeconds)}
      </span>
    </p>
  )
}

function OutdatedCampersNotice() {
  return (
    <section>
      <div className="rounded-[1.25rem] border border-amber-500/25 bg-amber-500/8 px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-700">
            <AlertTriangle className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-medium tracking-tight text-foreground">
              Camper Details Changed
            </p>
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
              Campers attached to this hunt have been edited since this job was created. To use the current campers and ensure all required fields are still filled out, save this job again to update the camper details.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export function JobCard({
  onRequestEdit,
  onDeleted,
  onBack,
  backLabel = 'Back',
  className,
}: {
  onRequestEdit?: (job: WatchJob) => void
  onDeleted?: () => void
  onBack?: () => void
  backLabel?: string
  className?: string
} = {}) {
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
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)

  const { data: job, isLoading } = useJobsQuery({
    select: (jobs) => jobs.find((candidate) => candidate.id === selectedJobId),
    enabled: !!selectedJobId,
  })

  const { data: adapters = [] } = useQuery({
    queryKey: ['adapters'],
    queryFn: adaptersApi.list,
  })

  const { data: occupants = [] } = useQuery({
    queryKey: ['occupants'],
    queryFn: occupantsApi.list,
  })

  const adapterById = useMemo(
    () => new Map(adapters.map((adapter) => [adapter.adapter_id, adapter])),
    [adapters],
  )

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
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      onDeleted?.()
    },
  })

  const handleDelete = (id: string, name: string) => {
    setDeleteTarget({ id, name })
  }

  if (!selectedJobId) {
    return (
      <Card className={cn('app-panel app-panel-frame gap-0 py-0 border-border/80 bg-card/85', className)}>
        <CardHeader className="pt-6 pb-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <LayoutDashboard className="size-5" />
          </div>
          <CardTitle className="mt-4 text-base font-semibold tracking-tight">
            Hunt details stay here
          </CardTitle>
          <CardDescription className="max-w-md text-sm leading-5 text-pretty">
            Select any hunt to inspect its inputs, latest availability
            evidence, and booking controls.
          </CardDescription>
        </CardHeader>
        <CardContent className="app-panel-body-scroll px-6">
          <div className="grid gap-3 pt-6 pb-6">
            <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/40 px-4 py-4">
              <p className="text-sm font-medium text-foreground">What you get here</p>
              <p className="mt-1.5 text-sm leading-5 text-pretty text-muted-foreground">
                Stored inputs, current state, latest automation result, and artifact links in one focused view.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <Card className={cn('app-panel app-panel-frame gap-0 py-0 border-border/80 bg-card/85', className)}>
        <CardContent className="app-panel-body-scroll px-6">
          <div className="grid gap-3 pt-6 pb-6">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-20 animate-pulse rounded-2xl bg-muted/60"
              />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!job) return null

  const handleEdit = () => {
    if (onRequestEdit) {
      onRequestEdit(job)
      return
    }

    setEditOpen(true)
  }

  const displayStatus = getDisplayStatus(job, pendingBookings)
  const adapter = adapterById.get(job.adapter_id)
  const hasOutdatedCampers = Boolean(
    adapter && jobHasOutdatedOccupantSnapshots(job, occupants, adapter),
  )
  const holdExpired = hasHoldExpired(job)
  const missingOccupants = !jobHasOccupants(job)
  const missingCredentials = !job.credentials_configured
  const hideTrigger =
    job.status === 'booking_complete'
    || job.status === 'expired'
    || displayStatus === 'booking'
    || displayStatus === 'attempting_hold'
  const queued = optimisticTriggers.has(job.id)
  const deleting = remove.isPending
  const isLocked = job.status === 'booking_complete'
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
  const completedArtifacts = getCompletedBookingArtifacts(holdArtifacts, receiptArtifact)
  const unavailableArtifact = getUnavailableArtifact(job.artifact_history)
  const actions = (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={isLocked}
        onClick={handleEdit}
      >
        <Settings2 className="size-4" />
        Edit
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={deleting}
        onClick={() => handleDelete(job.id, job.name)}
      >
        <Trash2 className="size-4" />
        {deleting ? 'Deleting...' : 'Delete'}
      </Button>
    </>
  )

  return (
    <>
      <Card className={cn('app-panel app-panel-frame gap-0 py-0 border-border/80 bg-card/90', className)}>
        <CardHeader className="shrink-0 gap-4 border-b border-border/70 pt-6 pb-5">
          {onBack ? (
            <>
              <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-3">
                <div className="min-w-0">
                  <Button size="sm" variant="ghost" className="-ml-2 w-fit" onClick={onBack}>
                    <ArrowLeft className="size-4" />
                    {backLabel}
                  </Button>
                </div>
                <div className="min-w-0 pt-1 text-center">
                  <CardTitle className="truncate text-lg tracking-tight sm:text-xl">
                    {job.name}
                  </CardTitle>
                </div>
                <div className="flex min-w-0 flex-wrap justify-end gap-2">
                  {actions}
                </div>
              </div>
              <CardDescription className="text-center text-sm leading-5">
                <HeaderParamSummary params={job.params} />
              </CardDescription>
            </>
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <CardTitle className="text-xl tracking-tight">{job.name}</CardTitle>
                <CardDescription className="mt-2 max-w-3xl text-sm leading-5">
                  <HeaderParamSummary params={job.params} />
                </CardDescription>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {actions}
              </div>
            </div>
          )}
        </CardHeader>

        <CardContent className="app-panel-body-scroll px-6">
          <div className="space-y-6 pt-6 pb-6">
            {hasOutdatedCampers && <OutdatedCampersNotice />}

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
                  <Stamp className="size-4 text-primary" />
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
                    Booking Complete
                  </h3>
                </div>
                <div className="rounded-[1.25rem] border border-emerald-500/25 bg-emerald-500/8 px-4 py-4">
                  <p className="text-sm text-muted-foreground">
                    Booking flow completed at {formatDateTime(job.last_checked_at)}
                  </p>
                </div>
                {completedArtifacts.length > 0 && <ArtifactGallery artifacts={completedArtifacts} />}
              </section>
            )}

            {job.status === 'hold_placed' && !holdExpired && (
              <section className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="size-4 text-primary" />
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
                      Complete Payment
                    </h3>
                  </div>
                  <BookButton job={job} className="w-full sm:w-auto" size="default" />
                </div>
                <div className="rounded-[1.25rem] border border-amber-500/25 bg-amber-500/8 px-4 py-4">
                  <p className="text-base font-medium tracking-tight text-foreground">
                    The hold is active and waiting for payment.
                  </p>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">
                    Review the captured cart stages below if you want to confirm the itinerary before paying.
                  </p>
                  <HoldExpiryCountdown cartExpiresAt={job.cart_expires_at} />
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

            {holdExpired && (
              <section className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-primary" />
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
                      Hold Expired
                    </h3>
                  </div>
                  <BookButton job={job} className="w-full sm:w-auto" size="default" />
                </div>
                <div className="rounded-[1.25rem] border border-zinc-500/25 bg-zinc-500/8 px-4 py-4">
                  <p className="text-base font-medium tracking-tight text-foreground">
                    The 25-minute payment window has closed.
                  </p>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground">
                    You can attempt the hold again from here, or run a fresh check first if you want to reconfirm availability.
                  </p>
                </div>
                {holdArtifacts.length > 0 ? (
                  <ArtifactGallery artifacts={holdArtifacts} />
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/80 bg-secondary/40 px-4 py-4">
                    <p className="text-sm text-muted-foreground">
                      No cart-stage snapshots are available from the expired hold.
                    </p>
                  </div>
                )}
              </section>
            )}

            {job.status !== 'booking_complete' && !holdExpired && job.status !== 'hold_placed' && (
              displayStatus === 'booking' || displayStatus === 'attempting_hold'
            ) && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <LayoutDashboard className="size-4 text-primary" />
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
                    Last Result
                  </h3>
                </div>
                <div className="rounded-[1.25rem] border border-amber-500/25 bg-amber-500/8 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-700">
                      <Loader2 className="size-5 animate-spin" />
                    </div>
                    <div>
                      <p className="font-medium tracking-tight text-foreground">Booking in progress</p>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        Attempting to secure your hold…
                      </p>
                    </div>
                  </div>
                </div>
                {job.last_result && (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Latest availability that triggered the booking attempt:
                    </p>
                    <LastResultView
                      result={job.last_result}
                      artifactPng={job.last_artifact_png}
                      artifactHtml={job.last_artifact_html}
                      unavailableArtifact={unavailableArtifact}
                    />
                    {jobHasPartialAvailability(job) && (
                      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
                        <PartialAvailabilityHelp />
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {job.status !== 'booking_complete' && !holdExpired && job.status !== 'hold_placed'
              && displayStatus !== 'booking' && displayStatus !== 'attempting_hold'
              && job.last_result && (
              <section className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <LayoutDashboard className="size-4 text-primary" />
                      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
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
                  unavailableArtifact={unavailableArtifact}
                />
                {missingOccupants && (
                  <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
                    <p className="text-sm text-muted-foreground">
                      Campers are required on this hunt before booking can start. Add them in Edit to enable auto-book and manual booking.
                    </p>
                  </div>
                )}
                {missingCredentials && (
                  <div className="rounded-2xl border border-sky-500/25 bg-sky-500/8 px-4 py-3">
                    <p className="text-sm text-muted-foreground">
                      A saved sign-in is required on this hunt before booking can start. Add it from Booking Site Sign-Ins in the header.
                    </p>
                  </div>
                )}
                {jobHasPartialAvailability(job) && (
                  <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
                    <PartialAvailabilityHelp />
                  </div>
                )}
              </section>
            )}

            {job.status !== 'booking_complete' && !holdExpired && job.status !== 'hold_placed'
              && displayStatus !== 'booking' && displayStatus !== 'attempting_hold'
              && !job.last_result && (
              <section className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-2">
                      <LayoutDashboard className="size-4 text-primary" />
                      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
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
                    No automation result has been stored for this hunt yet.
                  </p>
                </div>
                {missingOccupants && (
                  <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
                    <p className="text-sm text-muted-foreground">
                      Campers are required on this hunt before booking can start. Add them in Edit to enable auto-book and manual booking.
                    </p>
                  </div>
                )}
                {missingCredentials && (
                  <div className="rounded-2xl border border-sky-500/25 bg-sky-500/8 px-4 py-3">
                    <p className="text-sm text-muted-foreground">
                      A saved sign-in is required on this hunt before booking can start. Add it from Booking Site Sign-Ins in the header.
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>
        </CardContent>
      </Card>

      {!onRequestEdit && (
        <EditJobDialog open={editOpen} onOpenChange={setEditOpen} job={job} />
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteTarget(null)
        }}
        title="Delete Hunt"
        description={
          deleteTarget
            ? `Delete "${deleteTarget.name}"? This removes the hunt, booking state, and saved artifacts. You can't undo this.`
            : ''
        }
        confirmLabel="Delete Hunt"
        confirming={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id)
        }}
      />
    </>
  )
}
