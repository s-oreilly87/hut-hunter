import type { DisplayStatus } from '@/lib/availability'
import { formatRelativeTimeFromNow } from '@/lib/time'

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
