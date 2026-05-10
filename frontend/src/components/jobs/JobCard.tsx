import { useMemo, useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  BadgeInfo,
  ArrowLeft,
  ImageIcon,
  LayoutDashboard,
  Loader2,
  Pause,
  Pencil,
  Play,
  Search,
  Stamp,
  Trash2,
} from 'lucide-react'
import {
  adaptersApi,
  jobsApi,
  occupantsApi,
  type WatchJob,
} from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
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
import { isJobOutdatedOnCampers } from '@/lib/occupantSnapshots'
import {
  getCompletedBookingArtifacts,
  getHoldFlowArtifacts,
  getReceiptArtifact,
  getUnavailableArtifact,
} from '@/lib/availabilityResults'
import {
  AutoBookBadge,
  NoSignInBadge,
} from '@/components/jobs/shared/AutoBookBadge'
import { OutdatedCampersNotice } from '@/components/jobs/shared/OutdatedCampers'
import { HeaderParamSummary } from '@/components/jobs/shared/HeaderParamSummary'
import { ArtifactGallery } from '@/components/jobs/results/ArtifactGallery'
import { LastResultView } from '@/components/jobs/results/LastResultView'
import { cn } from '@/lib/utils'

function formatRelativeTime(value: string | null): string {
  return formatRelativeTimeFromNow(value, {
    emptyLabel: 'Never checked',
    justNowLabel: 'just now',
    prefix: 'Checked',
  })
}



function MonitoringSection({
  job,
  displayStatus,
  onTrigger,
  triggerQueued,
  hideTrigger,
  hasOutdatedCampers,
  onEdit,
}: {
  job: WatchJob
  displayStatus: DisplayStatus
  onTrigger: () => void
  triggerQueued: boolean
  hideTrigger: boolean
  hasOutdatedCampers: boolean
  onEdit?: () => void
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

  const isOn = job.enable_monitoring

  useEffect(() => {
    if (hasOutdatedCampers && isOn && !mutation.isPending) {
      mutation.mutate(false)
    }
  }, [hasOutdatedCampers, isOn, mutation])

  if (
    displayStatus === 'booking_complete' ||
    displayStatus === 'cancelled' ||
    displayStatus === 'expired'
  )
    return null

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
  const countdownSeconds = isOn && job.next_check_at
    ? (new Date(job.next_check_at).getTime() - nowMs) / 1000
    : null
  const holdPausesMonitoring =
    displayStatus === 'hold_placed'
    || displayStatus === 'attempting_hold'
  const disableTrigger = holdPausesMonitoring || displayStatus === 'checking' || hasOutdatedCampers

  return (
    <section>
      <div className="rounded-[1.25rem] border border-border/70 bg-background/80 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground/70">
              Monitoring
            </h3>
            <AutoBookBadge job={job} />
            {!job.credentials_configured && <NoSignInBadge />}
          </div>
          <div className="flex items-center gap-1">
            {showToggle && (
              <Button
                size="sm"
                variant="outline"
                disabled={mutation.isPending || (hasOutdatedCampers && !isOn)}
                onClick={() => mutation.mutate(!isOn)}
              >
                {isOn
                  ? <><Pause className="size-3.5" /> Pause</>
                  : <><Play className="size-3.5" /> Resume</>
                }
              </Button>
            )}
            {onEdit && (
              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0 text-muted-foreground/50"
                onClick={onEdit}
              >
                <Pencil className="size-4" />
              </Button>
            )}
          </div>
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

export function JobCard({
  onRequestEdit,
  onOpenOccupants,
  onDeleted,
  onBack,
  backLabel = 'Back',
  className,
}: {
  onRequestEdit?: (job: WatchJob, step?: number) => void
  onOpenOccupants?: () => void
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
  const [editStep, setEditStep] = useState<number | undefined>(undefined)
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

  const handleEdit = (step?: number) => {
    if (onRequestEdit) {
      onRequestEdit(job, step)
      return
    }

    setEditStep(step)
    setEditOpen(true)
  }

  const displayStatus = getDisplayStatus(job, pendingBookings)
  const adapter = adapterById.get(job.adapter_id)
  const hasOutdatedCampers = isJobOutdatedOnCampers(job, occupants, adapter)
  const holdExpired = hasHoldExpired(job)
  const missingOccupants =
    !jobHasOccupants(job) &&
    job.status !== 'booking_complete' &&
    job.status !== 'cancelled' &&
    job.status !== 'expired'
  const missingCredentials =
    !job.credentials_configured &&
    job.status !== 'booking_complete' &&
    job.status !== 'cancelled' &&
    job.status !== 'expired'
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
        size="icon"
        variant="destructive"
        className="size-8"
        disabled={deleting}
        onClick={() => handleDelete(job.id, job.name)}
        title="Delete Hunt"
      >
        <Trash2 className="size-4" />
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
                <div className="flex min-w-0 items-center justify-center gap-1 pt-1">
                  {!isLocked && <span className="size-8 shrink-0" aria-hidden="true" />}
                  <CardTitle className="truncate text-lg tracking-tight sm:text-xl">
                    {job.name}
                  </CardTitle>
                  {!isLocked && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0 text-muted-foreground/50"
                      onClick={() => handleEdit(0)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap justify-end gap-2">
                  {actions}
                </div>
              </div>
              <CardDescription className="text-center text-sm leading-5">
                <HeaderParamSummary
                  params={job.params}
                  onEdit={!isLocked ? () => handleEdit(1) : undefined}
                  centered
                />
              </CardDescription>
            </>
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-xl tracking-tight">{job.name}</CardTitle>
                  {!isLocked && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 shrink-0 text-muted-foreground/50"
                      onClick={() => handleEdit(0)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  )}
                </div>
                <CardDescription className="mt-2 max-w-3xl text-sm leading-5">
                  <HeaderParamSummary
                    params={job.params}
                    onEdit={!isLocked ? () => handleEdit(1) : undefined}
                  />
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
            {hasOutdatedCampers && (
              <OutdatedCampersNotice
                onEditJob={handleEdit}
                onEditCampers={() => onOpenOccupants?.()}
              />
            )}
            {missingOccupants && (
              <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  <BadgeInfo className="inline-block size-5 mr-2 text-gray-400" />
                  Campers are required on this hunt before booking can start. Add them in Edit to enable auto-book and manual booking.
                </p>
              </div>
            )}
            {missingCredentials && (
              <div className="rounded-2xl border border-sky-500/25 bg-sky-500/8 px-4 py-3">
                <p className="text-sm text-muted-foreground flex items-center">
                  <BadgeInfo className="inline-block size-5 mr-2 h-full text-gray-400" />
                  A saved sign-in is required on this hunt before booking can start. Add it from Booking Site Sign-Ins in the header.
                </p>
              </div>
            )}

            <MonitoringSection
              job={job}
              displayStatus={displayStatus}
              onTrigger={() => trigger.mutate(job.id)}
              triggerQueued={queued}
              hideTrigger={hideTrigger}
              hasOutdatedCampers={hasOutdatedCampers}
              onEdit={!isLocked ? () => handleEdit(2) : undefined}
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
              && displayStatus !== 'checking'
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
                {jobHasPartialAvailability(job) && (
                  <div className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3">
                    <PartialAvailabilityHelp />
                  </div>
                )}
              </section>
            )}

            {job.status !== 'booking_complete' && !holdExpired && job.status !== 'hold_placed'
              && displayStatus !== 'booking' && displayStatus !== 'attempting_hold'
              && displayStatus !== 'checking'
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
              </section>
            )}
          </div>
        </CardContent>
      </Card>

      {!onRequestEdit && (
        <EditJobDialog
          open={editOpen}
          onOpenChange={(open) => {
            setEditOpen(open)
            if (!open) setEditStep(undefined)
          }}
          job={job}
          step={editStep}
        />
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
