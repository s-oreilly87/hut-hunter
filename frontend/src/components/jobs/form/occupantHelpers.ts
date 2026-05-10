import type { AdapterInfo, Occupant } from '@/lib/api'
import { isBlankValue } from './paramHelpers'

/**
 * Returns the labels of any adapter-required occupant fields that this
 * camper has not yet filled in. Used to surface inline "Missing X, Y, Z"
 * hints in the camper picker.
 */
export function getMissingOccupantFields(
  occupant: Occupant,
  adapter: AdapterInfo | undefined,
): string[] {
  if (!adapter) return []
  const adapterValues = occupant.adapter_values[adapter.adapter_id] ?? {}
  return adapter.occupant_fields
    .filter((field) => field.required && isBlankValue(adapterValues[field.key]))
    .map((field) => field.label)
}

/**
 * Builds a "Label: value · Label: value" summary of all the adapter-
 * specific values a camper has filled in (skipping blanks). Used as the
 * second line in the camper picker so the user can see what each camper
 * is configured for at a glance.
 *
 * Returns null when there is no adapter or every value is blank, so the
 * caller can skip rendering the line entirely.
 */
export function formatOccupantAdapterSummary(
  occupant: Occupant,
  adapter: AdapterInfo | undefined,
): string | null {
  if (!adapter) return null
  const adapterValues = occupant.adapter_values[adapter.adapter_id] ?? {}
  const parts = adapter.occupant_fields
    .map((field) => {
      const value = adapterValues[field.key]
      return isBlankValue(value) ? null : `${field.label}: ${String(value)}`
    })
    .filter((value): value is string => Boolean(value))
  return parts.length > 0 ? parts.join(' · ') : null
}
