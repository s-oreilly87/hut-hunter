import { Badge } from '@/components/ui/badge'
import { JOB_STATUS_LABEL, type JobStatus } from '@/lib/api'

interface Props {
  status: JobStatus
  jobId: string
}

// Per-status color classes. Falls back to default badge variant via `undefined`.
// Colors use Tailwind so they pick up our theme automatically.
const STATUS_CLASS: Record<JobStatus, string | undefined> = {
  paused: undefined, // secondary variant handles this
  checking: 'bg-blue-600 hover:bg-blue-600 text-white',
  waiting: 'bg-slate-500 hover:bg-slate-500 text-white',
  hold_placed: 'bg-amber-500 hover:bg-amber-600 text-white',
  booking_complete: 'bg-emerald-600 hover:bg-emerald-600 text-white',
  cancelled: undefined, // secondary variant handles this
}

export function StatusBadge({ status, jobId }: Props) {
  const label = JOB_STATUS_LABEL[status]
  const isSecondary = status === 'paused' || status === 'cancelled'
  const badge = (
    <Badge
      variant={isSecondary ? 'secondary' : 'default'}
      className={STATUS_CLASS[status]}
    >
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
  return badge
}
