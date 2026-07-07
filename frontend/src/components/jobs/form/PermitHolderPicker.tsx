import type { Occupant } from '@/lib/api'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'

/**
 * THR-129 item 3: lets the user pick which selected camper is the Camis
 * "permit holder" (the name shown on the Review Reservation Details page)
 * when a job has more than one camper. Only rendered when
 * `selectedAdapter.uses_single_permit_holder` is true and more than one
 * camper is selected — a single-camper job is unambiguous and needs no UI,
 * and non-Camis adapters (DOC) book each occupant directly and don't have
 * this concept at all.
 *
 * `selectedId` is expected to already be resolved to a valid choice (the
 * caller — useJobForm's `effectivePermitHolderOccupantId` — defaults to the
 * first selected camper when nothing/nothing-valid is chosen yet), so this
 * component doesn't need its own fallback logic.
 */
export function PermitHolderPicker({
  occupants,
  selectedId,
  onChange,
}: {
  occupants: Occupant[]
  selectedId: string | null
  onChange: (occupantId: string) => void
}) {
  if (occupants.length <= 1) return null

  return (
    <div className="space-y-1.5">
      <Label>Permit Holder</Label>
      <Select value={selectedId ?? ''} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Select camper…" /></SelectTrigger>
        <SelectContent>
          {occupants.map((occupant) => (
            <SelectItem key={occupant.id} value={occupant.id}>
              {occupant.first_name} {occupant.last_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        The booking will be made under this camper's name.
      </p>
    </div>
  )
}
