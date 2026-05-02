import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Plus, X } from 'lucide-react'
import { occupantsApi, type Occupant, type OccupantCreate } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SectionHeading } from '@/components/ui/section-heading'

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say']

const CATEGORY_OPTIONS = [
  'NZ Adult (18+)',
  'NZ Child (5-17)',
  'International Adult (18+)',
  'International Child (5-17)',
]

const EMPTY_FORM: OccupantCreate = {
  first_name: '',
  last_name: '',
  age: 0,
  gender: '',
  country: '',
  category: '',
}

function OccupantForm({
  initial,
  onSave,
  onCancel,
  saving,
  error,
}: {
  initial?: Partial<OccupantCreate>
  onSave: (data: OccupantCreate) => void
  onCancel: () => void
  saving: boolean
  error: string | null
}) {
  const [form, setForm] = useState<OccupantCreate>({ ...EMPTY_FORM, ...initial })

  const set = (k: keyof OccupantCreate, v: string | number) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const handleSubmit = () => {
    if (!form.first_name.trim()) return
    if (!form.last_name.trim()) return
    if (!form.age || form.age < 1) return
    if (!form.gender) return
    if (!form.country.trim()) return
    if (!form.category.trim()) return
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

      <div className="space-y-1">
        <Label>Category <span className="text-destructive">*</span></Label>
        <Select value={form.category} onValueChange={v => set('category', v)}>
          <SelectTrigger><SelectValue placeholder="Select visitor type…" /></SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="flex gap-2 justify-end pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : 'Save Occupant'}
        </Button>
      </div>
    </div>
  )
}

function OccupantRow({
  occupant,
  onEdit,
  onDelete,
}: {
  occupant: Occupant
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm">
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium text-foreground">
          {occupant.first_name} {occupant.last_name}
        </p>
        <p className="text-xs text-muted-foreground">
          {occupant.age}y · {occupant.gender} · {occupant.country}
        </p>
        <p className="text-xs text-muted-foreground">{occupant.category}</p>
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
  const [formError, setFormError] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data: occupants = [], isLoading } = useQuery({
    queryKey: ['occupants'],
    queryFn: occupantsApi.list,
    enabled: open,
  })

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
    onSuccess: invalidate,
  })

  const handleDelete = (o: Occupant) => {
    if (!window.confirm(`Delete ${o.first_name} ${o.last_name}?`)) return
    remove.mutate(o.id)
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] sm:max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Occupants</DialogTitle>
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
                      No occupants saved yet. Add one to use in watch jobs.
                    </p>
                  </div>
                )}
                {occupants.map(o => (
                  <OccupantRow
                    key={o.id}
                    occupant={o}
                    onEdit={() => startEdit(o)}
                    onDelete={() => handleDelete(o)}
                  />
                ))}
              </div>

              {editing.mode === 'none' && (
                <Button variant="outline" size="sm" className="w-full" onClick={startNew} autoFocus>
                  <Plus className="size-4 mr-1" /> Add Occupant
                </Button>
              )}
            </div>

            <div className="rounded-[1.5rem] border border-border/70 bg-background/75 p-4 sm:p-5">
              {editing.mode !== 'none' ? (
                <>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <SectionHeading title={editing.mode === 'new' ? 'New Occupant' : 'Edit Occupant'} />
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
                    initial={editing.mode === 'edit' ? editing.occupant : undefined}
                    saving={saving}
                    error={formError}
                    onCancel={cancelForm}
                    onSave={data => {
                      if (editing.mode === 'new') {
                        create.mutate(data)
                      } else {
                        update.mutate({ id: editing.occupant.id, data })
                      }
                    }}
                  />
                </>
              ) : (
                <div className="flex h-full min-h-56 flex-col justify-center rounded-2xl border border-dashed border-border/80 bg-secondary/35 px-4 py-5 text-center">
                  <p className="text-base font-medium text-foreground">
                    Select a roster entry to edit it
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
    </>
  )
}

