import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, LockKeyhole, ShieldCheck, Trash2 } from 'lucide-react'

import {
  credentialsApi,
  type AdapterCredential,
} from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { FormErrorAlert } from '@/components/ui/FormErrorAlert'
import { Input } from '@/components/ui/Input'
import { InsetPanel } from '@/components/ui/InsetPanel'
import { Label } from '@/components/ui/Label'
import { StatusPill } from '@/components/ui/StatusPill'
import { VERIFYING_POLL_MS, verificationBadge } from './credentialHelpers'
import { cn } from '@/lib/utils'

type DraftState = {
  username: string
  password: string
}

export function CredentialCard({
  adapterId,
  adapterName,
  credential,
  accountEmail,
  onSaved,
  className,
}: {
  adapterId: string
  adapterName: string
  credential?: AdapterCredential
  accountEmail: string
  onSaved: () => void
  className?: string
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

  // THR-127: a separate "Verify" button used to run against whatever
  // credential is currently STORED, regardless of what the user just typed
  // into the fields — so typing a new password and clicking Verify silently
  // checked the OLD one. There is now exactly one primary action, derived
  // from (stored?, verification_status, fields dirty?):
  //   - dirty (either field differs from the pristine/saved state) → always
  //     "Save & Verify", never a verify-only action against stale creds.
  //     The save path (credentialsApi.upsert) already re-verifies on its
  //     own (mark_credential_pending + verify_credentials_task), so this is
  //     a single round trip.
  //   - not dirty + nothing stored → disabled (nothing to verify or save).
  //   - not dirty + stored + already verified → disabled "Verified" state.
  //   - not dirty + stored + unverified/inconclusive/failed → "Verify"
  //     (trigger-verify against the stored credential).
  // Clearing a field back to its pristine value naturally falls back to the
  // verify-only branch since `dirty` is recomputed on every render, not
  // tracked as separate state.
  const pristineUsername = (credential?.username ?? accountEmail).trim()
  const dirty = draft.username.trim() !== pristineUsername || draft.password.trim().length > 0

  type PrimaryAction = 'save' | 'verify' | 'verified' | 'none'
  const primaryAction: PrimaryAction = dirty
    ? 'save'
    : !configured
      ? 'none'
      : credential?.verification_status === 'verified'
        ? 'verified'
        : 'verify'

  return (
    <InsetPanel as="section" className={cn(className)}>
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
        <StatusPill tone={badge.tone}>{badge.label}</StatusPill>
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
        <FormErrorAlert className="mt-3">{error}</FormErrorAlert>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {primaryAction === 'save' && (
          <Button
            onClick={() => save.mutate()}
            disabled={!canSave || save.isPending || remove.isPending}
          >
            {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}
            Save &amp; Verify
          </Button>
        )}
        {primaryAction === 'verify' && (
          <Button
            variant="outline"
            onClick={() => verifyNow.mutate()}
            disabled={verifying || verifyNow.isPending || save.isPending || remove.isPending}
          >
            {verifying || verifyNow.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {verifying
              ? 'Verifying…'
              : credential?.verification_status === 'failed' || credential?.verification_status === 'inconclusive'
                ? 'Re-verify'
                : 'Verify'}
          </Button>
        )}
        {primaryAction === 'verified' && (
          <Button variant="outline" disabled>
            <ShieldCheck className="size-4" />
            Verified
          </Button>
        )}
        {primaryAction === 'none' && (
          <Button disabled>
            <LockKeyhole className="size-4" />
            Save Sign-In
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
    </InsetPanel>
  )
}
