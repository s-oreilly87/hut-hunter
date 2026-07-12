import type { AdapterInfo, Occupant, OccupantCreate, WatchJob } from '@/lib/api'

export const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say']

export const EMPTY_FORM: OccupantCreate = {
  first_name: '',
  last_name: '',
  age: 0,
  gender: '',
  country: '',
  adapter_values: {},
}

export function isBlankValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function summarizeAdapterValues(
  occupant: Occupant,
  adaptersById: Map<string, AdapterInfo>,
): string[] {
  return Object.entries(occupant.adapter_values)
    .map(([adapterId, values]) => {
      const adapter = adaptersById.get(adapterId)
      if (!adapter) return null
      const parts = adapter.occupant_fields
        .map((field) => {
          const value = values[field.key]
          return isBlankValue(value) ? null : `${field.label}: ${String(value)}`
        })
        .filter((value): value is string => Boolean(value))
      if (parts.length === 0) return null
      return `${adapter.name} - ${parts.join(' · ')}`
    })
    .filter((value): value is string => Boolean(value))
}

export function getActiveJobsUsingOccupant(occupantId: string, jobs: WatchJob[]): WatchJob[] {
  return jobs.filter((job) => {
    if (job.status === 'booking_complete' || job.status === 'cancelled') return false
    const occupants = job.params.occupants
    if (!Array.isArray(occupants)) return false
    return occupants.some((o: unknown) => {
      if (!o || typeof o !== 'object') return false
      return (o as { id?: string }).id === occupantId
    })
  })
}
