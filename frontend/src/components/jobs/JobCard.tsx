import { useEffect, useState } from 'react'
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
import { useJobsQuery } from '@/components/jobs/useJobsQuery'
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
import {
  deriveJobCardView,
  useAdapterById,
} from '@/components/jobs/card/deriveJobCardView'
import { cn } from '@/lib/utils'

const MOBILE_FLAT_CARD_CLASSES = 'max-sm:rounded-none max-sm:border-0 max-sm:shadow-none max-sm:ring-0 max-sm:backdrop-blur-none'

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

  const adapterById = useAdapterById(adapters)

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

  const view = deriveJobCardView(job, {
    adaptersById: adapterById,
    occupants,
    pendingBookings,
    optimisticTriggers,
  })

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
      <Card className={cn('app-panel app-panel-frame gap-0 border-border/80 py-0', MOBILE_FLAT_CARD_CLASSES, className)}>
        <JobCardHeader
          job={job}
          isLocked={view.isLocked}
          onEditTitle={() => handleEdit(0)}
          onBack={onBack}
          backLabel={backLabel}
          actions={headerActions}
        />

        <CardContent className="app-panel-body-scroll mask-none px-0 [-webkit-mask-image:none]">
          <div className="sticky top-0 z-10 border-b border-border/70 bg-muted/80 px-4 py-3 backdrop-blur-sm sm:px-6">
            <HeaderParamSummary
              params={job.params}
              parkUrl={job.park_url}
              onEdit={!view.isLocked ? () => handleEdit(1) : undefined}
              compact
            />
          </div>

          <div className="space-y-6 px-4 py-6 sm:px-6">
            {view.hasOutdatedCampers && (
              <OutdatedCampersNotice
                onEditJob={() => handleEdit()}
                onEditCampers={() => onOpenOccupants?.()}
              />
            )}
            {view.manualBookingOnly && view.isLive && (
              <ManualBookingOnlyNotice siteName={view.adapter?.name} />
            )}
            {view.missingOccupants && <MissingOccupantsNotice />}
            {view.missingCredentials && <MissingCredentialsNotice />}
            {view.failedCredentials && <FailedCredentialsNotice />}

            <MonitoringSection
              job={job}
              displayStatus={view.displayStatus}
              onTrigger={() => trigger.mutate(job.id)}
              triggerQueued={view.queued}
              hideTrigger={view.hideTrigger}
              hasOutdatedCampers={view.hasOutdatedCampers}
              onEdit={!view.isLocked ? () => handleEdit(2) : undefined}
            />

            {view.isBookingComplete && (
              <BookingCompleteSection
                job={job}
                completedArtifacts={view.completedArtifacts}
              />
            )}

            {view.showHoldActive && (
              <HoldActiveSection job={job} holdArtifacts={view.holdArtifacts} />
            )}

            {view.showNeedsAttention && (
              <NeedsAttentionSection job={job} holdArtifacts={view.holdArtifacts} />
            )}

            {view.holdExpired && (
              <HoldExpiredSection job={job} holdArtifacts={view.holdArtifacts} />
            )}

            {view.showBookingInProgress && (
              <BookingInProgressSection
                job={job}
                unavailableArtifact={view.unavailableArtifact}
              />
            )}

            {view.isSettled && (
              <LatestResultSection
                job={job}
                unavailableArtifact={view.unavailableArtifact}
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

