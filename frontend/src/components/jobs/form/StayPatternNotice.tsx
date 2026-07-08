import { TriangleAlert } from 'lucide-react'
import type { WindowCheckResult } from '@/lib/api'

/**
 * THR-133: shown in the create/edit wizard when the requested arrival/
 * nights combo violates the booking site's own stay-pattern rules (Camis
 * arrival/departure changeover, min/max-stay) — surfaced up front so the
 * user isn't left waiting out a booking window that can never yield a
 * hold. Unlike BookingWindowNotice, this is purely advisory: it never
 * blocks save or changes what gets created, since the site's rules could
 * still change before the job's date arrives.
 */
export function StayPatternNotice({
  windowCheck,
}: {
  windowCheck: WindowCheckResult
}) {
  return (
    <div className="space-y-1.5 rounded-2xl border border-orange-500/25 bg-orange-500/8 px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-orange-600" />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">This date/length of stay may not be bookable</p>
          <p className="text-muted-foreground/90">
            {windowCheck.stay_pattern_evidence
              || "This booking site's rules don't allow the requested stay pattern for this period."}
            {' '}Adjusting the dates or number of nights may resolve this — this hunt can still be
            created, but a hold may never succeed as configured.
          </p>
        </div>
      </div>
    </div>
  )
}
