import { useEffect, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { jobsApi, type WatchJob } from '@/lib/api'
import type { DisplayStatus } from '@/lib/availability'
import { formatCountdown } from '@/lib/time'

interface Props {
  job: WatchJob
  displayStatus: DisplayStatus
}

// The monitoring status pill. When the monitoring state is user-toggleable
// (i.e. monitoring is on and waiting between checks, OR monitoring is off)
// the whole pill is a clickable button with a Pause/Play icon as visual
// anchor. When the state is transient and managed by the backend
// (`checking`, `hold_placed`) the pill renders as a static badge.
//
// Merging the toggle into the badge avoids the visual noise of a separate
// pause/monitor button sitting next to a status badge that describes the
// same thing.
export function MonitoringBadge({ job, displayStatus }: Props) {
  const qc = useQueryClient()

  // Tick every second so the countdown updates smoothly between the 5s
  // JobList refetch. The server-provided next_check_at is the source of
  // truth; we just interpolate locally.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const mutation = useMutation({
    mutationFn: (nextMonitoring: boolean) =>
      jobsApi.update(job.id, { enable_monitoring: nextMonitoring }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })

  // Terminal states — monitoring is permanently off. Fall through to render
  // the static "Unmonitored" badge so the column is never empty.
  if (
    displayStatus === 'booking_complete'
    || displayStatus === 'cancelled'
    || displayStatus === 'expired'
  ) {
    return (
      <Badge variant="secondary">Unmonitored</Badge>
    )
  }

  // Live hold — monitoring is on but paused until cart expires. Not
  // toggleable (user should cancel the hold to resume monitoring).
  if (displayStatus === 'hold_placed') {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600">
        Paused (hold active)
      </Badge>
    )
  }

  // Hold worker is running — transient, not toggleable. StatusBadge already
  // shows "Securing Hold…" so this badge stays quiet.
  if (displayStatus === 'attempting_hold') {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600">
        Paused (securing hold)
      </Badge>
    )
  }

  // Currently running a check. Not toggleable — it'll transition on its
  // own once the worker finishes.
  if (displayStatus === 'checking') {
    return (
      <Badge
        variant="default"
        className="bg-blue-600 hover:bg-blue-600 text-white"
      >
        Checking…
      </Badge>
    )
  }

  // --- Toggleable: render as a button styled as a badge -----------------
  const isOn = job.enable_monitoring
  const Icon = isOn ? Pause : Play

  // Render the label as two spans — the static "Monitoring" prefix and a
  // fixed-width tabular-nums countdown — so the pill doesn't jitter in
  // width as seconds tick. `tabular-nums` forces equal digit advance width
  // in the system font; the parenthesized wrapper keeps the " (" and ")"
  // stable too.
  const countdownSeconds = isOn && job.next_check_at
    ? (new Date(job.next_check_at).getTime() - nowMs) / 1000
    : null

  const title = isOn
    ? 'Pause monitoring (stop scheduled checks)'
    : 'Resume monitoring (auto-check on schedule)'

  // Colour + hover choices:
  //  - On:  emerald fill, slightly darker on hover to signal clickable.
  //  - Off: muted neutral fill, slightly darker on hover.
  // Both apply `cursor-pointer` and a focus ring via the base badge class.
  const colorClasses = isOn
    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
    : 'bg-muted text-muted-foreground hover:bg-muted-foreground/20'

  return (
    <Badge
      asChild
      variant={isOn ? 'default' : 'secondary'}
      className={`cursor-pointer ${colorClasses} ${
        mutation.isPending ? 'opacity-60 pointer-events-none' : ''
      }`}
    >
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={e => {
          e.stopPropagation()
          mutation.mutate(!isOn)
        }}
        title={title}
        aria-label={title}
      >
        <Icon />
        {isOn ? (
          <span>
            Monitoring
            {countdownSeconds !== null && (
              <>
                {' ('}
                <span className="tabular-nums">
                  {formatCountdown(countdownSeconds)}
                </span>
                {')'}
              </>
            )}
          </span>
        ) : (
          <span>Paused</span>
        )}
      </button>
    </Badge>
  )
}
