import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, LockKeyhole, ShieldCheck, Trash2 } from 'lucide-react'

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

// THR-126: while a verification is PENDING (server-side — set the instant a
// check is enqueued, see mark_credential_pending), poll the credentials list
// on a short interval so the badge flips without a manual refresh. There is
// deliberately no client-side timeout that reverts the badge on its own
// anymore — THR-123 shipped one, and a slow/never-completing worker made it
// spin for ~25s and then silently fall back to "Unverified" with zero
// explanation. Every outcome (including INCONCLUSIVE) is now persisted
// server-side, so polling just keeps refetching until verification_status
// actually leaves 'pending'.
const VERIFYING_POLL_MS = 2_000

function verificationBadge(credential: AdapterCredential | undefined) {
  if (!credential) {
    return { label: 'Missing', className: 'bg-amber-500/12 text-amber-700' }
  }
  switch (credential.verification_status) {
    case 'pending':
      return { label: 'Verifying…', className: 'bg-sky-500/12 text-sky-700' }
    case 'verified':
      return { label: 'Verified', className: 'bg-emerald-500/12 text-emerald-700' }
    case 'failed':
      return { label: 'Invalid credentials', className: 'bg-destructive/12 text-destructive' }
    case 'inconclusive':
      return { label: 'Couldn’t verify — retry', className: 'bg-amber-500/12 text-amber-700' }
    default:
      return { label: 'Not yet verified', className: 'bg-amber-500/12 text-amber-700' }
  }
}

function CredentialCard({
  adapterId,
  adapterName,
  credential,
  accountEmail,
  onSaved,
}: {
  adapterId: string
  adapterName: string
  credential?: AdapterCredential
  accountEmail: string
  onSaved: () => void
}) {
  const qc = useQueryClient()
  // Pre-fill the username with the account email when no credential is saved
  // yet — the user can correct it before saving if their booking-site login
  // differs. We never write this pre-fill to the DB on its own.
  const [draft, setDraft] = useState<DraftState>({
    username: credential?.username ?? accountEmail,
    password: '',
  })
  const [error, setError] = useState<string | null>(null)

  // THR-126: verification is entirely server-driven now — PENDING is set
  // the instant a check is enqueued (see mark_credential_pending on the
  // backend), so this just polls while the shared credential is pending
  // rather than tracking its own client-side "verifying" flag/timeout.
  const verifying = credential?.verification_status === 'pending'
  useQuery({
    queryKey: ['credentials'],
    queryFn: credentialsApi.list,
    refetchInterval: verifying ? VERIFYING_POLL_MS : false,
    enabled: verifying,
  })

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

  const verifyNow = useMutation({
    mutationFn: () => credentialsApi.verify(adapterId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credentials'] }),
    onError: (err: Error) => setError(err.message),
  })

  const configured = Boolean(credential)
  const canSave = draft.username.trim().length > 0 && (configured || draft.password.trim().length > 0)
  const badge = verificationBadge(credential)
  const showVerifyButton = configured && credential?.verification_status !== 'verified' && !verifying

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
          {credential?.verification_status === 'failed' && (
            <p className="mt-1 text-xs text-destructive">
              {credential.verification_message || 'Sign-in failed — check your password.'}
            </p>
          )}
          {credential?.verification_status === 'inconclusive' && (
            <p className="mt-1 text-xs text-amber-700">
              {credential.verification_message
                ? `Couldn’t verify: ${credential.verification_message}`
                : 'Couldn’t verify the sign-in — this is not a rejection, just retry.'}
            </p>
          )}
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${adapterId}-username`}>Username / Email</Label>
          <Input
            id={`${adapterId}-username`}
            value={draft.username}
            onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
            placeholder={`${adapterName} login email`}
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
            placeholder={configured ? 'Enter a new password only if it changed' : `${adapterName} password`}
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
        {showVerifyButton && (
          <Button
            variant="outline"
            onClick={() => verifyNow.mutate()}
            disabled={verifyNow.isPending || save.isPending || remove.isPending}
          >
            {verifyNow.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {credential?.verification_status === 'failed' || credential?.verification_status === 'inconclusive'
              ? 'Re-verify'
              : 'Verify now'}
          </Button>
        )}
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
  userEmail,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  userEmail: string
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

  // THR-126: adapters sharing a credential_realm (both DOC adapters — a
  // single bookings.doc.govt.nz account) render as ONE card instead of
  // asking the user to enter and verify the same login twice. Grouped by
  // realm (falling back to the adapter's own id when it has none), each
  // group is represented by its alphabetically-first adapter_id — the
  // backend resolves any member id to the same shared row (see
  // credential_key_for_adapter / _credential_record_to_read), so it doesn't
  // matter which member's id the card's API calls use.
  const credentialGroups = useMemo(() => {
    const byKey = new Map<string, typeof credentialAdapters>()
    for (const adapter of credentialAdapters) {
      const key = adapter.credential_realm ?? adapter.adapter_id
      byKey.set(key, [...(byKey.get(key) ?? []), adapter])
    }
    return Array.from(byKey.values()).map((members) => {
      const sorted = [...members].sort((a, b) => a.adapter_id.localeCompare(b.adapter_id))
      return {
        canonicalAdapterId: sorted[0].adapter_id,
        displayName: sorted.map((m) => m.name).join(' + '),
      }
    })
  }, [credentialAdapters])

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
          <div className="rounded-[1.5rem] border border-border/70 bg-secondary/35 p-3 text-xs text-muted-foreground">
            Sign-ins are encrypted at rest and only decrypted when Hut Hunter needs them for your account.
          </div>

          {isLoading ? (
            <div className="rounded-[1.5rem] border border-border/70 bg-secondary/35 px-4 py-8 text-sm text-muted-foreground">
              Loading credential status…
            </div>
          ) : credentialGroups.length === 0 ? (
            <div className="rounded-[1.5rem] border border-border/70 bg-secondary/35 px-4 py-8 text-sm text-muted-foreground">
              No booking sites in this build require a saved sign-in.
            </div>
          ) : (
            credentialGroups.map((group) => (
              <CredentialCard
                // THR-123: stable across save/verify — a key that changes when
                // a credential is first created (id/username flipping from
                // 'new'/'') would remount the card and drop its in-flight
                // verifying state right as the badge should be animating.
                key={group.canonicalAdapterId}
                adapterId={group.canonicalAdapterId}
                adapterName={group.displayName}
                credential={byAdapterId.get(group.canonicalAdapterId)}
                accountEmail={userEmail}
                onSaved={invalidateJobs}
              />
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
