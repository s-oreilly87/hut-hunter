import { useEffect, useState } from 'react'
import { formatCountdown } from '@/lib/time'

/**
 * One-second-tick countdown showing how long is left on a held cart before
 * the booking site auto-cancels it. Hidden when there is no cart expiry.
 *
 * Used inside the Hold-active section of JobCard.
 */
export function HoldExpiryCountdown({ cartExpiresAt }: { cartExpiresAt: string | null }) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!cartExpiresAt) return undefined

    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [cartExpiresAt])

  if (!cartExpiresAt) return null

  const countdownSeconds = Math.max(0, (new Date(cartExpiresAt).getTime() - nowMs) / 1000)

  return (
    <p className="mt-2 text-sm leading-5 text-muted-foreground">
      Time remaining to complete payment:{' '}
      <span className="font-medium tabular-nums text-foreground">
        {formatCountdown(countdownSeconds)}
      </span>
    </p>
  )
}
