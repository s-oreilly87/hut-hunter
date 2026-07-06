import { useEffect, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Badge } from '../ui/Badge'
import { jobsApi, type WatchJob } from '@/lib/api'
import type { DisplayStatus } from '@/lib/availability'
import { formatCountdown } from '@/lib/time'

interface Props {
  job: WatchJob
  displayStatus: DisplayStatus
}

export function MonitoringBadge({ job, displayStatus }: Props) {
  const qc = useQueryClient()

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

  if (
    displayStatus === 'booking_complete'
    || displayStatus === 'cancelled'
    || displayStatus === 'expired'
  ) {
    return (
      <Badge variant="secondary">Unmonitored</Badge>
    )
  }

  if (displayStatus === 'hold_placed') {
    return (
      <Badge className="bg-amber-500 hover:bg-amber-500 text-white">
        Hold placed
      </Badge>
    )
  }

  if (displayStatus === 'needs_attention') {
    return (
      <Badge className="bg-orange-600 hover:bg-orange-600 text-white">
        Needs attention
      </Badge>
    )
  }

  if (displayStatus === 'attempting_hold') {
    return (
      <Badge className="bg-amber-500 hover:bg-amber-500 text-white">
        Securing hold
      </Badge>
    )
  }

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

  const isOn = job.enable_monitoring
  const Icon = isOn ? Pause : Play

  const countdownSeconds = isOn && job.next_check_at
    ? (new Date(job.next_check_at).getTime() - nowMs) / 1000
    : null

  const title = isOn
    ? 'Pause monitoring (stop scheduled checks)'
    : 'Resume monitoring (auto-check on schedule)'

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
        aria-label={title}
      >
        <Icon />
        {isOn ? (
          <span>
            Monitoring {countdownSeconds !== null && <span className="tabular-nums">({formatCountdown(countdownSeconds)})</span>}
          </span>
        ) : (
          <span>Paused</span>
        )}
      </button>
    </Badge>
  )
}
