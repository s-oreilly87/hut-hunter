import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Plus, X } from 'lucide-react'
import {
  adaptersApi,
  occupantsApi,
  jobsApi,
  type AdapterInfo,
  type Occupant,
  type OccupantCreate,
  type ParamField,
  type WatchJob,
} from '@/lib/api'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import { SectionHeading } from '../ui/SectionHeading'
import { ConfirmDialog } from '../ui/ConfirmDialog'

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say']

const EMPTY_FORM: OccupantCreate = {
  first_name: '',
  last_name: '',
  age: 0,
  gender: '',
  country: '',
  adapter_values: {},
}

function isBlankValue(value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function summarizeAdapterValues(
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

function getActiveJobsUsingOccupant(occupantId: string, jobs: WatchJob[]): WatchJob[] {
  return jobs.filter((job) => {
    if (job.status === 'booking_complete' || job.status === 'cancelled') return false
    const occupants = job.params.occupants
    if (!Array.isArray(occupants)) return false
    return occupants.some((o: any) => o && typeof o === 'object' && o.id === occupantId)
  })
}

function OccupantExtraFieldInput({
  field,
  value,
  onChange,
}: {
  field: ParamField
  value: unknown
  onChange: (value: string | number) => void
}) {
  if (field.type === 'select') {
    return (
      <Select value={String(value ?? '')} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map(option => (
            <SelectItem key={option} value={option}>{option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'number') {
    return (
      <Input
        type="number"
        value={String(value ?? '')}
        onChange={event => onChange(parseInt(event.target.value, 10) || 0)}
      />
    )
  }

  return (
    <Input
      value={String(value ?? '')}
      onChange={event => onChange(event.target.value)}
    />
  )
}

function OccupantForm({
  initial,
  adapters,
  onSave,
  onCancel,
  saving,
  error,
}: {
  initial?: Partial<OccupantCreate>
  adapters: AdapterInfo[]
  onSave: (data: OccupantCreate) => void
  onCancel: () => void
  saving: boolean
  error: string | null
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
    <div className="space-y-3 pt-2">
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
        <div
          key={adapter.adapter_id}
          className="space-y-3 rounded-2xl border border-border/70 bg-secondary/35 p-4"
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
        </div>
      ))}

      {(localError || error) && <p className="text-destructive text-xs">{localError || error}</p>}

      <div className="flex gap-2 justify-end pt-1">
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

function OccupantRow({
  occupant,
  adaptersById,
  onEdit,
  onDelete,
}: {
  occupant: Occupant
  adaptersById: Map<string, AdapterInfo>
  onEdit: () => void
  onDelete: () => void
}) {
  const adapterSummaries = summarizeAdapterValues(occupant, adaptersById)

  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm">
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium text-foreground">
          {occupant.first_name} {occupant.last_name}
        </p>
        <p className="text-xs text-muted-foreground">
          {occupant.age}y · {occupant.gender} · {occupant.country}
        </p>
        {adapterSummaries.map(summary => (
          <p key={summary} className="text-xs text-muted-foreground">{summary}</p>
        ))}
      </div>
      <div className="flex gap-1 shrink-0">
        <Button variant="ghost" size="sm" className="size-7 p-0" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

type EditingState =
  | { mode: 'none' }
  | { mode: 'new' }
  | { mode: 'edit'; occupant: Occupant }

export function OccupantsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [editing, setEditing] = useState<EditingState>({ mode: 'none' })
  const [deleteTarget, setDeleteTarget] = useState<Occupant | null>(null)
  const [updateTarget, setUpdateTarget] = useState<{ id: string; data: OccupantCreate } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: occupants = [], isLoading } = useQuery({
    queryKey: ['occupants'],
    queryFn: occupantsApi.list,
    enabled: open,
  })
  const { data: adapters = [] } = useQuery({
    queryKey: ['adapters'],
    queryFn: adaptersApi.list,
    enabled: open,
  })
  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs'],
    queryFn: jobsApi.list,
    enabled: open,
  })
  const adaptersById = new Map(adapters.map(adapter => [adapter.adapter_id, adapter]))

  const invalidate = () => qc.invalidateQueries({ queryKey: ['occupants'] })

  const create = useMutation({
    mutationFn: occupantsApi.create,
    onSuccess: () => { invalidate(); setEditing({ mode: 'none' }); setFormError(null) },
    onError: (e: Error) => setFormError(e.message),
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<OccupantCreate> }) =>
      occupantsApi.update(id, data),
    onSuccess: () => { invalidate(); setEditing({ mode: 'none' }); setFormError(null) },
    onError: (e: Error) => setFormError(e.message),
  })

  const remove = useMutation({
    mutationFn: occupantsApi.remove,
    onSuccess: () => {
      invalidate()
      setDeleteTarget(null)
    },
  })

  const handleDelete = (o: Occupant) => {
    setDeleteTarget(o)
  }

  const startEdit = (o: Occupant) => {
    setEditing({ mode: 'edit', occupant: o })
    setFormError(null)
  }

  const startNew = () => {
    setEditing({ mode: 'new' })
    setFormError(null)
  }

  const cancelForm = () => {
    setEditing({ mode: 'none' })
    setFormError(null)
  }

  const saving = create.isPending || update.isPending
  const deleteUsedInJobsCount = deleteTarget ? getActiveJobsUsingOccupant(deleteTarget.id, jobs).length : 0

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] sm:max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Campers</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.92fr)]">
            <div className="space-y-3 rounded-[1.5rem] border border-border/70 bg-secondary/35 p-4 sm:p-5">
              <SectionHeading title="Saved Roster" />

              <div className="space-y-2">
                {isLoading && (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                )}
                {!isLoading && occupants.length === 0 && editing.mode === 'none' && (
                  <div className="rounded-2xl border border-dashed border-border/80 bg-background/60 px-4 py-4">
                    <p className="text-sm text-muted-foreground">
                      No campers saved yet. Add one to use in hunts.
                    </p>
                  </div>
                )}
                {occupants.map(o => (
                  <OccupantRow
                    key={o.id}
                    occupant={o}
                    adaptersById={adaptersById}
                    onEdit={() => startEdit(o)}
                    onDelete={() => handleDelete(o)}
                  />
                ))}
              </div>

              {editing.mode === 'none' && (
                <Button variant="outline" size="sm" className="w-full" onClick={startNew} autoFocus>
                  <Plus className="size-4 mr-1" /> Add Camper
                </Button>
              )}
            </div>

            <div className="rounded-[1.5rem] border border-border/70 bg-background/75 p-4 sm:p-5">
              {editing.mode !== 'none' ? (
                <>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <SectionHeading title={editing.mode === 'new' ? 'New Camper' : 'Edit Camper'} />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-8 p-0"
                        onClick={cancelForm}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <OccupantForm
                    key={editing.mode === 'edit' ? editing.occupant.id : 'new'}
                    initial={editing.mode === 'edit' ? editing.occupant : undefined}
                    adapters={adapters}
                    saving={saving}
                    error={formError}
                    onCancel={cancelForm}
                    onSave={data => {
                      if (editing.mode === 'new') {
                        create.mutate(data)
                      } else {
                        const usedInJobs = getActiveJobsUsingOccupant(editing.occupant.id, jobs)
                        if (usedInJobs.length > 0) {
                          setUpdateTarget({ id: editing.occupant.id, data })
                        } else {
                          update.mutate({ id: editing.occupant.id, data })
                        }
                      }
                    }}
                  />
                </>
              ) : (
                <div className="flex h-full min-h-56 flex-col justify-center rounded-2xl border border-dashed border-border/80 bg-secondary/35 px-4 py-5 text-center">
                  <p className="text-base font-medium text-foreground">
                    Select a camper to edit it
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Keeping the form pinned here avoids the roster list jumping around on smaller screens.
                  </p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteTarget(null)
        }}
        title="Delete Camper"
        description={
          deleteTarget ? (
            <div className="space-y-2">
              <p>Delete {deleteTarget.first_name} {deleteTarget.last_name} from the saved roster?</p>
              {deleteUsedInJobsCount > 0 && (
                <p className="font-medium text-destructive">
                  Warning: This camper is used in {deleteUsedInJobsCount} active hunt{deleteUsedInJobsCount === 1 ? '' : 's'}. Deleting them will require these hunts to be edited/resaved to re-enable.
                </p>
              )}
            </div>
          ) : ''
        }
        confirmLabel="Delete Camper"
        confirming={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id)
        }}
      />
      <ConfirmDialog
        open={Boolean(updateTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setUpdateTarget(null)
        }}
        title="Update Camper"
        description="This camper is used in active hunts. Making this change will require these hunts to be edited/resaved to re-enable them."
        confirmLabel="Update Anyway"
        confirming={update.isPending}
        onConfirm={() => {
          if (updateTarget) {
            update.mutate({ id: updateTarget.id, data: updateTarget.data })
            setUpdateTarget(null)
          }
        }}
      />
    </>
  )
}
