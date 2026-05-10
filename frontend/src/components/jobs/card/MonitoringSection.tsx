import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  Loader2,
  Pause,
  Pencil,
  Play,
  Search,
} from 'lucide-react'
import { jobsApi, type WatchJob } from '@/lib/api'
import { type DisplayStatus } from '@/lib/availability'
import { formatCountdown, formatRelativeTimeFromNow } from '@/lib/time'
import { Button } from '@/components/ui/Button'
import {
  AutoBookBadge,
  NoSignInBadge,
} from '@/components/jobs/shared/AutoBookBadge'

function formatRelativeTime(value: string | null): string {
  return formatRelativeTimeFromNow(value, {
    emptyLabel: 'Never checked',
    justNowLabel: 'just now',
    prefix: 'Checked',
  })
}

/**
 * The monitoring control panel inside JobCard: shows whether the job is
 * actively being polled, when the next check fires, and provides Pause /
 * Resume / Check-Now controls. Hidden entirely once the job reaches a
 * terminal state (booking_complete / cancelled / expired).
 *
 * Side effect: if `hasOutdatedCampers` flips on while the job is still
 * monitoring, this section auto-pauses the job. JobList does the same on
 * the list level — having both keeps the invariant intact regardless of
 * which surface noticed the drift first.
 */
export function MonitoringSection({
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
      <div className="rounded-[1.25rem] border border-border/70 bg-background/65 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <h3 className="text-xs font-semibold tracking-tight text-muted-foreground/80">
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

        <div className="mt-3 space-y-1 text-xs text-muted-foreground/85">
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
          <div className="mt-3 border-t border-border/50 pt-3">
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
