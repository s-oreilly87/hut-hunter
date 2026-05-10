import { X } from 'lucide-react'
import type { ParamField } from '@/lib/api'
import { Input } from '@/components/ui/Input'
import { DatePicker } from '@/components/ui/DatePicker'
import {
  SearchableSelect,
  type SearchableOptionGroup,
} from '@/components/ui/SearchableSelect'
import { toInputDateValue } from '@/lib/jobDate'
import { facilityDisplayName } from './paramHelpers'

/**
 * Polymorphic input row for a single adapter param field.
 *
 * Picks the right primitive based on `field.type`:
 *   - multiselect → checkbox list (with empty-state for dependent fields)
 *   - select      → SearchableSelect (with grouped options when supplied)
 *   - number      → numeric Input (clamped to 1..25 for `people`)
 *   - date        → DatePicker
 *   - default     → text Input
 *
 * The `options` prop is the resolved option list for dependent selects
 * (computed by the parent based on currently-selected filter values);
 * when null we fall back to `field.options`.
 */
export function ParamFieldInput({
  field,
  value,
  onChange,
  options,
  disabled = false,
}: {
  field: ParamField
  value: unknown
  onChange: (val: unknown) => void
  options?: string[] | null
  disabled?: boolean
}) {
  const selectOptions = options ?? field.options

  if (field.type === 'multiselect') {
    const opts = selectOptions ?? []
    const selected = Array.isArray(value) ? (value as string[]) : []

    if (opts.length === 0) {
      return (
        <p className="text-xs text-muted-foreground italic">
          Select a track first to see available sites.
        </p>
      )
    }

    const toggle = (site: string) => {
      onChange(
        selected.includes(site)
          ? selected.filter((s) => s !== site)
          : [...selected, site],
      )
    }

    return (
      <div className="space-y-1.5">
        <div className="max-h-52 overflow-y-auto rounded-md border p-1 space-y-0.5">
          {opts.map((opt) => {
            const checked = selected.includes(opt)
            return (
              <label
                key={opt}
                className={`flex items-center gap-2.5 rounded px-2 py-1.5 cursor-pointer text-sm select-none
                  ${checked ? 'bg-primary/10' : 'hover:bg-muted'}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  className="accent-primary"
                />
                <span>{opt}</span>
              </label>
            )
          })}
        </div>
        <div className="flex min-h-7 items-center justify-between gap-2">
          <p className={`text-xs ${selected.length === 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
            {selected.length === 0
              ? 'Select at least one site to watch'
              : `${selected.length} of ${opts.length} selected`}
          </p>
          {selected.length > 0 && !disabled && (
            <button
              type="button"
              aria-label="Clear selected sites"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={() => onChange([])}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    )
  }

  if (field.type === 'select' && (field.options_tree || selectOptions)) {
    const isFacility = field.key === 'facility'
    const groups: SearchableOptionGroup[] = field.options_tree
      ? field.options_tree.map((group) => ({
          label: group.group,
          options: group.items,
        }))
      : [{ options: selectOptions ?? [] }]

    return (
      <SearchableSelect
        value={String(value ?? '')}
        onChange={(nextValue) => onChange(nextValue)}
        groups={groups}
        placeholder={`Select ${field.label}`}
        disabled={disabled}
        displayValue={isFacility ? facilityDisplayName : undefined}
      />
    )
  }

  if (field.type === 'number') {
    return (
      <Input
        type="number"
        min={field.key === 'people' ? 1 : undefined}
        max={field.key === 'people' ? 25 : undefined}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    )
  }

  if (field.type === 'date') {
    return (
      <DatePicker
        value={toInputDateValue(String(value ?? ''))}
        onChange={onChange}
        disabled={disabled}
      />
    )
  }

  return (
    <Input
      type="text"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  )
}
