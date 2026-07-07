import type { ArtifactRecord, AvailabilityResult } from '@/lib/api'
import {
  getAvailabilityCopy,
  getAvailabilityVisual,
} from '@/lib/availabilityResults'
import { Badge } from '@/components/ui/Badge'
import { ArtifactGallery } from './ArtifactGallery'

/**
 * Bundled tile for unavailable per-site results. The card collapses many
 * unavailable sites into a single tile (with a chip per site) rather than
 * rendering one tile per site, which keeps the result list readable when
 * most sites came back empty.
 */
export function UnavailableResultTile({
  entries,
  unavailableArtifact,
}: {
  entries: AvailabilityResult[]
  unavailableArtifact?: ArtifactRecord | null
}) {
  const visual = getAvailabilityVisual('unavailable')
  const Icon = visual.icon
  const siteCount = entries.length
  const firstCopy = entries[0] ? getAvailabilityCopy(entries[0]) : null
  const summary = siteCount === 1
    ? (firstCopy?.summary ?? 'No availability was found for this site.')
    : `No availability was found for ${siteCount} selected sites.`
  // THR-129 Finding E: only meaningful for the single-site case — a bundled
  // tile's entries can each have different evidence, so it isn't shown
  // there (the summary/chip-per-site treatment already covers that case).
  const evidenceLine = siteCount === 1 ? firstCopy?.details[0] : undefined

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
                {siteCount === 1 ? entries[0]?.site : 'Selected Sites'}
              </p>
              <p className="mt-1 text-sm leading-5 text-foreground/85">
                {summary}
              </p>
              {evidenceLine && (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {evidenceLine}
                </p>
              )}
            </div>
            <Badge className={`shrink-0 ${visual.badgeClass}`}>
              Unavailable
            </Badge>
          </div>

          {siteCount > 1 && (
            <div className="flex flex-wrap gap-2">
              {entries.map((entry) => (
                <span
                  key={entry.site}
                  className="rounded-full border border-rose-500/20 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground"
                >
                  {entry.site}
                </span>
              ))}
            </div>
          )}

          {unavailableArtifact && (
            <ArtifactGallery artifacts={[unavailableArtifact]} />
          )}
        </div>
      </div>
    </div>
  )
}
