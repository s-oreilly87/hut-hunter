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
}: {
  result: LastResultEntry[]
  artifactPng?: string | null
  artifactHtml?: string | null
  unavailableArtifact?: ArtifactRecord | null
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

          return <AvailabilityResultTile key={index} entry={entry} />
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
