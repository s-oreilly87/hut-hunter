import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, LockKeyhole, Trash2 } from 'lucide-react'

import {
  adaptersApi,
  credentialsApi,
  type AdapterCredential,
} from '@/lib/api'
import { Button } from '../ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'

type DraftState = {
  username: string
  password: string
}

function CredentialCard({
  adapterId,
  adapterName,
  credential,
  onSaved,
}: {
  adapterId: string
  adapterName: string
  credential?: AdapterCredential
  onSaved: () => void
}) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<DraftState>({
    username: credential?.username ?? '',
    password: '',
  })
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => credentialsApi.upsert(adapterId, draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentials'] })
      onSaved()
      setDraft((current) => ({ ...current, password: '' }))
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const remove = useMutation({
    mutationFn: () => credentialsApi.remove(adapterId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentials'] })
      onSaved()
      setDraft({ username: '', password: '' })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const configured = Boolean(credential)
  const canSave = draft.username.trim().length > 0 && (configured || draft.password.trim().length > 0)

  return (
    <section className="rounded-[1.5rem] border border-border/70 bg-secondary/35 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            {adapterName}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {configured
              ? 'Configured. Save again to rotate the password or update the username.'
              : 'No saved sign-in yet.'}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            configured
              ? 'bg-emerald-500/12 text-emerald-700'
              : 'bg-amber-500/12 text-amber-700'
          }`}
        >
          {configured ? 'Configured' : 'Missing'}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${adapterId}-username`}>Username / Email</Label>
          <Input
            id={`${adapterId}-username`}
            value={draft.username}
            onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
            placeholder="DOC login email"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${adapterId}-password`}>
            {configured ? 'Password (leave blank to keep current)' : 'Password'}
          </Label>
          <Input
            id={`${adapterId}-password`}
            type="password"
            value={draft.password}
            onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
            placeholder={configured ? 'Enter a new password only if it changed' : 'DOC password'}
          />
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => save.mutate()}
          disabled={!canSave || save.isPending || remove.isPending}
        >
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}
          {configured ? 'Update Sign-In' : 'Save Sign-In'}
        </Button>
        {configured && (
          <Button
            variant="outline"
            onClick={() => remove.mutate()}
            disabled={save.isPending || remove.isPending}
          >
            {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Remove
          </Button>
        )}
      </div>
    </section>
  )
}

export function CredentialsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const { data: adapters = [] } = useQuery({
    queryKey: ['adapters'],
    queryFn: adaptersApi.list,
  })
  const { data: credentials = [], isLoading } = useQuery({
    queryKey: ['credentials'],
    queryFn: credentialsApi.list,
    enabled: open,
  })

  const credentialAdapters = useMemo(
    () => adapters.filter((adapter) => adapter.requires_credentials),
    [adapters],
  )

  const byAdapterId = useMemo(
    () => new Map(credentials.map((credential) => [credential.adapter_id, credential])),
    [credentials],
  )

  const invalidateJobs = () => {
    qc.invalidateQueries({ queryKey: ['jobs'] })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Booking Site Sign-Ins</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-[1.5rem] border border-border/70 bg-secondary/35 px-4 py-4 text-sm text-muted-foreground">
            Sign-ins are encrypted at rest and only decrypted when Hut Hunter needs them for your account.
          </div>

          {isLoading ? (
            <div className="rounded-[1.5rem] border border-border/70 bg-secondary/35 px-4 py-8 text-sm text-muted-foreground">
              Loading credential status…
            </div>
          ) : credentialAdapters.length === 0 ? (
            <div className="rounded-[1.5rem] border border-border/70 bg-secondary/35 px-4 py-8 text-sm text-muted-foreground">
              No booking sites in this build require a saved sign-in.
            </div>
          ) : (
            credentialAdapters.map((adapter) => (
              <CredentialCard
                key={`${adapter.adapter_id}:${byAdapterId.get(adapter.adapter_id)?.id ?? 'new'}:${byAdapterId.get(adapter.adapter_id)?.username ?? ''}`}
                adapterId={adapter.adapter_id}
                adapterName={adapter.name}
                credential={byAdapterId.get(adapter.adapter_id)}
                onSaved={invalidateJobs}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
