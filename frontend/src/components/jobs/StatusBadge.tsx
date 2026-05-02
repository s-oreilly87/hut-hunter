import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { JOB_STATUS_LABEL } from '@/lib/api'
import type { DisplayStatus } from '@/lib/availability'
import { formatCountdown } from '@/lib/time'

interface Props {
  status: DisplayStatus
  jobId: string
  cartExpiresAt?: string | null
  artifactUrl?: string | null
}

const DISPLAY_LABEL: Record<string, string> = {
  booking:              'Booking…',
  attempting_hold:      'Securing Hold…',
  hold_expired:         'Hold Expired',
  result_available:     'Available',
  result_partial:       'Partially Available',
  result_unavailable:   'Unavailable',
  result_hold_failed:   'Hold Failed',
}

const STATUS_CLASS: Record<string, string | undefined> = {
  paused:               undefined,
  checking:             'bg-blue-600 hover:bg-blue-600 text-white',
  booking:              'bg-blue-600 hover:bg-blue-600 text-white',
  attempting_hold:      'bg-amber-500 hover:bg-amber-500 text-white',
  hold_expired:         'bg-zinc-500 hover:bg-zinc-500 text-white',
  waiting:              'bg-slate-500 hover:bg-slate-500 text-white',
  hold_placed:          'bg-amber-500 hover:bg-amber-600 text-white',
  booking_complete:     'bg-emerald-600 hover:bg-emerald-600 text-white',
  cancelled:            undefined,
  expired:              'bg-zinc-400 hover:bg-zinc-400 text-white',
  result_available:     'bg-emerald-600 hover:bg-emerald-600 text-white',
  result_partial:       'bg-amber-500 hover:bg-amber-500 text-white',
  result_unavailable:   undefined,
  result_hold_failed:   'bg-rose-600 hover:bg-rose-600 text-white',
}

const SPINNER_STATUSES = new Set(['booking', 'attempting_hold'])

export function StatusBadge({ status, jobId, cartExpiresAt, artifactUrl }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (status !== 'hold_placed' || !cartExpiresAt) return undefined

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [cartExpiresAt, status])

  const countdownSeconds = status === 'hold_placed' && cartExpiresAt
    ? Math.max(0, (new Date(cartExpiresAt).getTime() - nowMs) / 1000)
    : null
  const baseLabel = DISPLAY_LABEL[status] ?? JOB_STATUS_LABEL[status as keyof typeof JOB_STATUS_LABEL] ?? status
  const label = countdownSeconds !== null
    ? `${baseLabel} (${formatCountdown(countdownSeconds)})`
    : baseLabel
  const isSecondary = status === 'paused' || status === 'cancelled' || status === 'result_unavailable'
  const badge = (
    <Badge
      variant={isSecondary ? 'secondary' : 'default'}
      className={STATUS_CLASS[status]}
    >
      {SPINNER_STATUSES.has(status) && <Loader2 className="size-3 animate-spin mr-1" />}
      {label}
    </Badge>
  )

  if (status === 'hold_placed') {
    return (
      <a
        href={`/pay/${jobId}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {badge}
      </a>
    )
  }

  if (status === 'booking_complete' && artifactUrl) {
    return (
      <a
        href={artifactUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        {badge}
      </a>
    )
  }
  return badge
}
