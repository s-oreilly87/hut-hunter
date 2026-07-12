import { useState } from 'react'
import type { AdapterInfo, OccupantCreate } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Label } from '@/components/ui/Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { InsetPanel } from '@/components/ui/InsetPanel'
import { OccupantExtraFieldInput } from './OccupantExtraFieldInput'
import { EMPTY_FORM, GENDER_OPTIONS, isBlankValue } from './occupantHelpers'
import { cn } from '@/lib/utils'

export function OccupantForm({
  initial,
  adapters,
  onSave,
  onCancel,
  saving,
  error,
  className,
}: {
  initial?: Partial<OccupantCreate>
  adapters: AdapterInfo[]
  onSave: (data: OccupantCreate) => void
  onCancel: () => void
  saving: boolean
  error: string | null
  className?: string
}) {
  const [form, setForm] = useState<OccupantCreate>({ ...EMPTY_FORM, ...initial })
  const [localError, setLocalError] = useState<string | null>(null)
  const adaptersWithOccupantFields = adapters.filter(adapter => adapter.occupant_fields.length > 0)

  const set = (k: 'first_name' | 'last_name' | 'age' | 'gender' | 'country', v: string | number) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const setAdapterField = (adapterId: string, key: string, value: string | number) =>
    setForm(prev => ({
      ...prev,
      adapter_values: {
        ...prev.adapter_values,
        [adapterId]: {
          ...(prev.adapter_values[adapterId] ?? {}),
          [key]: value,
        },
      },
    }))

  const clearAdapterValues = (adapterId: string) =>
    setForm(prev => ({
      ...prev,
      adapter_values: {
        ...prev.adapter_values,
        [adapterId]: {},
      },
    }))

  const handleSubmit = () => {
    setLocalError(null)
    if (!form.first_name.trim()) return
    if (!form.last_name.trim()) return
    if (!form.age || form.age < 1) return
    if (!form.gender) return
    if (!form.country.trim()) return

    for (const adapter of adaptersWithOccupantFields) {
      const values = form.adapter_values[adapter.adapter_id] ?? {}
      const hasAnyValue = Object.values(values).some(value => !isBlankValue(value))
      if (!hasAnyValue) continue

      const missing = adapter.occupant_fields
        .filter(field => field.required && isBlankValue(values[field.key]))
        .map(field => field.label)
      if (missing.length > 0) {
        setLocalError(`${adapter.name} is incomplete: ${missing.join(', ')}`)
        return
      }
    }

    onSave(form)
  }

  return (
    <div className={cn('space-y-3 pt-2', className)}>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>First Name <span className="text-destructive">*</span></Label>
          <Input autoFocus value={form.first_name} onChange={e => set('first_name', e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Last Name <span className="text-destructive">*</span></Label>
          <Input value={form.last_name} onChange={e => set('last_name', e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Age <span className="text-destructive">*</span></Label>
          <Input
            type="number"
            min={1}
            max={120}
            value={form.age || ''}
            onChange={e => set('age', parseInt(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1">
          <Label>Gender <span className="text-destructive">*</span></Label>
          <Select value={form.gender} onValueChange={v => set('gender', v)}>
            <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
            <SelectContent>
              {GENDER_OPTIONS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label>Country <span className="text-destructive">*</span></Label>
        <Input
          value={form.country}
          onChange={e => set('country', e.target.value)}
          placeholder="e.g. New Zealand"
        />
      </div>

      {adaptersWithOccupantFields.map(adapter => (
        <InsetPanel
          key={adapter.adapter_id}
          className="space-y-3 rounded-2xl"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <SectionHeading title={adapter.name} tone="body" />
              <p className="text-xs text-muted-foreground">
                Fill this section only if this camper will be used with {adapter.name}.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => clearAdapterValues(adapter.adapter_id)}
            >
              Clear
            </Button>
          </div>

          {adapter.occupant_fields.map(field => (
            <div key={`${adapter.adapter_id}:${field.key}`} className="space-y-1">
              <Label>
                {field.label}
                {field.required && <span className="text-destructive"> *</span>}
              </Label>
              <OccupantExtraFieldInput
                field={field}
                value={form.adapter_values[adapter.adapter_id]?.[field.key] ?? field.default ?? ''}
                onChange={value => setAdapterField(adapter.adapter_id, field.key, value)}
              />
            </div>
          ))}
        </InsetPanel>
      ))}

      {(localError || error) && <p className="text-xs text-destructive">{localError || error}</p>}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : 'Save Camper'}
        </Button>
      </div>
    </div>
  )
}
