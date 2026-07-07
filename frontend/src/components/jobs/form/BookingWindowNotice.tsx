import { CalendarClock } from 'lucide-react'
import type { WindowCheckResult } from '@/lib/api'
import { formatDateTime } from '@/lib/time'

/**
 * THR-124: shown in the create/edit wizard when the requested date isn't
 * inside the booking site's release window yet (Camis' rolling per-park
 * schedule). This is the "never create one silently" requirement from the
 * ticket — the user must see and acknowledge this *before* saving, not
 * discover it after the fact on the job card.
 */
export function BookingWindowNotice({
  windowCheck,
  acknowledged,
  onAcknowledge,
}: {
  windowCheck: WindowCheckResult
  acknowledged: boolean
  onAcknowledge: () => void
}) {
  const opensAtLabel = windowCheck.opens_at
    ? `${formatDateTime(windowCheck.opens_at)}${windowCheck.opens_at_precise ? '' : ' (approx. — exact time unconfirmed)'}`
    : 'once the booking site releases it'

  return (
    <div className="space-y-3 rounded-2xl border border-indigo-500/25 bg-indigo-500/8 px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-indigo-600" />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">Booking for this date isn't open yet</p>
          <p className="text-muted-foreground/90">
            This site releases bookings on a rolling schedule. Booking opens{' '}
            <span className="font-medium text-foreground">{opensAtLabel}</span>. This hunt will
            be created in an <span className="font-medium">Awaiting Window</span> state — no
            checks run until then — and will automatically arm and attempt to search and hold
            the moment the window opens.
          </p>
        </div>
      </div>
      <label className="flex cursor-pointer items-start gap-2 pl-7 text-xs text-muted-foreground/90">
        <input
          type="checkbox"
          className="mt-0.5 size-3.5 accent-indigo-600"
          checked={acknowledged}
          onChange={(e) => {
            if (e.target.checked) onAcknowledge()
          }}
        />
        I understand this hunt won't check availability until the booking window opens.
      </label>
    </div>
  )
}
