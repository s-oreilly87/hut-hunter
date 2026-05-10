import { Users } from 'lucide-react'
import type { AdapterInfo, Occupant } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import {
  formatOccupantAdapterSummary,
  getMissingOccupantFields,
} from './occupantHelpers'

/**
 * Camper picker shown inside the Booking Inputs step. The roster comes from
 * the global occupants query; this component just lets the user toggle
 * which campers belong to this hunt.
 *
 * Surfaces three pieces of feedback inline:
 *  - Per-camper "Missing X, Y" hints when the active adapter has required
 *    fields that camper hasn't filled.
 *  - A footer line summarising the selection state vs. the manually-typed
 *    party size.
 *  - When the roster is empty, a "Manage Campers" CTA so the user can jump
 *    straight to the camper editor.
 */
export function OccupantSelector({
  roster,
  adapter,
  selectedIds,
  onChange,
  peopleCount,
  loading = false,
  onOpenOccupants,
}: {
  roster: Occupant[]
  adapter?: AdapterInfo
  selectedIds: string[]
  onChange: (ids: string[]) => void
  peopleCount: number
  loading?: boolean
  onOpenOccupants?: () => void
}) {
  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((i) => i !== id)
        : [...selectedIds, id],
    )
  }

  const countLabel = selectedIds.length > 0
    ? `${selectedIds.length} selected — party size will be inferred from campers`
    : peopleCount > 0
      ? 'No campers selected — optional for checks, required for booking'
      : 'Select campers to enable booking'

  if (loading) return <p className="text-xs text-muted-foreground">Loading campers...</p>

  if (roster.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          No saved campers yet. Add campers to enable booking.
        </p>
        {onOpenOccupants && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onOpenOccupants}
          >
            <Users className="size-3.5" />
            Manage Campers
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="space-y-1 max-h-48 overflow-y-auto rounded-md border p-1">
        {roster.map((o) => {
          const checked = selectedIds.includes(o.id)
          const missing = getMissingOccupantFields(o, adapter)
          const adapterSummary = formatOccupantAdapterSummary(o, adapter)
          return (
            <label
              key={o.id}
              className={`flex items-start gap-2.5 rounded px-2 py-1.5 cursor-pointer text-sm
                ${checked ? 'bg-primary/10' : 'hover:bg-muted'}`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(o.id)}
                className="mt-0.5 accent-primary"
              />
              <span className="min-w-0">
                <span className="font-medium">{o.first_name} {o.last_name}</span>
                <span className="block text-muted-foreground text-xs">
                  {o.age}y · {o.gender} · {o.country}
                </span>
                {adapterSummary && (
                  <span className="block text-muted-foreground text-xs">
                    {adapterSummary}
                  </span>
                )}
                {missing.length > 0 && (
                  <span className="block text-[11px] text-amber-700">
                    Missing {adapter?.name}: {missing.join(', ')}
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {countLabel}
      </p>
      {adapter && adapter.occupant_fields.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {adapter.name} also needs camper details: {adapter.occupant_fields.map((field) => field.label).join(', ')}.
        </p>
      )}
      {onOpenOccupants && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onOpenOccupants}
        >
          <Users className="size-3.5" />
          Manage Campers
        </Button>
      )}
    </div>
  )
}
