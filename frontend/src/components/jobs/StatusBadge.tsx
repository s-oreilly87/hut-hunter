import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { JOB_STATUS_LABEL } from '@/lib/api'
import type { DisplayStatus } from '@/lib/availability'
import { formatCountdown, formatDateTime } from '@/lib/time'

interface Props {
  status: DisplayStatus
  jobId: string
  cartExpiresAt?: string | null
  artifactUrl?: string | null
  // THR-124: when status is 'awaiting_window', renders "Awaiting Window ·
  // Opens {date}" instead of the bare status label.
  windowOpensAt?: string | null
  windowOpensPrecise?: boolean
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
  waiting:              'bg-zinc-500 hover:bg-zinc-500 text-white',
  hold_placed:          'bg-amber-500 hover:bg-amber-500 text-white',
  // THR-122: distinct from hold_placed's amber — orange signals "this one
  // needs a human," not just "waiting on payment."
  needs_attention:      'bg-orange-600 hover:bg-orange-600 text-white',
  // THR-124: distinct from paused/waiting's neutral zinc — indigo signals
  // "this is deliberately parked and will arm itself," not just idle.
  awaiting_window:      'bg-indigo-600 hover:bg-indigo-600 text-white',
  booking_complete:     'bg-emerald-700 hover:bg-emerald-700 text-white',
  cancelled:            undefined,
  expired:              'bg-zinc-500 hover:bg-zinc-500 text-white',
  result_available:     'bg-emerald-500 hover:bg-emerald-500 text-white',
  result_partial:       'bg-amber-500 hover:bg-amber-500 text-white',
  result_unavailable:   'bg-rose-500 hover:bg-rose-500 text-white',
  result_hold_failed:   'bg-rose-500 hover:bg-rose-500 text-white',
}

const SPINNER_STATUSES = new Set(['booking', 'attempting_hold'])

export function StatusBadge({
  status,
  jobId,
  cartExpiresAt,
  artifactUrl,
  windowOpensAt,
  windowOpensPrecise = true,
}: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  // THR-122: needs_attention parks a live cart the same way hold_placed does,
  // so it gets the same countdown-ticking and pay-page link treatment.
  const isParkedStatus = status === 'hold_placed' || status === 'needs_attention'

  useEffect(() => {
    if (!isParkedStatus || !cartExpiresAt) return undefined

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [cartExpiresAt, isParkedStatus])

  const countdownSeconds = isParkedStatus && cartExpiresAt
    ? Math.max(0, (new Date(cartExpiresAt).getTime() - nowMs) / 1000)
    : null
  const baseLabel = status === 'awaiting_window' && windowOpensAt
    ? `Awaiting Window · Opens ${formatDateTime(windowOpensAt)}${windowOpensPrecise ? '' : ' (approx.)'}`
    : DISPLAY_LABEL[status] ?? JOB_STATUS_LABEL[status as keyof typeof JOB_STATUS_LABEL] ?? status
  const label = countdownSeconds !== null ? (
    <>
      {baseLabel} <span className="tabular-nums">({formatCountdown(countdownSeconds)})</span>
    </>
  ) : (
    baseLabel
  )
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

  if (isParkedStatus) {
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
