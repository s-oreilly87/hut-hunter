import type { DisplayStatus } from '@/lib/availability'
import { formatDateTime, formatRelativeTimeFromNow } from '@/lib/time'

export function formatTimeAgo(value: string | null): string {
  return formatRelativeTimeFromNow(value, { justNowLabel: 'just now' })
}

export function isJobFinished(displayStatus: DisplayStatus): boolean {
  return (
    displayStatus === 'booking_complete'
    || displayStatus === 'cancelled'
    || displayStatus === 'expired'
  )
}

/** Subtitle under the status badge when a hunt is parked awaiting its window. */
export function formatWindowOpensLabel(
  windowOpensAt: string | null | undefined,
  windowOpensPrecise = true,
): string | null {
  if (!windowOpensAt) return null
  return `Opens ${formatDateTime(windowOpensAt)}${windowOpensPrecise ? '' : ' (approx.)'}`
}
