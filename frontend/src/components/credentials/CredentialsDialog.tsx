import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  adaptersApi,
  credentialsApi,
} from '@/lib/api'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog'
import { InsetPanel } from '@/components/ui/InsetPanel'
import { CredentialCard } from './CredentialCard'

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
          <InsetPanel className="p-3 text-xs text-muted-foreground">
            Sign-ins are encrypted at rest and only decrypted when Hut Hunter needs them for your account.
          </InsetPanel>

          {isLoading ? (
            <InsetPanel className="px-4 py-8 text-sm text-muted-foreground">
              Loading credential status…
            </InsetPanel>
          ) : credentialGroups.length === 0 ? (
            <InsetPanel className="px-4 py-8 text-sm text-muted-foreground">
              No booking sites in this build require a saved sign-in.
            </InsetPanel>
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
