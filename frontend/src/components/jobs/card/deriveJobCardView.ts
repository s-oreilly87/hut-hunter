import { useMemo } from 'react'
import type { AdapterInfo, Occupant, WatchJob } from '@/lib/api'
import {
  getDisplayStatus,
  hasHoldExpired,
  isLiveJob,
  jobHasOccupants,
} from '@/lib/availability'
import {
  getCompletedBookingArtifacts,
  getHoldFlowArtifacts,
  getReceiptArtifact,
  getUnavailableArtifact,
} from '@/lib/availabilityResults'
import { isJobOutdatedOnCampers } from '@/lib/occupantSnapshots'

/**
 * Derives the mutually exclusive JobCard section flags and artifact bags
 * from a job + related lookup data. Kept pure so JobCard stays orchestration.
 */
export function deriveJobCardView(
  job: WatchJob,
  {
    adaptersById,
    occupants,
    pendingBookings,
    optimisticTriggers,
  }: {
    adaptersById: Map<string, AdapterInfo>
    occupants: Occupant[]
    pendingBookings: Set<string>
    optimisticTriggers: Set<string>
  },
) {
  const displayStatus = getDisplayStatus(job, pendingBookings)
  const adapter = adaptersById.get(job.adapter_id)
  const hasOutdatedCampers = isJobOutdatedOnCampers(job, occupants, adapter)
  const holdExpired = hasHoldExpired(job)
  const isLocked = job.status === 'booking_complete'
  const isLive = isLiveJob(job)
  const manualBookingOnly = !job.supports_automated_booking
  const missingOccupants = !jobHasOccupants(job) && isLive && !manualBookingOnly
  const missingCredentials = !job.credentials_configured && !job.credentials_failed && isLive && !manualBookingOnly
  const failedCredentials = job.credentials_failed && isLive && !manualBookingOnly

  const isBookingComplete = job.status === 'booking_complete'
  const showHoldActive = job.status === 'hold_placed' && !holdExpired
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
    || job.status === 'awaiting_window'
    || isMidBookingFlow

  const queued = optimisticTriggers.has(job.id)

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

  return {
    displayStatus,
    adapter,
    hasOutdatedCampers,
    holdExpired,
    isLocked,
    isLive,
    manualBookingOnly,
    missingOccupants,
    missingCredentials,
    failedCredentials,
    isBookingComplete,
    showHoldActive,
    showNeedsAttention,
    isSettled,
    showBookingInProgress,
    hideTrigger,
    queued,
    holdArtifacts,
    completedArtifacts,
    unavailableArtifact,
  }
}

export function useAdapterById(adapters: AdapterInfo[]) {
  return useMemo(
    () => new Map(adapters.map((adapter) => [adapter.adapter_id, adapter])),
    [adapters],
  )
}
