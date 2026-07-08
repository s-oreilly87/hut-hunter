import type { AdapterInfo, Occupant, ParamField, WindowCheckResult } from '@/lib/api'
import { BookingWindowNotice } from './BookingWindowNotice'
import { OccupantSelector } from './OccupantSelector'
import { ParamFieldInput } from './ParamFieldInput'
import { ParamLabel } from './ParamLabel'
import { shouldHideBookingInputField } from './paramHelpers'
import { PermitHolderPicker } from './PermitHolderPicker'
import { StayPatternNotice } from './StayPatternNotice'

/**
 * Step-1 content: the per-adapter booking inputs plus the camper picker.
 *
 * Walks `selectedAdapter.param_fields` in order and renders the right
 * input for each. The `occupants` field is treated specially: instead of
 * a generic input it expands into the OccupantSelector. The `people`
 * field locks itself to the camper count when campers are selected
 * (the inferred party size always wins).
 *
 * Hidden fields (`shouldHideBookingInputField`) are skipped silently —
 * typically dependent selects whose parent isn't picked yet.
 */
export function BookingInputsFields({
  selectedAdapter,
  params,
  roster,
  occupantsLoading,
  selectedOccupantIds,
  setSelectedOccupantIds,
  selectedRosterOccupants,
  permitHolderOccupantId,
  setPermitHolderOccupantId,
  effectivePeopleCount,
  selectedOccupantCount,
  selectedOccupantsPresent,
  resolveOptions,
  handleParamChange,
  onOpenOccupants,
  windowCheck,
  windowAcknowledged,
  acknowledgeWindow,
}: {
  selectedAdapter: AdapterInfo
  params: Record<string, unknown>
  roster: Occupant[]
  occupantsLoading: boolean
  selectedOccupantIds: string[]
  setSelectedOccupantIds: (ids: string[]) => void
  // THR-129 item 3 — optional so a caller that hasn't wired the picker
  // through yet just never renders it (mirrors the windowCheck trio below).
  selectedRosterOccupants?: Occupant[]
  permitHolderOccupantId?: string | null
  setPermitHolderOccupantId?: (occupantId: string) => void
  effectivePeopleCount: number
  selectedOccupantCount: number
  selectedOccupantsPresent: boolean
  resolveOptions: (field: ParamField, params: Record<string, unknown>) => string[] | null
  handleParamChange: (key: string, value: unknown) => void
  onOpenOccupants?: () => void
  // THR-124 — optional so JobFormGrid/JobFormWizard callers that don't pass
  // them (there are none currently, but keeps this component defensively
  // usable) just never render the notice.
  windowCheck?: WindowCheckResult
  windowAcknowledged?: boolean
  acknowledgeWindow?: () => void
}) {
  return (
    <>
      {selectedAdapter.param_fields.map((field) => {
        if (field.key === 'occupants') {
          return (
            <div key={field.key} className="space-y-1.5">
              <ParamLabel fieldKey={field.key}>Campers</ParamLabel>
              <OccupantSelector
                roster={roster}
                adapter={selectedAdapter}
                selectedIds={selectedOccupantIds}
                onChange={setSelectedOccupantIds}
                peopleCount={effectivePeopleCount}
                loading={occupantsLoading}
                onOpenOccupants={onOpenOccupants}
              />
              {selectedAdapter.uses_single_permit_holder
                && selectedRosterOccupants
                && setPermitHolderOccupantId && (
                <PermitHolderPicker
                  occupants={selectedRosterOccupants}
                  selectedId={permitHolderOccupantId ?? null}
                  onChange={setPermitHolderOccupantId}
                />
              )}
            </div>
          )
        }

        const opts = resolveOptions(field, params)

        if (shouldHideBookingInputField(field, params, opts)) {
          return null
        }

        return (
          <div key={field.key} className="space-y-1.5">
            <ParamLabel fieldKey={field.key} required={field.required}>
              {field.label}
            </ParamLabel>
            <ParamFieldInput
              field={field}
              value={
                field.key === 'people' && selectedOccupantsPresent
                  ? String(selectedOccupantCount)
                  : params[field.key]
              }
              onChange={(val) => handleParamChange(field.key, val)}
              options={opts}
              disabled={field.key === 'people' && selectedOccupantsPresent}
              bookingTimezone={selectedAdapter.booking_timezone}
            />
            {field.key === 'people' && (
              <p className="text-xs text-muted-foreground">
                {selectedOccupantsPresent
                  ? `Party size is being inferred from ${selectedOccupantCount} selected camper${selectedOccupantCount === 1 ? '' : 's'}.`
                  : 'Used for availability checks when no campers are selected.'}
              </p>
            )}
          </div>
        )
      })}
      {windowCheck && !windowCheck.is_open && (
        <BookingWindowNotice
          windowCheck={windowCheck}
          acknowledged={Boolean(windowAcknowledged)}
          onAcknowledge={() => acknowledgeWindow?.()}
        />
      )}
      {windowCheck && !windowCheck.stay_pattern_compliant && (
        <StayPatternNotice windowCheck={windowCheck} />
      )}
    </>
  )
}
