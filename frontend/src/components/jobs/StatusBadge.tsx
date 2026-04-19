import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { JOB_STATUS_LABEL } from '@/lib/api'
import type { DisplayStatus } from '@/lib/availability'

interface Props {
  status: DisplayStatus
  jobId: string
  // If set and status is `booking_complete`, the badge links to this URL —
  // typically the receipt snapshot captured when the user hit "Booking
  // Complete" on the /pay page. Null/undefined renders a plain badge.
  artifactUrl?: string | null
}

// Label overrides for display-only statuses not in JOB_STATUS_LABEL
const DISPLAY_LABEL: Record<string, string> = {
  booking:            'Booking…',
  attempting_hold:    'Securing Hold…',
  result_available:   'Available',
  result_partial:     'Partially Available',
  result_unavailable: 'Unavailable',
}

// Tailwind colour classes per display status. Undefined → secondary variant.
const STATUS_CLASS: Record<string, string | undefined> = {
  paused:             undefined,
  checking:           'bg-blue-600 hover:bg-blue-600 text-white',
  booking:            'bg-blue-600 hover:bg-blue-600 text-white',
  attempting_hold:    'bg-amber-500 hover:bg-amber-500 text-white',
  waiting:            'bg-slate-500 hover:bg-slate-500 text-white',
  hold_placed:        'bg-amber-500 hover:bg-amber-600 text-white',
  booking_complete:   'bg-emerald-600 hover:bg-emerald-600 text-white',
  cancelled:          undefined,
  expired:            'bg-zinc-400 hover:bg-zinc-400 text-white',
  result_available:   'bg-emerald-600 hover:bg-emerald-600 text-white',
  result_partial:     'bg-amber-500 hover:bg-amber-500 text-white',
  result_unavailable: undefined,
}

const SPINNER_STATUSES = new Set(['booking', 'attempting_hold'])

export function StatusBadge({ status, jobId, artifactUrl }: Props) {
  const label = DISPLAY_LABEL[status] ?? JOB_STATUS_LABEL[status as keyof typeof JOB_STATUS_LABEL] ?? status
  const isSecondary = status === 'paused' || status === 'cancelled' || status === 'result_unavailable'
  const badge = (
    <Badge
      variant={isSecondary ? 'secondary' : 'default'}
      className={STATUS_CLASS[status]}
    >
      {SPINNER_STATUSES.has(status) && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
      {label}
    </Badge>
  )

  // Hold Placed links to the pay page so the user can jump straight back.
  if (status === 'hold_placed') {
    return (
      <a
        href={`/pay/${jobId}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title="Open payment page"
      >
        {badge}
      </a>
    )
  }

  // Booking Complete links to the receipt snapshot (if captured) so the user
  // can eyeball the confirmation page without chasing down artifact paths.
  if (status === 'booking_complete' && artifactUrl) {
    return (
      <a
        href={artifactUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title="Open booking receipt"
      >
        {badge}
      </a>
    )
  }
  return badge
}
