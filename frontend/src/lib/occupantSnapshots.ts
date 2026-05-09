import type { AdapterInfo, Occupant, WatchJob } from '@/lib/api'

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
    return stableStringify(savedSnapshot) !== stableStringify(currentSnapshot)
  })
}

