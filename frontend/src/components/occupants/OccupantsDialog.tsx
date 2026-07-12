import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import {
  adaptersApi,
  occupantsApi,
  jobsApi,
  type Occupant,
  type OccupantCreate,
} from '@/lib/api'
import { Button } from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog'
import { SectionHeading } from '@/components/ui/SectionHeading'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { InsetPanel } from '@/components/ui/InsetPanel'
import { OccupantForm } from './OccupantForm'
import { OccupantRow } from './OccupantRow'
import { getActiveJobsUsingOccupant } from './occupantHelpers'

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
            <InsetPanel className="space-y-3">
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
            </InsetPanel>

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
