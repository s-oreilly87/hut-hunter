import type { ArtifactRecord, AvailabilityResult } from '@/lib/api'
import {
  getAvailabilityCopy,
  getAvailabilityVisual,
} from '@/lib/availabilityResults'
import { Badge } from '@/components/ui/Badge'
import { ArtifactGallery } from './ArtifactGallery'

const BUNDLE_LABEL: Record<'unavailable' | 'restricted', string> = {
  unavailable: 'Unavailable',
  restricted: 'Restricted',
}

const BUNDLE_SUMMARY: Record<'unavailable' | 'restricted', (count: number) => string> = {
  unavailable: (count) => `No availability was found for ${count} selected sites.`,
  restricted: (count) => `${count} selected sites are restricted for this stay pattern.`,
}

/**
 * Bundled tile for unavailable/restricted per-site results. The card
 * collapses many same-status sites into a single tile (with a chip per site)
 * rather than rendering one tile per site, which keeps the result list
 * readable when most sites came back empty or restricted.
 */
export function UnavailableResultTile({
  entries,
  unavailableArtifact,
  status = 'unavailable',
}: {
  entries: AvailabilityResult[]
  unavailableArtifact?: ArtifactRecord | null
  // THR-133: 'restricted' reuses this bundled-tile layout for the new
  // restriction-only outcome instead of duplicating it.
  status?: 'unavailable' | 'restricted'
}) {
  const visual = getAvailabilityVisual(status)
  const Icon = visual.icon
  const siteCount = entries.length
  const firstCopy = entries[0] ? getAvailabilityCopy(entries[0]) : null
  const summary = siteCount === 1
    ? (firstCopy?.summary ?? 'No availability was found for this site.')
    : BUNDLE_SUMMARY[status](siteCount)
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
              {BUNDLE_LABEL[status]}
            </Badge>
          </div>

          {siteCount > 1 && (
            <div className="flex flex-wrap gap-2">
              {entries.map((entry) => (
                <span
                  key={entry.site}
                  className={`rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground bg-background/80 ${
                    status === 'restricted' ? 'border-orange-500/20' : 'border-rose-500/20'
                  }`}
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
