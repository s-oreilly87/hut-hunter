import type { AdapterInfo, Occupant, WatchJob } from '@/lib/api'
import { isLiveJob } from '@/lib/availability'

function isBlankValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function buildCurrentOccupantSnapshot(
  occupant: Occupant,
  adapter: AdapterInfo | undefined,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    id: occupant.id,
    first_name: occupant.first_name,
    last_name: occupant.last_name,
    age: occupant.age,
    gender: occupant.gender,
    country: occupant.country,
  }

  if (!adapter) return snapshot

  const adapterValues = occupant.adapter_values[adapter.adapter_id] ?? {}
  for (const field of adapter.occupant_fields) {
    const value = adapterValues[field.key]
    if (!isBlankValue(value)) {
      snapshot[field.key] = value
    }
  }

  return snapshot
}

// THR-129 item 3: a saved snapshot from before an adapter's occupant
// field list shrank (e.g. Camis's now-removed `permit_holder`) can carry
// keys the current schema no longer knows about. Those must be ignored in
// the outdated-snapshot comparison — "ignore the key" is the explicit
// back-compat contract, not "treat the whole camper as edited" — so this
// prunes the saved snapshot down to exactly the keys buildCurrentOccupant
// Snapshot would produce today before comparing, rather than hardcoding
// "permit_holder" specifically (robust to any future field removal too).
function currentSnapshotKeys(adapter: AdapterInfo | undefined): Set<string> {
  const keys = new Set(['id', 'first_name', 'last_name', 'age', 'gender', 'country'])
  if (adapter) {
    for (const field of adapter.occupant_fields) keys.add(field.key)
  }
  return keys
}

function pruneToKnownKeys(
  snapshot: Record<string, unknown>,
  knownKeys: Set<string>,
): Record<string, unknown> {
  const pruned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(snapshot)) {
    if (knownKeys.has(key)) pruned[key] = value
  }
  return pruned
}

export function jobHasOutdatedOccupantSnapshots(
  job: WatchJob,
  occupants: Occupant[],
  adapter: AdapterInfo | undefined,
): boolean {
  const savedOccupants = job.params.occupants
  if (!Array.isArray(savedOccupants) || savedOccupants.length === 0) {
    return false
  }

  const occupantsById = new Map(occupants.map((occupant) => [occupant.id, occupant]))
  const knownKeys = currentSnapshotKeys(adapter)

  return savedOccupants.some((saved) => {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
      return true
    }

    const savedSnapshot = saved as Record<string, unknown>
    const occupantId = typeof savedSnapshot.id === 'string' ? savedSnapshot.id : ''
    if (!occupantId) return true

    const currentOccupant = occupantsById.get(occupantId)
    if (!currentOccupant) return true

    const currentSnapshot = buildCurrentOccupantSnapshot(currentOccupant, adapter)
    const prunedSaved = pruneToKnownKeys(savedSnapshot, knownKeys)
    return stableStringify(prunedSaved) !== stableStringify(currentSnapshot)
  })
}

/**
 * Whether a job needs its camper details refreshed: the job is still live
 * (not booked / cancelled / expired), an adapter is known, and at least one
 * attached camper has been edited since the snapshot was saved.
 *
 * Combines the status guard and the snapshot comparison that JobList and
 * JobCard previously duplicated.
 */
export function isJobOutdatedOnCampers(
  job: WatchJob,
  occupants: Occupant[],
  adapter: AdapterInfo | undefined,
): boolean {
  if (!isLiveJob(job)) return false
  if (!adapter) return false
  return jobHasOutdatedOccupantSnapshots(job, occupants, adapter)
}

