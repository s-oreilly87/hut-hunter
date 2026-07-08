import { ExternalLink } from 'lucide-react'
import type { AvailabilityResult } from '@/lib/api'
import {
  getAvailabilityCopy,
  getAvailabilityVisual,
  titleize,
} from '@/lib/availabilityResults'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

/**
 * Single per-site availability tile. Renders the appropriate icon, summary
 * copy, and status pill for an `available` / `partially_available` /
 * `unknown` result. Use `UnavailableResultTile` for the bundled-unavailable
 * case.
 *
 * THR-130: once availability is confirmed, `siteUrl` (the job's backend-
 * computed `park_url` — a prefilled booking-site link for Camis, a
 * facility/landing page for DOC) surfaces a "Go To Site" button so the user
 * can jump straight to the booking site.
 */
export function AvailabilityResultTile({
  entry,
  siteUrl,
}: {
  entry: AvailabilityResult
  siteUrl?: string | null
}) {
  const visual = getAvailabilityVisual(entry.status)
  const copy = getAvailabilityCopy(entry)
  const Icon = visual.icon

  return (
    <div className={`rounded-[1.25rem] border px-4 py-4 ${visual.tileClass}`}>
      <div className="flex items-start gap-3">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${visual.iconClass}`}>
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium tracking-tight text-foreground">
                {entry.site}
              </p>
              <p className="mt-1 text-sm leading-5 text-foreground/85">
                {copy.summary}
              </p>
            </div>
            <Badge
              variant={entry.status === 'unknown' ? 'outline' : 'default'}
              className={`shrink-0 ${visual.badgeClass}`}
            >
              {titleize(entry.status)}
            </Badge>
          </div>

          {copy.details.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {copy.details.map((detail) => (
                <span
                  key={detail}
                  className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground"
                >
                  {detail}
                </span>
              ))}
            </div>
          )}

          {siteUrl && (
            <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
              <a
                href={siteUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                Go To Site
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
