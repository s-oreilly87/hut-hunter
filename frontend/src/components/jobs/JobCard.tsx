import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import {
  adaptersApi,
  jobsApi,
  occupantsApi,
  type WatchJob,
} from '@/lib/api'
import { useJobsStore } from '@/store/jobs'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Card, CardContent } from '../ui/Card'
import { EditJobDialog } from '@/components/jobs/CreateJobDialog'
import {
  getDisplayStatus,
  hasHoldExpired,
  isLiveJob,
  jobHasOccupants,
} from '@/lib/availability'
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
import { isJobOutdatedOnCampers } from '@/lib/occupantSnapshots'
import {
  getCompletedBookingArtifacts,
  getHoldFlowArtifacts,
  getReceiptArtifact,
  getUnavailableArtifact,
} from '@/lib/availabilityResults'
import { OutdatedCampersNotice } from '@/components/jobs/shared/OutdatedCampers'
import {
  JobCardEmptySelection,
  JobCardLoadingSkeleton,
} from '@/components/jobs/card/JobCardPlaceholder'
import { JobCardHeader } from '@/components/jobs/card/JobCardHeader'
import { MonitoringSection } from '@/components/jobs/card/MonitoringSection'
import {
  FailedCredentialsNotice,
  ManualBookingOnlyNotice,
  MissingCredentialsNotice,
  MissingOccupantsNotice,
} from '@/components/jobs/card/JobBlockingNotices'
import { BookingCompleteSection } from '@/components/jobs/card/BookingCompleteSection'
import { HoldActiveSection } from '@/components/jobs/card/HoldActiveSection'
import { HoldExpiredSection } from '@/components/jobs/card/HoldExpiredSection'
import { NeedsAttentionSection } from '@/components/jobs/card/NeedsAttentionSection'
import { BookingInProgressSection } from '@/components/jobs/card/BookingInProgressSection'
import { LatestResultSection } from '@/components/jobs/card/LatestResultSection'
import { HeaderParamSummary } from '@/components/jobs/shared/HeaderParamSummary'
import { cn } from '@/lib/utils'

const MOBILE_FLAT_CARD_CLASSES = 'max-sm:rounded-none max-sm:border-x-0 max-sm:border-t-0 max-sm:border-b-0 max-sm:shadow-none max-sm:ring-0 max-sm:backdrop-blur-none'

/**
 * Detail panel for a single job.
 *
 * This is mostly orchestration: select the active job, derive a small bag
 * of UI flags from its status, route the body into the right per-status
 * section component, and own the edit / delete dialogs that float on top.
 *
 * Lifecycle is driven by `selectedJobId` from the jobs store. If `onRequestEdit`
 * is provided, the parent renders the edit dialog/page (the pages do this);
 * otherwise we mount one inline.
 */
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

  // Hold expiry (hasHoldExpired below) is a pure time comparison — the
  // server doesn't push a status change the instant a cart hold's countdown
  // hits zero, so without this tick the section gating below would only
  // re-evaluate when the jobs query itself refetches new data (or the user
  // reselects the job), leaving HoldActiveSection on screen well past
  // expiry. Ticking once a second forces this component to re-render so
  // `holdExpired` flips on time, matching the per-second countdowns already
  // rendered by HoldExpiryCountdown/StatusBadge/MonitoringSection.
  const [, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

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

  if (!selectedJobId) {
    return <JobCardEmptySelection className={className} />
  }

  if (isLoading) {
    return <JobCardLoadingSkeleton className={className} />
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
  const isLocked = job.status === 'booking_complete'
  const isLive = isLiveJob(job)
  // Watch/notify-only sites can't book at all, so the "…required before
  // booking can start" nudges don't apply — a single explanatory notice
  // replaces them.
  const manualBookingOnly = !job.supports_automated_booking
  const missingOccupants = !jobHasOccupants(job) && isLive && !manualBookingOnly
  // credentials_configured is false for both "no credential" and "failed
  // verification" (THR-123) — credentials_failed disambiguates so each gets
  // its own notice.
  const missingCredentials = !job.credentials_configured && !job.credentials_failed && isLive && !manualBookingOnly
  const failedCredentials = job.credentials_failed && isLive && !manualBookingOnly

  // ── Section gating ──
  // The body sections are mutually exclusive on `job.status` / displayStatus;
  // these booleans capture the routing so the JSX below stays readable.
  const isBookingComplete = job.status === 'booking_complete'
  const showHoldActive = job.status === 'hold_placed' && !holdExpired
  // THR-122: needs_attention parks the session the same way a successful
  // hold does (same cart, same countdown) — it just renders different copy
  // pointing at the takeover flow instead of payment.
  const showNeedsAttention = job.status === 'needs_attention' && !holdExpired
  const isMidBookingFlow =
    displayStatus === 'booking' || displayStatus === 'attempting_hold'
  const isSettled =
    !isBookingComplete
    && !showHoldActive
    && !showNeedsAttention
    && !holdExpired
    && !isMidBookingFlow
    && displayStatus !== 'checking'
  const showBookingInProgress =
    !isBookingComplete && !showHoldActive && !showNeedsAttention && !holdExpired && isMidBookingFlow

  const hideTrigger =
    isBookingComplete
    || job.status === 'expired'
    // THR-124: nothing to check yet — the hunt hasn't reached its booking
    // window, so a manual "Check Now" would just poll a not-yet-released
    // date. The scheduler auto-arms it the moment the window opens.
    || job.status === 'awaiting_window'
    || isMidBookingFlow

  const queued = optimisticTriggers.has(job.id)

  // ── Artifact selection ──
  // Booking-complete jobs sometimes only have last_artifact_png/html (older
  // records) rather than a full artifact_history; synthesise a receipt entry
  // in that case so the gallery still shows it.
  const receiptArtifact = getReceiptArtifact(job.artifact_history) ?? (
    isBookingComplete && job.last_artifact_png && job.last_artifact_html
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

  const headerActions = (
    <Button
      size="icon"
      variant="destructive"
      className="size-8"
      disabled={remove.isPending}
      onClick={() => setDeleteTarget({ id: job.id, name: job.name })}
      title="Delete Hunt"
    >
      <Trash2 className="size-4" />
    </Button>
  )

  return (
    <>
      <Card className={cn('app-panel app-panel-frame gap-0 py-0 border-border/80', MOBILE_FLAT_CARD_CLASSES, className)}>
        <JobCardHeader
          job={job}
          isLocked={isLocked}
          onEditTitle={() => handleEdit(0)}
          onBack={onBack}
          backLabel={backLabel}
          actions={headerActions}
        />

        <CardContent className="app-panel-body-scroll px-0 [-webkit-mask-image:none] [mask-image:none]">
          <div className="sticky top-0 z-10 border-b border-border/70 bg-muted/80 px-4 py-3 backdrop-blur-sm sm:px-6">
            <HeaderParamSummary
              params={job.params}
              parkUrl={job.park_url}
              onEdit={!isLocked ? () => handleEdit(1) : undefined}
              compact
            />
          </div>

          <div className="space-y-6 px-4 pt-6 pb-6 sm:px-6">
            {hasOutdatedCampers && (
              <OutdatedCampersNotice
                onEditJob={() => handleEdit()}
                onEditCampers={() => onOpenOccupants?.()}
              />
            )}
            {manualBookingOnly && isLive && <ManualBookingOnlyNotice siteName={adapter?.name} />}
            {missingOccupants && <MissingOccupantsNotice />}
            {missingCredentials && <MissingCredentialsNotice />}
            {failedCredentials && <FailedCredentialsNotice />}

            <MonitoringSection
              job={job}
              displayStatus={displayStatus}
              onTrigger={() => trigger.mutate(job.id)}
              triggerQueued={queued}
              hideTrigger={hideTrigger}
              hasOutdatedCampers={hasOutdatedCampers}
              onEdit={!isLocked ? () => handleEdit(2) : undefined}
            />

            {isBookingComplete && (
              <BookingCompleteSection
                job={job}
                completedArtifacts={completedArtifacts}
              />
            )}

            {showHoldActive && (
              <HoldActiveSection job={job} holdArtifacts={holdArtifacts} />
            )}

            {showNeedsAttention && (
              <NeedsAttentionSection job={job} holdArtifacts={holdArtifacts} />
            )}

            {holdExpired && (
              <HoldExpiredSection job={job} holdArtifacts={holdArtifacts} />
            )}

            {showBookingInProgress && (
              <BookingInProgressSection
                job={job}
                unavailableArtifact={unavailableArtifact}
              />
            )}

            {isSettled && (
              <LatestResultSection
                job={job}
                unavailableArtifact={unavailableArtifact}
              />
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
