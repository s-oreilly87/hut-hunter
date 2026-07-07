import type { ParamField, WatchJob } from '@/lib/api'
import { toInputDateValue } from '@/lib/jobDate'

/**
 * Adapter facility options arrive in the encoded form
 * `Routeburn (12/34) — Mt Aspiring`. The bracketed park/facility ids are
 * needed for downstream URL generation but should be hidden in the picker.
 * `facilityDisplayName` strips them for display while leaving the raw
 * option string intact in the form value.
 */
export const FACILITY_OPTION_DISPLAY_RE = /^(.+?)\s*\(\d+\/\d+\)(?:\s*—\s*.+)?$/

export function facilityDisplayName(opt: string): string {
  const m = FACILITY_OPTION_DISPLAY_RE.exec(opt.trim())
  return m ? m[1].trim() : opt
}

/**
 * Treats null, undefined, the empty string (after trim), and the empty
 * array as "blank". Used by the form to decide whether a required field
 * has been satisfied and which optional adapter values to drop from the
 * outgoing payload.
 */
export function isBlankValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Date-typed adapter fields are stored in the form as ISO `yyyy-MM-dd` (the
 * format <input type="date"> exchanges) but adapter defaults arrive in the
 * adapter-native `dd/MM/yyyy`. Normalize on intake so component state stays
 * consistent.
 */
export function normalizeDateParamValue(field: ParamField, value: unknown): unknown {
  if (field.type !== 'date' || typeof value !== 'string') return value
  return toInputDateValue(value)
}

/**
 * Selection-type fields (select/multiselect) must start unselected so the
 * user is forced to make an explicit choice and the input shows its
 * placeholder text — even when the adapter declares a `default` (e.g. Camis
 * adapters default `park`/`booking_category` to the first catalog option,
 * which is meant as a sensible *fallback* value for automation, not an
 * initial UI selection). Other field types (date/number/text) keep using
 * the adapter-declared default as-is.
 */
function initialParamValue(field: ParamField): unknown {
  if (field.type === 'select' || field.type === 'multiselect') {
    return field.type === 'multiselect' ? [] : ''
  }
  return field.default ?? ''
}

export function buildDefaultParams(fields: ParamField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [field.key, normalizeDateParamValue(field, initialParamValue(field))]),
  )
}

/**
 * Convert an existing job's stored params into the form's working state.
 *
 * - `occupants` lives on a separate piece of state (`selectedOccupantIds`)
 *   so we drop it here.
 * - `permit_holder_occupant_id` (THR-129 item 3) similarly lives on its own
 *   state (`permitHolderOccupantId` in useJobForm) so it doesn't render as
 *   a generic field.
 * - `sites` may be stored as a comma-separated string or an array; we
 *   normalize to a string array since the multiselect input uses arrays.
 */
export function buildInitialParamsFromJob(job: WatchJob): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(job.params)) {
    if (k === 'occupants' || k === 'permit_holder_occupant_id') continue
    if (k === 'sites' && typeof v === 'string') {
      out[k] = v.split(',').map((s) => s.trim()).filter(Boolean)
    } else {
      out[k] = v ?? ''
    }
  }
  return out
}

/**
 * Should a booking-input field be hidden from the current form state?
 *
 * Two cases:
 *  1. Dependent select with no parent value yet — the parent must be picked
 *     before the dependent has any options to show.
 *  2. Optional dependent select whose option list is empty given the
 *     current parent value — show nothing rather than an empty dropdown.
 */
export function shouldHideBookingInputField(
  field: ParamField,
  params: Record<string, unknown>,
  options: string[] | null,
): boolean {
  if (field.filter_by && !params[field.filter_by]) {
    return true
  }

  return (
    field.type === 'select'
    && Boolean(field.filter_by)
    && !field.required
    && (!options || options.length === 0)
    && Boolean(params[field.filter_by ?? ''])
  )
}
