import { useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { jobsApi, type WatchJob } from '@/lib/api'
import {
  getDisplayStatus,
  hasHoldExpired,
  jobAllFullyAvailable,
  jobHasOccupants,
} from '@/lib/availability'
import { useJobsStore } from '@/store/jobs'
import { Button } from '../ui/Button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../ui/Tooltip'

const STALE_MS = 30 * 60 * 1000 // 30 minutes

function isCheckStale(lastCheckedAt: string | null): boolean {
  if (!lastCheckedAt) return true
  return Date.now() - new Date(lastCheckedAt).getTime() > STALE_MS
}

export function BookButton({
  job,
  size = 'sm',
  className,
}: {
  job: WatchJob
  size?: 'sm' | 'default'
  className?: string
}) {
  const qc = useQueryClient()
  const { pendingBookings, markBooking, clearBooking } = useJobsStore()
  const isPendingLocal = pendingBookings.has(job.id)

  const mutation = useMutation({
    mutationFn: jobsApi.book,
    onMutate: (id: string) => markBooking(id),
    onError: (_e, id) => clearBooking(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
      qc.invalidateQueries({ queryKey: ['jobs', job.id] })
    },
  })

  const displayStatus = getDisplayStatus(job, pendingBookings)

  // Keep the optimistic spinner alive until the backend leaves its in-flight states.
  useEffect(() => {
    if (!isPendingLocal) return
    if (displayStatus !== 'checking' && displayStatus !== 'attempting_hold') {
      clearBooking(job.id)
    }
  }, [isPendingLocal, displayStatus, job.id, clearBooking])

  const showBooking = isPendingLocal || mutation.isPending
  const stale = isCheckStale(job.last_checked_at)
  const missingOccupants = !jobHasOccupants(job)
  const missingCredentials = !job.credentials_configured

  const isTerminal = job.status === 'booking_complete' || job.status === 'expired'
  const holdExpired = hasHoldExpired(job)
  const visible =
    !isTerminal
    && displayStatus !== 'attempting_hold'
    && (
      (job.status === 'hold_placed' && !holdExpired)
      || (holdExpired && jobAllFullyAvailable(job))
      || showBooking
      || jobAllFullyAvailable(job)
    )
  if (!visible) return null

  if (job.status === 'hold_placed' && !holdExpired) {
    return (
      <Button
        asChild
        size={size}
        className={`bg-emerald-600 hover:bg-emerald-700 text-white ${className ?? ''}`}
      >
        <a
          href={`/pay/${job.id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
        >
          Open Payment
        </a>
      </Button>
    )
  }

  if (showBooking) {
    return (
      <Button
        size={size}
        disabled
        className={`bg-emerald-600 hover:bg-emerald-600 text-white ${className ?? ''}`}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Booking…
      </Button>
    )
  }

  // Disabled buttons do not expose hover state, so the stale explanation lives on the wrapper.
  const disabledReason = missingOccupants
    ? 'Campers are required on this hunt before booking can start'
    : missingCredentials
      ? 'A saved sign-in is required on this hunt before booking can start'
    : stale
      ? 'Last check was more than 30 minutes ago. Run a fresh check before booking.'
      : null

  const bookBtn = (
    <Button
      size={size}
      disabled={Boolean(disabledReason)}
      className={`bg-emerald-600 hover:bg-emerald-700 text-white ${className ?? ''}`}
      onClick={disabledReason ? undefined : e => {
        e.stopPropagation()
        mutation.mutate(job.id)
      }}
    >
      {holdExpired ? 'Attempt Hold Again' : 'Attempt Booking'}
    </Button>
  )

  return disabledReason ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-not-allowed">
            {bookBtn}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          {disabledReason}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : bookBtn
}

export function PartialAvailabilityHelp() {
  return (
    <p className="text-xs text-muted-foreground leading-relaxed">
      Want to book what IS available?{' '}
      <span className="text-foreground">
        Create a new hunt scoped to just that site,
      </span>
      {' '}then hit <span className="font-medium">Book Now</span>{' '}
      on that hunt. Note: the booking site's cart can't mix party sizes across
      nights, so those hunts need to be split separately too.
    </p>
  )
}
