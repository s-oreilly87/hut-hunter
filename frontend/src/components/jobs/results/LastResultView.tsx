import type {
  ArtifactRecord,
  AvailabilityResult,
  LastResultEntry,
} from '@/lib/api'
import {
  isAvailabilityResult,
  isHoldFailedEntry,
} from '@/lib/availabilityResults'
import { AvailabilityResultTile } from './AvailabilityResultTile'
import { GenericResultView } from './GenericResultView'
import { HoldFailedView } from './HoldFailedView'
import { UnavailableResultTile } from './UnavailableResultTile'

/**
 * Renders the last_result array attached to a job, dispatching each entry
 * to the appropriate per-shape tile.
 *
 * The "unavailable" availability results get bundled into a single
 * `UnavailableResultTile` in place of the first occurrence; later
 * unavailable entries are skipped so the tile isn't repeated.
 */
export function LastResultView({
  result,
  artifactPng,
  artifactHtml,
  unavailableArtifact,
  parkUrl,
}: {
  result: LastResultEntry[]
  artifactPng?: string | null
  artifactHtml?: string | null
  unavailableArtifact?: ArtifactRecord | null
  // THR-130: the job's booking-site link, surfaced as a "Go To Site" button
  // on each confirmed-availability tile. Null for adapters/params without one.
  parkUrl?: string | null
}) {
  if (!result.length) {
    return <p className="text-sm text-muted-foreground">No results captured yet.</p>
  }

  const unavailableResults = result.filter(
    (entry): entry is AvailabilityResult =>
      isAvailabilityResult(entry) && entry.status === 'unavailable',
  )
  const firstUnavailableIndex = result.findIndex(
    (entry) => isAvailabilityResult(entry) && entry.status === 'unavailable',
  )

  // THR-133: same bundling treatment for restriction-only sites, kept as a
  // separate group from unavailableResults above since the two statuses
  // shouldn't be merged into one tile.
  const restrictedResults = result.filter(
    (entry): entry is AvailabilityResult =>
      isAvailabilityResult(entry) && entry.status === 'restricted',
  )
  const firstRestrictedIndex = result.findIndex(
    (entry) => isAvailabilityResult(entry) && entry.status === 'restricted',
  )

  return (
    <div className="space-y-3">
      {result.map((entry, index) => {
        if (isAvailabilityResult(entry)) {
          if (entry.status === 'unavailable') {
            // Render the bundled tile once, at the first unavailable index;
            // skip later unavailable entries.
            if (index !== firstUnavailableIndex) return null
            return (
              <UnavailableResultTile
                key="unavailable-results"
                entries={unavailableResults}
                unavailableArtifact={unavailableArtifact}
              />
            )
          }

          if (entry.status === 'restricted') {
            if (index !== firstRestrictedIndex) return null
            return (
              <UnavailableResultTile
                key="restricted-results"
                entries={restrictedResults}
                status="restricted"
              />
            )
          }

          return <AvailabilityResultTile key={index} entry={entry} siteUrl={parkUrl} />
        }

        if (isHoldFailedEntry(entry)) {
          return (
            <HoldFailedView
              key={index}
              entry={entry as Record<string, unknown>}
              artifactPng={artifactPng}
              artifactHtml={artifactHtml}
            />
          )
        }

        return (
          <GenericResultView
            key={index}
            entry={entry as Record<string, unknown>}
            artifactPng={artifactPng}
            artifactHtml={artifactHtml}
          />
        )
      })}
    </div>
  )
}
